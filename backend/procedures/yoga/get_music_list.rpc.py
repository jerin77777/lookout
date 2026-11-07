import logging
from typing import List
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, MusicModel
from backend.models import MusicTrack
from backend.arri import define_rpc

logger = logging.getLogger("GetMusicListRPC")

class GetMusicListParams(BaseModel):
    pass

class GetMusicListResponse(BaseModel):
    success: bool
    message: str
    musicList: List[MusicTrack] = []

@define_rpc(
    name="yoga.getMusicList",
    path="/rpc/yoga/getMusicList",
    params=GetMusicListParams,
    response=GetMusicListResponse,
)
async def get_music_list(params: GetMusicListParams, request=None) -> GetMusicListResponse:
    try:
        with Session(engine) as session:
            statement = select(MusicModel).order_by(MusicModel.created_at.desc())
            results = session.exec(statement).all()
            tracks = []
            for r in results:
                tracks.append(MusicTrack(
                    id=r.id,
                    title=r.title,
                    artist=r.artist or "Unknown Artist",
                    category=r.category or "Meditation",
                    audioUrl=r.audio_url,
                    streamUrl=r.stream_url,
                    coverImageUrl=r.cover_image_url or "",
                    duration=r.duration or 0.0,
                    isDefault=getattr(r, "is_default", False) or False,
                    createdAt=r.created_at.isoformat(),
                    updatedAt=r.updated_at.isoformat() if r.updated_at else None,
                ))
            return GetMusicListResponse(
                success=True,
                message="Music list retrieved successfully",
                musicList=tracks
            )
    except Exception as e:
        logger.error(f"Get music list error: {e}")
        return GetMusicListResponse(
            success=False,
            message=f"Failed to retrieve music list: {str(e)}",
            musicList=[]
        )
