import logging
from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc

logger = logging.getLogger("GetMeditationIntroductionRPC")

class GetMeditationIntroductionParams(BaseModel):
    type: str = "general"

class GetMeditationIntroductionResponse(BaseModel):
    success: bool
    message: str
    introduction: Optional[str] = None

@define_rpc(
    name="meditation.getMeditationIntroduction",
    path="/meditation/get-meditation-introduction",
    params=GetMeditationIntroductionParams,
    response=GetMeditationIntroductionResponse,
)
async def get_meditation_introduction(params: GetMeditationIntroductionParams, request=None) -> GetMeditationIntroductionResponse:
    intro_text = (
        "Welcome to Vyom Meditation. Take a comfortable posture, close your eyes gently, "
        "and take a deep breath in through your nose, releasing all tension as you exhale slowly."
    )
    return GetMeditationIntroductionResponse(
        success=True,
        message="Introduction retrieved successfully",
        introduction=intro_text,
    )
