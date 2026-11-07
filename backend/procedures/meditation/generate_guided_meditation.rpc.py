import logging
import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from backend.arri import define_rpc
from backend.procedures.meditation.meditation_helper import generate_meditation_script_with_gemini

logger = logging.getLogger("GenerateGuidedMeditationRPC")

class MeditationScript(BaseModel):
    type: str
    value: str
    pauseMs: int = 0
    audioUrl: Optional[str] = None

class GeneratedMeditation(BaseModel):
    id: str
    title: str
    script: str
    duration: int
    createdAt: str
    meditationScript: List[MeditationScript] = []
    audioUrl: Optional[str] = None
    rawAudioUrl: Optional[str] = None
    intent: Optional[str] = None

class GenerateGuidedMeditationParams(BaseModel):
    title: str
    duration: int = 10
    intent: Optional[str] = None
    voiceId: Optional[str] = None

class GenerateGuidedMeditationResponse(BaseModel):
    success: bool
    message: str
    meditation: Optional[GeneratedMeditation] = None

@define_rpc(
    name="meditation.generateGuidedMeditation",
    path="/meditation/generate-guided-meditation",
    params=GenerateGuidedMeditationParams,
    response=GenerateGuidedMeditationResponse,
)
async def generate_guided_meditation(params: GenerateGuidedMeditationParams, request=None) -> GenerateGuidedMeditationResponse:
    try:
        med_id = str(uuid.uuid4())
        
        # Use meditation helper (which uses Gemini gemini-3.6-flash API) to generate structured script
        gemini_result = generate_meditation_script_with_gemini(
            title=params.title,
            duration_minutes=params.duration,
            intent=params.intent,
        )
        
        raw_items = gemini_result.get("meditationScript", [])
        meditation_script_items = []
        for item in raw_items:
            meditation_script_items.append(
                MeditationScript(
                    type=item.get("type", "narration"),
                    value=item.get("value", ""),
                    pauseMs=int(item.get("pauseMs", 0) or 0),
                    audioUrl=item.get("audioUrl"),
                )
            )

        script_text = gemini_result.get("script") or " ".join([i.value for i in meditation_script_items if i.type != "pause"])
        
        generated = GeneratedMeditation(
            id=med_id,
            title=params.title,
            script=script_text,
            duration=params.duration,
            createdAt=datetime.utcnow().isoformat(),
            meditationScript=meditation_script_items,
            intent=params.intent,
        )
        return GenerateGuidedMeditationResponse(
            success=True,
            message="Guided meditation generated successfully",
            meditation=generated,
        )
    except Exception as e:
        logger.error(f"Generate guided meditation error: {e}")
        return GenerateGuidedMeditationResponse(
            success=False,
            message=f"Failed to generate guided meditation: {str(e)}",
            meditation=None,
        )

