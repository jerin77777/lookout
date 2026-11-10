import os
import logging
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("SQLModelDB")

DATABASE_URL = os.getenv("DATABASE_URL")

engine = None

if DATABASE_URL:
    # Ensure PostgreSQL driver is present when using PostgreSQL
    if DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://"):
        try:
            import psycopg2
        except ImportError as e:
            err_msg = (
                f"Missing required PostgreSQL driver 'psycopg2': {e}. "
                "Please install psycopg2 (e.g. `pip install psycopg2-binary`) to connect SQLModel to PostgreSQL. "
                "Server startup aborted."
            )
            logger.critical(f"❌ {err_msg}")
            raise RuntimeError(err_msg) from e

        if DATABASE_URL.startswith("postgresql://"):
            engine_url = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
        elif DATABASE_URL.startswith("postgres://"):
            engine_url = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
        else:
            engine_url = DATABASE_URL
    else:
        engine_url = DATABASE_URL

    # SQLModel Engine
    try:
        engine = create_engine(engine_url, echo=False)
    except Exception as e:
        err_msg = f"Failed to initialize SQLModel engine for {engine_url}: {e}. Server cannot run without database."
        logger.critical(f"❌ {err_msg}")
        raise RuntimeError(err_msg) from e

# SQLModel Table Definitions
class User(SQLModel, table=True):
    __tablename__ = "users"  # type: ignore

    id: str = Field(primary_key=True)
    user_name: str
    email_id: str = Field(unique=True, index=True)
    password: Optional[str] = None
    is_email_verified: bool = Field(default=False)
    email_verification_otp: Optional[str] = None
    otp_expires_at: Optional[str] = None
    onboarding_completed: bool = Field(default=False)
    gender: Optional[str] = None
    age: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


def init_db():
    if not engine:
        err_msg = (
            "DATABASE_URL environment variable is missing or empty. "
            "Please configure DATABASE_URL in your .env file "
            "(e.g. DATABASE_URL=postgresql://<username>:<password>@localhost:5432/<dbname>)."
        )
        logger.critical(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
    try:
        logger.info("Initializing SQLModel schema...")
        SQLModel.metadata.create_all(engine)
        logger.info("✅ SQLModel tables initialized successfully.")
    except Exception as e:
        logger.critical(f"❌ SQLModel database initialization failed: {e}. Server cannot start without database.")
        raise RuntimeError(f"Could not initialize SQLModel database: {e}") from e

def get_session():
    if not engine:
        raise RuntimeError(
            "DATABASE_URL environment variable is missing or empty. "
            "Please configure DATABASE_URL in your .env file."
        )
    with Session(engine) as session:
        yield session

