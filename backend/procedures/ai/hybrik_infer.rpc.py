import logging
from typing import Optional, List
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.hybrik_service import hybrik_service

logger = logging.getLogger("HybrIkInferRPC")

class HybrIkInferParams(BaseModel):
    image: str

class HybrIkInferResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    processTimeMs: Optional[float] = None
    bbox: Optional[List[float]] = None
    jointNames: Optional[List[str]] = None
    joints3d: Optional[List[List[float]]] = None
    joints2d: Optional[List[List[float]]] = None
    bodyPose: Optional[List[float]] = None
    betas: Optional[List[float]] = None
    camera: Optional[List[float]] = None

class HybrIkHealthParams(BaseModel):
    pass

class HybrIkHealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    device: str
    jointCount: int
    error: Optional[str] = None

@define_rpc(
    name="ai.hybrikHealth",
    path="/rpc/ai/hybrikHealth",
    params=HybrIkHealthParams,
    response=HybrIkHealthResponse,
    method="get",
)
async def hybrik_health(params: HybrIkHealthParams, request=None) -> HybrIkHealthResponse:
    """Arri RPC procedure to check HybrIK AI server status."""
    st = hybrik_service.get_status()
    return HybrIkHealthResponse(
        status=st.get("status", "ok"),
        modelLoaded=st.get("model_loaded", False),
        device=st.get("device", "none"),
        jointCount=st.get("joint_count", 0),
        error=st.get("error")
    )

@define_rpc(
    name="ai.hybrikInfer",
    path="/rpc/ai/hybrikInfer",
    params=HybrIkInferParams,
    response=HybrIkInferResponse,
    method="post",
)
async def hybrik_infer(params: HybrIkInferParams, request=None) -> HybrIkInferResponse:
    """Arri RPC procedure to run 3D pose estimation using HybrIK AI."""
    result = hybrik_service.infer_base64_image(params.image)
    return HybrIkInferResponse(
        success=result.get("success", False),
        message=result.get("message"),
        processTimeMs=result.get("process_time_ms"),
        bbox=result.get("bbox"),
        jointNames=result.get("joint_names"),
        joints3d=result.get("joints_3d"),
        joints2d=result.get("joints_2d"),
        bodyPose=result.get("body_pose"),
        betas=result.get("betas"),
        camera=result.get("camera"),
    )
