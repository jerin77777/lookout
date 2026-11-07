import logging
from typing import List, Optional
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.db.sqlmodel_db import engine, MusicModel
from backend.arri import define_rpc

logger = logging.getLogger("GetMeditationMusicRPC")

class MeditationMusic(BaseModel):
    id: str
    title: str
    audioUrl: str
    rawAudioUrl: str
    duration: int
    isDefault: bool
    createdAt: str
    description: Optional[str] = None
    updatedAt: Optional[str] = None

class GetMeditationMusicParams(BaseModel):
    pass

class GetMeditationMusicResponse(BaseModel):
    success: bool
    message: str
    music: List[MeditationMusic] = []

@define_rpc(
    name="meditation.getMeditationMusic",
    path="/meditation/get-meditation-music",
    params=GetMeditationMusicParams,
    response=GetMeditationMusicResponse,
)
async def get_meditation_music(params: GetMeditationMusicParams, request=None) -> GetMeditationMusicResponse:
    try:
        with Session(engine) as session:
            statement = select(MusicModel).order_by(MusicModel.created_at.desc())
            results = session.exec(statement).all()
            tracks = []
            for r in results:
                tracks.append(
                    MeditationMusic(
                        id=r.id,
                        title=r.title,
                        audioUrl=r.audio_url,
                        rawAudioUrl=r.audio_url,
                        duration=int(r.duration or 0),
                        isDefault=bool(getattr(r, "is_default", False) or False),
                        createdAt=r.created_at.isoformat() if r.created_at else "",
                        description=r.artist or r.category or "Meditation Music",
                        updatedAt=r.updated_at.isoformat() if r.updated_at else None,
                    )
                )
            return GetMeditationMusicResponse(
                success=True,
                message="Meditation music list retrieved successfully",
                music=tracks,
            )
    except Exception as e:
        logger.error(f"Get meditation music error: {e}")
        return GetMeditationMusicResponse(
            success=False,
            message=f"Failed to retrieve meditation music: {str(e)}",
            music=[],
        )
