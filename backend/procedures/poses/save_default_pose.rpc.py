import os
import json
import logging
from typing import Any, List, Union
from pydantic import BaseModel
from backend.arri import define_rpc

logger = logging.getLogger("SaveDefaultPoseRPC")

class SaveDefaultPoseParams(BaseModel):
    skeleton: List[Any] = []

class SaveDefaultPoseResponse(BaseModel):
    success: bool
    message: str = ""

@define_rpc(
    name="poses.saveDefaultPose",
    path="/rpc/poses/saveDefaultPose",
    params=SaveDefaultPoseParams,
    response=SaveDefaultPoseResponse,
)
async def save_default_pose_procedure(params: SaveDefaultPoseParams, request=None) -> SaveDefaultPoseResponse:
    try:
        data = params.skeleton
        target_path = os.path.abspath(os.path.join(os.getcwd(), "frontend", "src", "app", "default_pose.json"))
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return SaveDefaultPoseResponse(success=True, message="Default pose saved successfully")
    except Exception as e:
        logger.error(f"Save default pose error: {e}")
        return SaveDefaultPoseResponse(success=False, message=str(e))
