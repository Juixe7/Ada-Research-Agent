"""Authentication API, password utilities, and current-user dependencies.

The module owns JWT issuance/validation, bcrypt password verification, and
account endpoints. Database failures are allowed to propagate to FastAPI's
server-error handling; expected authentication and validation failures use
explicit HTTP status codes. Never include password hashes or reset tokens in
responses or logs.
"""

import re
import secrets
import hashlib
import os
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from engine.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_DAYS
from engine.database import get_db
from engine.models import User, ResearchSession, VaultDocument, PasswordResetToken

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# ── Password Utilities ────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt.

    Args:
        password: User-provided password (UTF-8 encoded).

    Returns:
        The bcrypt hash suitable for persistence.

    Raises:
        ValueError: If bcrypt rejects an invalid/oversized input.
    """
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plaintext password with its stored bcrypt hash.

    Args:
        plain_password: Candidate password from the login form.
        hashed_password: Previously persisted bcrypt hash.

    Returns:
        ``True`` only when bcrypt confirms a match; malformed hashes return
        ``False`` rather than escaping as authentication errors.
    """
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

# ── JWT Utilities ─────────────────────────────────────────────────────────────
def create_access_token(user_id: str, email: str, username: str) -> str:
    """Create a signed HS256 bearer token that expires after configured days.

    Args:
        user_id: Stable database user identifier stored as JWT subject.
        email: Normalized account email claim.
        username: Account display/login name claim.

    Returns:
        Encoded JWT string.

    Raises:
        jwt.PyJWTError: If token encoding fails due to key/algorithm errors.
    """
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS)
    payload = {
        "sub": user_id,
        "email": email,
        "username": username,
        "exp": expire
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode a bearer JWT, returning ``None`` for invalid or expired tokens.

    Args:
        token: Encoded JWT received from the Authorization header.

    Returns:
        Decoded claim mapping when valid, otherwise ``None``.
    """
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None

# ── Current User Dependencies ─────────────────────────────────────────────────
def get_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Resolve the authenticated database user for a protected endpoint.

    Args:
        auth: Optional parsed bearer credentials supplied by FastAPI.
        db: Request-scoped SQLAlchemy session.

    Returns:
        The active ``User`` row.

    Raises:
        HTTPException: 401 when credentials/token/account are missing or invalid.
    """
    if not auth or not auth.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_access_token(auth.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid token. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

def get_optional_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Resolve an optional bearer identity for public/private resource routes.

    Args:
        auth: Optional parsed bearer credentials.
        db: Request-scoped SQLAlchemy session.

    Returns:
        The matching user, or ``None`` for absent/invalid credentials.
    """
    if not auth or not auth.credentials:
        return None
    payload = decode_access_token(auth.credentials)
    if not payload or "sub" not in payload:
        return None
    return db.query(User).filter(User.id == payload["sub"]).first()

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    """Validated account registration payload."""
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)

class LoginRequest(BaseModel):
    """Login identifier (email or username) and plaintext password."""
    login: str  # Email or username
    password: str

class ForgotPasswordRequest(BaseModel):
    """Account identifier for a privacy-preserving reset request."""
    login: str  # Email or username

class ResetPasswordRequest(BaseModel):
    """One-time reset token and replacement password."""
    token: str
    new_password: str = Field(..., min_length=6, max_length=128)

class ChangePasswordRequest(BaseModel):
    """Current and replacement passwords for an authenticated account."""
    current_password: str
    new_password: str = Field(..., min_length=6, max_length=128)

class UserResponse(BaseModel):
    """Public user profile DTO; never contains credential material."""
    id: str
    email: str
    username: str
    created_at: datetime
    stats: Optional[Dict[str, int]] = None

class AuthResponse(BaseModel):
    """Bearer token plus the corresponding public user profile."""
    token: str
    user: UserResponse

# ── Endpoints ─────────────────────────────────────────────────────────────────
@auth_router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Register an account and return its bearer token and profile.

    Args:
        req: Validated email, username, and password payload.
        db: Request-scoped SQLAlchemy session.

    Returns:
        Auth response containing token and user summary.

    Raises:
        HTTPException: 400 for invalid username syntax or duplicate account fields.
    """
    clean_username = req.username.strip()
    clean_email = req.email.strip().lower()

    if not re.match(r"^[a-zA-Z0-9_-]+$", clean_username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username can only contain letters, numbers, hyphens, and underscores."
        )

    # Check for existing email or username
    if db.query(User).filter(User.email == clean_email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists."
        )
    if db.query(User).filter(User.username == clean_username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This username is already taken."
        )

    new_user = User(
        email=clean_email,
        username=clean_username,
        password_hash=hash_password(req.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token(new_user.id, new_user.email, new_user.username)
    return {
        "token": token,
        "user": {
            "id": new_user.id,
            "email": new_user.email,
            "username": new_user.username,
            "created_at": new_user.created_at,
            "stats": {"sessions": 0, "vault_docs": 0}
        }
    }

@auth_router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Authenticate by email/username and return a bearer token and counts.

    Args:
        req: Login identifier and plaintext password.
        db: Request-scoped SQLAlchemy session.

    Returns:
        Auth response with user profile and current session/document counts.

    Raises:
        HTTPException: 401 when the identifier/password pair is invalid.
    """
    login_id = req.login.strip().lower()
    user = db.query(User).filter(
        (User.email == login_id) | (User.username == req.login.strip())
    ).first()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password."
        )

    token = create_access_token(user.id, user.email, user.username)
    session_count = db.query(ResearchSession).filter(ResearchSession.user_id == user.id).count()
    doc_count = db.query(VaultDocument).filter(VaultDocument.user_id == user.id).count()

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "created_at": user.created_at,
            "stats": {"sessions": session_count, "vault_docs": doc_count}
        }
    }

@auth_router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Return the current user's profile and resource counts.

    Args:
        user: Authenticated user resolved by ``get_current_user``.
        db: Request-scoped SQLAlchemy session.

    Returns:
        User profile DTO with session and vault-document counts.
    """
    session_count = db.query(ResearchSession).filter(ResearchSession.user_id == user.id).count()
    doc_count = db.query(VaultDocument).filter(VaultDocument.user_id == user.id).count()
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "created_at": user.created_at,
        "stats": {"sessions": session_count, "vault_docs": doc_count}
    }

@auth_router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Verify the current password and persist a newly hashed password.

    Args:
        req: Current and validated replacement password.
        user: Authenticated account.
        db: Request-scoped database session.

    Returns:
        A status and human-readable success message.

    Raises:
        HTTPException: 400 when the current password is incorrect; 401 when
        authentication fails. Database errors propagate to FastAPI.
    """
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )

    user.password_hash = hash_password(req.new_password)
    db.commit()
    return {"status": "ok", "message": "Password updated successfully."}

@auth_router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Request a reset email without revealing whether an account exists.

    Args:
        req: Email or username supplied by the requester.
        db: Request-scoped SQLAlchemy session.

    Returns:
        A generic success-shaped response for privacy, including when SMTP is
        unconfigured or the account does not exist.

    Failure handling:
        SMTP delivery errors remove the newly issued token and are logged by
        exception type only; database errors propagate to FastAPI.
    """
    clean_login = req.login.strip().lower()
    user = db.query(User).filter(
        (User.email == clean_login) | (User.username == req.login.strip())
    ).first()

    # Do not reveal whether an account exists. Reset links are only issued over
    # configured email; never return the token in the API response.
    generic_response = {
        "status": "ok",
        "message": "If an account matches that address, a password reset link will be sent.",
    }
    public_app_url = os.getenv("PUBLIC_APP_URL", "").strip()
    if not user or not os.getenv("SMTP_HOST") or not os.getenv("SMTP_FROM") or not public_app_url:
        return generic_response

    # Invalidate any existing unused reset tokens for this user
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()

    reset_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    token_record = PasswordResetToken(
        user_id=user.id,
        token=hashlib.sha256(reset_token.encode("utf-8")).hexdigest(),
        expires_at=expires_at
    )
    db.add(token_record)
    db.commit()
    reset_url = f"{public_app_url.rstrip('/')}/reset-password?token={reset_token}"
    message = EmailMessage()
    message["Subject"] = "Reset your Ada Research password"
    message["From"] = os.getenv("SMTP_FROM")
    message["To"] = user.email
    message.set_content(
        f"A password reset was requested for your Ada Research account. "
        f"The link expires in 15 minutes. If you did not request this, ignore this message.\n\n{reset_url}"
    )
    try:
        host = os.environ["SMTP_HOST"]
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            smtp.starttls()
            if os.getenv("SMTP_USER"):
                smtp.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", ""))
            smtp.send_message(message)
    except Exception as exc:
        db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()
        db.commit()
        print(f"[auth] Password reset email delivery failed: {type(exc).__name__}")
    return generic_response

@auth_router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)) -> Dict[str, str]:
    """Consume a one-time, expiring reset token and update the password.

    Args:
        req: Raw reset token and validated new password.
        db: Request-scoped SQLAlchemy session.

    Returns:
        A success status/message after deleting the used token.

    Raises:
        HTTPException: 400 for unknown/expired token; 404 if its user was deleted.
    """
    clean_token = req.token.strip()
    token_hash = hashlib.sha256(clean_token.encode("utf-8")).hexdigest()
    token_record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token_hash
    ).first()

    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or unrecognized reset token."
        )

    # Verify expiration (ensure tz-aware comparison)
    token_exp = token_record.expires_at
    if token_exp.tzinfo is None:
        token_exp = token_exp.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > token_exp:
        db.delete(token_record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset token has expired. Please request a new one."
        )

    user = db.query(User).filter(User.id == token_record.user_id).first()
    if not user:
        db.delete(token_record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated user account no longer exists."
        )

    user.password_hash = hash_password(req.new_password)
    db.delete(token_record)
    db.commit()

    return {
        "status": "ok",
        "message": "Password successfully reset. You can now sign in with your new password."
    }
