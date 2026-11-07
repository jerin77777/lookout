import logging
from typing import List
from pydantic import BaseModel
from backend.arri import define_rpc

logger = logging.getLogger("GetMeditationVoicesRPC")

class MeditationVoice(BaseModel):
    id: str
    name: str
    voiceId: str
    iconUrl: str = ""
    isDefault: bool = False
    createdAt: str = ""
    updatedAt: str = ""

class GetMeditationVoicesParams(BaseModel):
    pass

class GetMeditationVoicesResponse(BaseModel):
    success: bool
    message: str
    voices: List[MeditationVoice] = []

DEFAULT_VOICES = [
    MeditationVoice(
        id="v1",
        name="Aria (Calm & Serene)",
        voiceId="aria_calm",
        iconUrl="",
        isDefault=True,
        createdAt="2026-01-01T00:00:00Z",
        updatedAt="2026-01-01T00:00:00Z",
    ),
    MeditationVoice(
        id="v2",
        name="Oliver (Deep & Grounding)",
        voiceId="oliver_deep",
        iconUrl="",
        isDefault=False,
        createdAt="2026-01-01T00:00:00Z",
        updatedAt="2026-01-01T00:00:00Z",
    ),
]

@define_rpc(
    name="meditation.getMeditationVoices",
    path="/meditation/get-meditation-voices",
    params=GetMeditationVoicesParams,
    response=GetMeditationVoicesResponse,
)
async def get_meditation_voices(params: GetMeditationVoicesParams, request=None) -> GetMeditationVoicesResponse:
    try:
        return GetMeditationVoicesResponse(
            success=True,
            message="Voices retrieved successfully",
            voices=DEFAULT_VOICES,
        )
    except Exception as e:
        logger.error(f"Get meditation voices error: {e}")
        return GetMeditationVoicesResponse(
            success=False,
            message=f"Failed to retrieve voices: {str(e)}",
            voices=[],
        )
