import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from engine.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_DAYS
from engine.database import get_db
from engine.models import User, ResearchSession, ResearchTurn, VaultDocument, PasswordResetToken

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# ── Password Utilities ────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

# ── JWT Utilities ─────────────────────────────────────────────────────────────
def create_access_token(user_id: str, email: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS)
    payload = {
        "sub": user_id,
        "email": email,
        "username": username,
        "exp": expire
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None

# ── Current User Dependencies ─────────────────────────────────────────────────
def get_current_user(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
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
    if not auth or not auth.credentials:
        return None
    payload = decode_access_token(auth.credentials)
    if not payload or "sub" not in payload:
        return None
    return db.query(User).filter(User.id == payload["sub"]).first()

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)

class LoginRequest(BaseModel):
    login: str  # Email or username
    password: str

class ForgotPasswordRequest(BaseModel):
    login: str  # Email or username

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=6, max_length=128)

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6, max_length=128)

class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    created_at: datetime
    stats: Optional[Dict[str, int]] = None

class AuthResponse(BaseModel):
    token: str
    user: UserResponse

# ── Endpoints ─────────────────────────────────────────────────────────────────
@auth_router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
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
def login(req: LoginRequest, db: Session = Depends(get_db)):
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
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
):
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect."
        )

    user.password_hash = hash_password(req.new_password)
    db.commit()
    return {"status": "ok", "message": "Password updated successfully."}

@auth_router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    clean_login = req.login.strip().lower()
    user = db.query(User).filter(
        (User.email == clean_login) | (User.username == req.login.strip())
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found matching this email or username."
        )

    # Invalidate any existing unused reset tokens for this user
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()

    reset_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    token_record = PasswordResetToken(
        user_id=user.id,
        token=reset_token,
        expires_at=expires_at
    )
    db.add(token_record)
    db.commit()

    return {
        "status": "ok",
        "message": "Reset token generated successfully. Valid for 15 minutes.",
        "reset_token": reset_token,
        "username": user.username,
        "expires_in_minutes": 15
    }

@auth_router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    clean_token = req.token.strip()
    token_record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == clean_token
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
