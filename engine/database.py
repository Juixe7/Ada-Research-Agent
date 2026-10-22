"""Implementation of the database subsystem in Ada Research Agent.

"""

from typing import Generator
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from engine.config import DATABASE_URL

# Normalize postgres:// to postgresql:// for SQLAlchemy compatibility
db_url = DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

if db_url.startswith("postgresql://"):
    try:
        import psycopg  # noqa: F401
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    except ImportError:
        pass

connect_args = {}
if db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    db_url,
    connect_args=connect_args,
    pool_pre_ping=True
)

# Enable WAL mode for SQLite to handle concurrent reads & writes safely
if db_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        """Enable WAL and normal synchronous mode on each SQLite connection."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)
Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped SQLAlchemy session and always close it.

    Yields:
        An ORM session bound to the configured engine.

    Failure behavior:
        Connection/transaction errors propagate to the caller; session closure
        still runs in the dependency cleanup path.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db() -> None:
    """Create tables for the currently imported SQLAlchemy models.

    Returns:
        `None` after metadata creation succeeds.

    Failure behavior:
        Database connection or DDL errors propagate during application startup.
        This helper does not perform schema migrations.
    """
    from engine import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
