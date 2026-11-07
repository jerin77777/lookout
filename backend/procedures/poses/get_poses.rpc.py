import logging
from typing import List, Optional
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, PoseModel
from backend.models import Bone, Pose
from backend.arri import define_rpc

logger = logging.getLogger("GetPosesRPC")

class GetPosesParams(BaseModel):
    pass

class GetPosesResponse(BaseModel):
    success: bool
    message: str
    poses: List[Pose] = []

@define_rpc(
    name="poses.getPoses",
    path="/rpc/poses/getPoses",
    params=GetPosesParams,
    response=GetPosesResponse,
)
async def get_poses(params: GetPosesParams, request=None) -> GetPosesResponse:
    try:
        with Session(engine) as session:
            statement = select(PoseModel).order_by(PoseModel.created_at)
            results = session.exec(statement).all()
            poses = []
            for r in results:
                poses.append(Pose(
                    id=r.id,
                    name=r.name,
                    skeleton=r.skeleton or [],
                    lastDetectedPose=r.last_detected_pose,
                    createdAt=r.created_at.isoformat(),
                    updatedAt=r.updated_at.isoformat(),
                ))
            return GetPosesResponse(success=True, message="Poses retrieved successfully", poses=poses)
    except Exception as e:
        logger.error(f"Get poses error: {e}")
        return GetPosesResponse(success=False, message=f"Failed: {str(e)}", poses=[])
