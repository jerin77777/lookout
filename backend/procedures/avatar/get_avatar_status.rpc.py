import logging
from typing import Optional, List
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.avatar_service import avatar_service

logger = logging.getLogger("AvatarStatusRPC")

class StepDetail(BaseModel):
    stepId: int
    name: str
    description: str
    status: str
    durationMs: int = 0
    vramUsedMb: float = 0.0
    outputPreview: Optional[str] = None
    logDetail: str = ""

class GetAvatarStatusParams(BaseModel):
    jobId: str

class GetAvatarStatusResponse(BaseModel):
    success: bool
    jobId: str
    status: str
    progressPercent: int = 0
    currentStep: int = 0
    steps: List[StepDetail] = []
    glbUrl: Optional[str] = None
    stylizedImageUrl: Optional[str] = None
    vramPeakMb: float = 0.0
    vramCurrentMb: float = 0.0
    error: Optional[str] = None

@define_rpc(
    name="avatar.getStatus",
    path="/rpc/avatar/getStatus",
    params=GetAvatarStatusParams,
    response=GetAvatarStatusResponse,
    method="post",
    description="Polls real-time progress, step metrics, and memory status for an avatar creation pipeline job",
)
async def get_avatar_status(params: GetAvatarStatusParams, request=None) -> GetAvatarStatusResponse:
    job = avatar_service.get_job(params.jobId)
    if not job:
        return GetAvatarStatusResponse(
            success=False,
            jobId=params.jobId,
            status="not_found",
            error=f"Job {params.jobId} not found",
        )

    steps_detail = [
        StepDetail(
            stepId=s.step_id,
            name=s.name,
            description=s.description,
            status=s.status,
            durationMs=s.duration_ms,
            vramUsedMb=s.vram_used_mb,
            outputPreview=s.output_preview,
            logDetail=s.log_detail,
        )
        for s in job.steps
    ]

    return GetAvatarStatusResponse(
        success=True,
        jobId=job.job_id,
        status=job.status,
        progressPercent=job.progress_percent,
        currentStep=job.current_step,
        steps=steps_detail,
        glbUrl=job.glb_url,
        stylizedImageUrl=job.stylized_image_url,
        vramPeakMb=job.vram_peak_mb,
        vramCurrentMb=job.vram_current_mb,
        error=job.error,
    )
