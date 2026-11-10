import uuid
import base64
import logging
from typing import Optional, List
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.avatar_service import avatar_service, PipelineStepInfo, VRAMWatchdog

logger = logging.getLogger("AvatarGenerateRPC")

class GenerateAvatarParams(BaseModel):
    imageData: str  # Base64 encoded or local filepath
    filename: Optional[str] = "portrait.jpg"
    characterStyle: Optional[str] = "pixar_3d"
    meshQuality: Optional[str] = "high"

class StepDetail(BaseModel):
    stepId: int
    name: str
    description: str
    status: str
    durationMs: int = 0
    vramUsedMb: float = 0.0
    outputPreview: Optional[str] = None
    logDetail: str = ""

class GenerateAvatarResponse(BaseModel):
    success: bool
    message: str
    jobId: str = ""
    status: str = "queued"
    progressPercent: int = 0
    currentStep: int = 0
    steps: List[StepDetail] = []
    glbUrl: Optional[str] = None
    stylizedImageUrl: Optional[str] = None
    vramPeakMb: float = 0.0
    vramCurrentMb: float = 0.0
    error: Optional[str] = None

@define_rpc(
    name="avatar.generate",
    path="/rpc/avatar/generate",
    params=GenerateAvatarParams,
    response=GenerateAvatarResponse,
    method="post",
    description="Executes the full 8-step AI pipeline to generate an animation-ready Pixar avatar with 52 ARKit blendshapes",
)
async def generate_avatar(params: GenerateAvatarParams, request=None) -> GenerateAvatarResponse:
    try:
        job_id = f"avatar_{uuid.uuid4().hex[:10]}"
        
        # Decode base64 image or read from file
        image_str = params.imageData.strip()
        if image_str.startswith("data:image"):
            # strip data:image/png;base64,...
            image_str = image_str.split(",", 1)[1]
        
        try:
            image_bytes = base64.b64decode(image_str)
        except Exception:
            # If it's a file path
            if os.path.exists(params.imageData):
                with open(params.imageData, "rb") as f:
                    image_bytes = f.read()
            else:
                return GenerateAvatarResponse(
                    success=False,
                    message="Invalid image data: could not decode base64 or find file",
                    jobId=job_id,
                )

        # Execute the 8-stage pipeline
        job = await avatar_service.execute_pipeline(
            job_id=job_id,
            image_bytes=image_bytes,
            original_filename=params.filename or "portrait.jpg",
            character_style=params.characterStyle or "pixar_3d",
            mesh_quality=params.meshQuality or "high",
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

        return GenerateAvatarResponse(
            success=(job.status == "completed"),
            message="Avatar generation completed successfully" if job.status == "completed" else "Avatar generation failed",
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

    except Exception as e:
        logger.error(f"Error generating avatar: {e}", exc_info=True)
        return GenerateAvatarResponse(
            success=False,
            message=f"Generation failed: {str(e)}",
            jobId="",
            error=str(e),
        )

