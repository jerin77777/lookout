import logging
from typing import Optional
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, MusicModel
from backend.arri import define_rpc

logger = logging.getLogger("SetDefaultMusicRPC")

class SetDefaultMusicParams(BaseModel):
    id: Optional[str] = None

class SetDefaultMusicResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="yoga.setDefaultMusic",
    path="/rpc/yoga/setDefaultMusic",
    params=SetDefaultMusicParams,
    response=SetDefaultMusicResponse,
)
async def set_default_music(params: SetDefaultMusicParams, request=None) -> SetDefaultMusicResponse:
    try:
        target_id = params.id.strip() if params.id else None
        with Session(engine) as session:
            records = session.exec(select(MusicModel)).all()
            for r in records:
                r.is_default = (r.id == target_id)
                session.add(r)
            session.commit()
            return SetDefaultMusicResponse(
                success=True,
                message=f"Default music updated successfully to {target_id or 'None'}"
            )
    except Exception as e:
        logger.error(f"Set default music error: {e}")
        return SetDefaultMusicResponse(success=False, message=f"Failed to set default music: {str(e)}")
