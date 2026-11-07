import logging
from typing import List
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, YogaTutorialModel
from backend.models import YogaTutorial
from backend.arri import define_rpc

logger = logging.getLogger("GetTutorialsRPC")

class GetTutorialsParams(BaseModel):
    pass

class GetTutorialsResponse(BaseModel):
    success: bool
    message: str
    tutorials: List[YogaTutorial] = []

@define_rpc(
    name="yoga.getTutorials",
    path="/rpc/yoga/getTutorials",
    params=GetTutorialsParams,
    response=GetTutorialsResponse,
)
async def get_tutorials(params: GetTutorialsParams, request=None) -> GetTutorialsResponse:
    try:
        with Session(engine) as session:
            statement = select(YogaTutorialModel).order_by(YogaTutorialModel.created_at)
            results = session.exec(statement).all()
            tutorials = []
            for r in results:
                tutorials.append(YogaTutorial(
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
                ))
            return GetTutorialsResponse(
                success=True,
                message="Tutorials retrieved successfully",
                tutorials=tutorials
            )
    except Exception as e:
        logger.error(f"Get tutorials error: {e}")
        return GetTutorialsResponse(
            success=False,
            message=f"Failed to retrieve tutorials: {str(e)}",
            tutorials=[]
        )
