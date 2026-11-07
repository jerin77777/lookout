import base64
import io
import logging
import os
import tempfile
import time
from typing import Optional, Dict, Any

logger = logging.getLogger("TTSService")

# Voice catalog mapping standard/custom voice names to Edge TTS neural voices
VOICE_MAPPINGS: Dict[str, str] = {
    "jo": "en-US-AvaNeural",
    "dave": "en-US-AndrewNeural",
    "jenny": "en-US-JennyNeural",
    "guy": "en-US-GuyNeural",
    "aria": "en-US-AriaNeural",
    "brian": "en-GB-RyanNeural",
    "emma": "en-GB-SoniaNeural",
}

class TTSService:
    """Self-contained Text-To-Speech Service running inside the Python backend."""

    def __init__(self):
        self._neutts_model = None
        self._neutts_initialized = False

    async def generate_speech(self, text: str, voice: Optional[str] = "jo") -> Dict[str, Any]:
        """
        Generate audio from text asynchronously and return base64 encoded audio with metadata.
        """
        if not text or not text.strip():
            return {
                "success": False,
                "message": "Text parameter cannot be empty."
            }

        voice_key = (voice or "jo").lower().strip()
        t_start = time.time()

        # 1. Primary Engine: Async Neural Edge-TTS (high quality, fast, no external GPU server required)
        try:
            import edge_tts

            target_voice = VOICE_MAPPINGS.get(voice_key, "en-US-AvaNeural")
            communicate = edge_tts.Communicate(text, target_voice)
            
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
                tmp_path = tmp_file.name

            await communicate.save(tmp_path)
            t_elapsed = time.time() - t_start

            with open(tmp_path, "rb") as f:
                audio_bytes = f.read()

            audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

            # Clean temp file
            try:
                os.remove(tmp_path)
            except Exception:
                pass

            # Calculate duration: try soundfile or fallback estimation
            duration_seconds = self._estimate_audio_duration(audio_bytes, suffix=".mp3")

            return {
                "success": True,
                "message": "Speech generated successfully",
                "audio_base64": audio_base64,
                "duration_seconds": duration_seconds,
                "generation_time_seconds": round(t_elapsed, 4),
                "voice": voice_key
            }

        except Exception as edge_err:
            logger.warning(f"Edge-TTS synthesis fallback triggered: {edge_err}")

        # 2. Fallback Engine: gTTS (Google Text-To-Speech)
        try:
            from gtts import gTTS

            tts = gTTS(text=text, lang="en")
            mp3_fp = io.BytesIO()
            tts.write_to_fp(mp3_fp)
            audio_bytes = mp3_fp.getvalue()
            
            t_elapsed = time.time() - t_start
            audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
            duration_seconds = self._estimate_audio_duration(audio_bytes, suffix=".mp3")

            return {
                "success": True,
                "message": "Speech generated via gTTS fallback",
                "audio_base64": audio_base64,
                "duration_seconds": duration_seconds,
                "generation_time_seconds": round(t_elapsed, 4),
                "voice": voice_key
            }

        except Exception as gtts_err:
            logger.error(f"gTTS fallback failed: {gtts_err}")
            return {
                "success": False,
                "message": f"TTS synthesis failed: {str(gtts_err)}"
            }

    def _estimate_audio_duration(self, audio_bytes: bytes, suffix: str = ".mp3") -> float:
        """Helper to compute audio duration in seconds."""
        try:
            import soundfile as sf
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
                tmp_file.write(audio_bytes)
                tmp_path = tmp_file.name
            
            info = sf.info(tmp_path)
            duration = info.duration
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            return round(duration, 2)
        except Exception:
            # Rough estimation based on byte length if info reader fails
            return round(len(audio_bytes) / 16000.0, 2)

# Global singleton instance
tts_service = TTSService()
