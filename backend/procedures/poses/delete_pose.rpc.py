import logging
from pydantic import BaseModel
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, PoseModel
from backend.arri import define_rpc

logger = logging.getLogger("DeletePoseRPC")

class DeletePoseParams(BaseModel):
    id: str

class DeletePoseResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="poses.deletePose",
    path="/rpc/poses/deletePose",
    params=DeletePoseParams,
    response=DeletePoseResponse,
)
async def delete_pose(params: DeletePoseParams, request=None) -> DeletePoseResponse:
    try:
        with Session(engine) as session:
            pose_obj = session.get(PoseModel, params.id)
            if pose_obj:
                session.delete(pose_obj)
                session.commit()
        return DeletePoseResponse(success=True, message="Pose deleted successfully")
    except Exception as e:
        logger.error(f"Delete pose error: {e}")
        return DeletePoseResponse(success=False, message=f"Failed: {str(e)}")
