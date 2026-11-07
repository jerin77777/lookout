import logging
from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.tts_service import tts_service

logger = logging.getLogger("TextToSpeechRPC")

class TextToSpeechParams(BaseModel):
    text: str
    voice: Optional[str] = "jo"

class TextToSpeechResponse(BaseModel):
    success: bool
    message: str
    audioBase64: Optional[str] = None
    durationSeconds: Optional[float] = None
    generationTimeSeconds: Optional[float] = None
    voice: Optional[str] = None

async def perform_text_to_speech(params: TextToSpeechParams) -> TextToSpeechResponse:
    """Execute TTS directly using backend TTSService."""
    result = await tts_service.generate_speech(text=params.text, voice=params.voice)
    if result.get("success"):
        return TextToSpeechResponse(
            success=True,
            message=result.get("message", "Speech generated successfully"),
            audioBase64=result.get("audio_base64"),
            durationSeconds=result.get("duration_seconds"),
            generationTimeSeconds=result.get("generation_time_seconds"),
            voice=result.get("voice", params.voice or "jo")
        )
    else:
        return TextToSpeechResponse(
            success=False,
            message=result.get("message", "TTS generation failed")
        )

@define_rpc(
    name="ai.textToSpeech",
    path="/rpc/ai/textToSpeech",
    params=TextToSpeechParams,
    response=TextToSpeechResponse,
)
async def text_to_speech(params: TextToSpeechParams, request=None) -> TextToSpeechResponse:
    """Arri RPC procedure to generate speech from text natively in backend."""
    return await perform_text_to_speech(params)

@define_rpc(
    name="ai.generateVoice",
    path="/rpc/ai/generateVoice",
    params=TextToSpeechParams,
    response=TextToSpeechResponse,
)
async def generate_voice(params: TextToSpeechParams, request=None) -> TextToSpeechResponse:
    """Arri RPC procedure to generate voice audio from text natively in backend."""
    return await perform_text_to_speech(params)
