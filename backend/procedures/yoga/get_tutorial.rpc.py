import logging
from typing import Optional
from pydantic import BaseModel
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, YogaTutorialModel
from backend.models import YogaTutorial
from backend.arri import define_rpc

logger = logging.getLogger("GetTutorialRPC")

class GetTutorialParams(BaseModel):
    tutorialId: str

class GetTutorialResponse(BaseModel):
    success: bool
    message: str
    tutorial: Optional[YogaTutorial] = None

@define_rpc(
    name="yoga.getTutorial",
    path="/rpc/yoga/getTutorial",
    params=GetTutorialParams,
    response=GetTutorialResponse,
)
async def get_tutorial(params: GetTutorialParams, request=None) -> GetTutorialResponse:
    try:
        with Session(engine) as session:
            r = session.get(YogaTutorialModel, params.tutorialId)
            if not r:
                return GetTutorialResponse(success=False, message="Tutorial not found")

            tutorial = YogaTutorial(
                id=r.id,
                title=r.title,
                description=r.description,
                videoUrl=r.video_url,
                rawVideoUrl=r.raw_video_url,
                coverImageUrl=r.cover_image_url,
                duration=r.duration,
                createdAt=r.created_at.isoformat(),
                updatedAt=r.updated_at.isoformat() if r.updated_at else None,
                checkpoints=r.checkpoints or []
            )
            return GetTutorialResponse(
                success=True,
                message="Tutorial retrieved successfully",
                tutorial=tutorial
            )
    except Exception as e:
        logger.error(f"Get tutorial error: {e}")
        return GetTutorialResponse(success=False, message=f"Failed: {str(e)}")
