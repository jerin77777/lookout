import logging
import uuid
from typing import List, Optional
from pydantic import BaseModel
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, PoseModel
from backend.models import Bone, Pose
from backend.arri import define_rpc

logger = logging.getLogger("CreatePoseRPC")

class CreatePoseParams(BaseModel):
    name: str
    skeleton: List[Bone]

class CreatePoseResponse(BaseModel):
    success: bool
    message: str
    pose: Optional[Pose] = None

@define_rpc(
    name="poses.createPose",
    path="/rpc/poses/createPose",
    params=CreatePoseParams,
    response=CreatePoseResponse,
)
async def create_pose(params: CreatePoseParams, request=None) -> CreatePoseResponse:
    try:
        pose_id = str(uuid.uuid4())
        skeleton_data = [b.model_dump() for b in params.skeleton]
        new_pose = PoseModel(id=pose_id, name=params.name, skeleton=skeleton_data)

        with Session(engine) as session:
            session.add(new_pose)
            session.commit()
            session.refresh(new_pose)

        pose = Pose(
            id=new_pose.id,
            name=new_pose.name,
            skeleton=params.skeleton,
            createdAt=new_pose.created_at.isoformat(),
            updatedAt=new_pose.updated_at.isoformat()
        )
        return CreatePoseResponse(success=True, message="Pose created successfully", pose=pose)
    except Exception as e:
        logger.error(f"Create pose error: {e}")
        return CreatePoseResponse(success=False, message=f"Failed: {str(e)}")
