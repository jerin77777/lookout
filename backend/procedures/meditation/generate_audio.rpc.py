import base64
import logging
import os
import uuid
from typing import Optional
from pydantic import BaseModel

from backend.arri import define_rpc
from backend.services.tts_service import tts_service

logger = logging.getLogger("GenerateAudioRPC")

class GenerateAudioParams(BaseModel):
    text: str
    voiceId: Optional[str] = None

class GenerateAudioResponse(BaseModel):
    success: bool
    message: str
    audioUrl: Optional[str] = None

@define_rpc(
    name="meditation.generateAudio",
    path="/meditation/generate-audio",
    params=GenerateAudioParams,
    response=GenerateAudioResponse,
)
async def generate_audio(params: GenerateAudioParams, request=None) -> GenerateAudioResponse:
    try:
        if not params.text or not params.text.strip():
            return GenerateAudioResponse(
                success=False,
                message="Text cannot be empty",
                audioUrl=None,
            )

        voice = params.voiceId or "aria"
        result = await tts_service.generate_speech(text=params.text, voice=voice)

        if not result.get("success") or not result.get("audio_base64"):
            return GenerateAudioResponse(
                success=False,
                message=result.get("message", "TTS synthesis failed"),
                audioUrl=None,
            )

        # Save audio bytes to static uploads directory
        uploads_dir = os.path.abspath(os.path.join("uploads", "meditation_tts"))
        os.makedirs(uploads_dir, exist_ok=True)

        filename = f"{uuid.uuid4().hex}.mp3"
        filepath = os.path.join(uploads_dir, filename)

        audio_bytes = base64.b64decode(result["audio_base64"])
        with open(filepath, "wb") as f:
            f.write(audio_bytes)

        relative_url = f"/uploads/meditation_tts/{filename}"

        return GenerateAudioResponse(
            success=True,
            message="Audio generated successfully",
            audioUrl=relative_url,
        )
    except Exception as e:
        logger.error(f"Generate audio error: {e}")
        return GenerateAudioResponse(
            success=False,
            message=f"Failed to generate audio: {str(e)}",
            audioUrl=None,
        )

