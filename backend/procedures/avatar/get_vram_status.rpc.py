import logging
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.avatar_service import VRAMWatchdog

logger = logging.getLogger("AvatarVramRPC")

class GetVramStatusParams(BaseModel):
    pass

class GetVramStatusResponse(BaseModel):
    isGpuAvailable: bool
    device: str
    allocatedMb: float
    reservedMb: float
    maxMb: float
    targetBudgetMb: float
    usagePercent: float

@define_rpc(
    name="avatar.getVramStatus",
    path="/rpc/avatar/getVramStatus",
    params=GetVramStatusParams,
    response=GetVramStatusResponse,
    method="post",
    description="Returns live VRAM telemetry for NVIDIA RTX 3060 12GB to ensure safe execution without OOM crashes",
)
async def get_vram_status(params: GetVramStatusParams, request=None) -> GetVramStatusResponse:
    info = VRAMWatchdog.get_vram_info()
    alloc = info.get("allocated_mb", 0.0)
    max_mb = info.get("max_mb", 12288.0)
    usage = round((alloc / max_mb) * 100, 1)

    return GetVramStatusResponse(
        isGpuAvailable=info.get("available", False),
        device=info.get("device", "NVIDIA RTX 3060"),
        allocatedMb=alloc,
        reservedMb=info.get("reserved_mb", 0.0),
        maxMb=max_mb,
        targetBudgetMb=VRAMWatchdog.TARGET_BUDGET_MB,
        usagePercent=usage,
    )

