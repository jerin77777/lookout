import logging
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, PoseModel
from backend.models import Bone, Pose
from backend.arri import define_rpc

logger = logging.getLogger("UpdatePoseRPC")

class UpdatePoseParams(BaseModel):
    id: str
    name: Optional[str] = None
    skeleton: Optional[List[Bone]] = None
    lastDetectedPose: Optional[List[Bone]] = None

class UpdatePoseResponse(BaseModel):
    success: bool
    message: str
    pose: Optional[Pose] = None

@define_rpc(
    name="poses.updatePose",
    path="/rpc/poses/updatePose",
    params=UpdatePoseParams,
    response=UpdatePoseResponse,
)
async def update_pose(params: UpdatePoseParams, request=None) -> UpdatePoseResponse:
    try:
        with Session(engine) as session:
            pose_obj = session.get(PoseModel, params.id)
            if not pose_obj:
                return UpdatePoseResponse(success=False, message="Pose not found")

            if params.name is not None:
                pose_obj.name = params.name
            if params.skeleton is not None:
                pose_obj.skeleton = [b.model_dump() for b in params.skeleton]
            if params.lastDetectedPose is not None:
                pose_obj.last_detected_pose = [b.model_dump() for b in params.lastDetectedPose]

            pose_obj.updated_at = datetime.utcnow()
            session.add(pose_obj)
            session.commit()
            session.refresh(pose_obj)

            pose = Pose(
                id=pose_obj.id,
                name=pose_obj.name,
                skeleton=params.skeleton or pose_obj.skeleton,
                lastDetectedPose=params.lastDetectedPose or pose_obj.last_detected_pose,
                createdAt=pose_obj.created_at.isoformat(),
                updatedAt=pose_obj.updated_at.isoformat()
            )
            return UpdatePoseResponse(success=True, message="Pose updated successfully", pose=pose)
    except Exception as e:
        logger.error(f"Update pose error: {e}")
        return UpdatePoseResponse(success=False, message=f"Failed: {str(e)}")
