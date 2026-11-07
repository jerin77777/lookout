import os
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlmodel import SQLModel, Field, create_engine, Session, select, Column, JSON

logger = logging.getLogger("SQLModelDB")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:0007!asd@localhost:5432/vyom")
# Convert postgresql:// to postgresql+psycopg2:// or async driver if needed
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# SQLModel Engine
engine = create_engine(DATABASE_URL, echo=False)

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

class YogaTutorialModel(SQLModel, table=True):
    __tablename__ = "yoga_tutorials"  # type: ignore

    id: str = Field(primary_key=True)
    title: str
    description: Optional[str] = None
    video_url: str
    raw_video_url: str
    cover_image_url: str
    duration: int
    checkpoints: List[Dict[str, Any]] = Field(default=[], sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PoseModel(SQLModel, table=True):
    __tablename__ = "poses"  # type: ignore

    id: str = Field(primary_key=True)
    name: str
    skeleton: List[Dict[str, Any]] = Field(default=[], sa_column=Column(JSON))
    last_detected_pose: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class FoodEntryModel(SQLModel, table=True):
    __tablename__ = "food_entries"  # type: ignore

    id: str = Field(primary_key=True)
    user_id: str = Field(index=True)
    meal_type: str
    timestamp: datetime
    photo_url: str
    food_label: str
    class_index: int
    confidence: float
    calories: float
    mass: float
    fats: float
    carbs: float
    proteins: float
    created_at: datetime = Field(default_factory=datetime.utcnow)

class MealScheduleModel(SQLModel, table=True):
    __tablename__ = "meal_schedules"  # type: ignore

    user_id: str = Field(primary_key=True)
    breakfast_time: str = Field(default="08:00:00")
    lunch_time: str = Field(default="12:00:00")
    dinner_time: str = Field(default="19:00:00")
    breakfast_enabled: bool = Field(default=True)
    lunch_enabled: bool = Field(default=True)
    dinner_enabled: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class TVDeviceModel(SQLModel, table=True):
    __tablename__ = "tv_devices"  # type: ignore

    id: str = Field(primary_key=True)
    user_id: str = Field(index=True)
    device_id: str = Field(unique=True)
    device_name: str
    auth_token: str
    last_seen: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class MusicModel(SQLModel, table=True):
    __tablename__ = "music"  # type: ignore

    id: str = Field(primary_key=True)
    title: str
    artist: Optional[str] = Field(default="Unknown Artist")
    category: Optional[str] = Field(default="Meditation")
    audio_url: str
    stream_url: str
    cover_image_url: Optional[str] = Field(default="")
    duration: float = Field(default=0.0)
    is_default: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class GeminiCacheModel(SQLModel, table=True):
    __tablename__ = "gemini_cache"

    id: Optional[int] = Field(default=None, primary_key=True)
    prompt_hash: str = Field(index=True)
    response_text: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TherapyHistoryModel(SQLModel, table=True):
    __tablename__ = "therapy_history"

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    role: str  # 'user' or 'model'
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


def seed_default_music(session: Session):
    try:
        existing = session.exec(select(MusicModel)).first()
        if existing:
            return
        logger.info("Seeding default meditation music tracks into DB...")
        import uuid
        sample_tracks = [
            {
                "id": str(uuid.uuid4()),
                "title": "Zen Garden Calm",
                "artist": "Vyom Meditation",
                "category": "Zen",
                "audio_url": "/uploads/meditation/stream/zen_garden.mp3",
                "stream_url": "/api/music/stream/zen_garden",
                "cover_image_url": "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=500&auto=format&fit=crop",
                "duration": 300.0,
                "is_default": True,
            },
            {
                "id": str(uuid.uuid4()),
                "title": "Deep Binaural Om",
                "artist": "Mindful Healing",
                "category": "Binaural",
                "audio_url": "/uploads/meditation/stream/deep_binaural.mp3",
                "stream_url": "/api/music/stream/deep_binaural",
                "cover_image_url": "https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=500&auto=format&fit=crop",
                "duration": 420.0,
                "is_default": False,
            },
            {
                "id": str(uuid.uuid4()),
                "title": "Ambient Ocean Breeze",
                "artist": "Serenity Audio",
                "category": "Ambient",
                "audio_url": "/uploads/meditation/stream/ocean_breeze.mp3",
                "stream_url": "/api/music/stream/ocean_breeze",
                "cover_image_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop",
                "duration": 360.0,
                "is_default": False,
            }
        ]
        for t in sample_tracks:
            session.add(MusicModel(
                id=t["id"],
                title=t["title"],
                artist=t["artist"],
                category=t["category"],
                audio_url=t["audio_url"],
                stream_url=t["stream_url"],
                cover_image_url=t["cover_image_url"],
                duration=t["duration"],
                is_default=t["is_default"],
            ))
        session.commit()
        logger.info("Default meditation music seeded successfully.")
    except Exception as e:
        logger.error(f"Error seeding default music: {e}")

def init_db():
    try:
        SQLModel.metadata.create_all(engine)
        logger.info("SQLModel tables initialized successfully.")
        with Session(engine) as session:
            seed_default_music(session)
    except Exception as e:
        logger.error(f"SQLModel init failed ({e}). Server crashing.")
        raise RuntimeError(f"Could not initialize SQLModel database: {e}") from e

def get_session():
    with Session(engine) as session:
        yield session

