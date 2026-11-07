import os
import logging
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, MusicModel
from backend.arri import define_rpc

logger = logging.getLogger("DeleteMusicRPC")

class DeleteMusicParams(BaseModel):
    id: str

class DeleteMusicResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="yoga.deleteMusic",
    path="/rpc/yoga/deleteMusic",
    params=DeleteMusicParams,
    response=DeleteMusicResponse,
)
async def delete_music(params: DeleteMusicParams, request=None) -> DeleteMusicResponse:
    try:
        target_id = params.id.strip() if params.id else ""
        if not target_id:
            return DeleteMusicResponse(success=False, message="Missing music track ID")

        with Session(engine) as session:
            record = session.exec(select(MusicModel).where(MusicModel.id == target_id)).first()
            if record:
                try:
                    raw_dir = os.path.abspath(os.path.join("uploads", "meditation", "raw"))
                    stream_dir = os.path.abspath(os.path.join("uploads", "meditation", "stream"))
                    for directory in [raw_dir, stream_dir]:
                        if os.path.exists(directory):
                            for fname in os.listdir(directory):
                                if fname.startswith(target_id):
                                    os.remove(os.path.join(directory, fname))
                except Exception as file_err:
                    logger.warning(f"Failed to delete disk files for track {target_id}: {file_err}")

                session.delete(record)
                session.commit()
                return DeleteMusicResponse(success=True, message="Music track deleted successfully")
            else:
                return DeleteMusicResponse(success=False, message="Track not found")
    except Exception as e:
        logger.error(f"Delete music error: {e}")
        return DeleteMusicResponse(success=False, message=f"Failed to delete music: {str(e)}")
