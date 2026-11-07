import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"

import asyncio
import logging
import numpy as np
from typing import Tuple, Dict, Any, Optional

logger = logging.getLogger("stt_server.transcriber")

class FasterWhisperTranscriber:
    """
    Async wrapper for Faster-Whisper Turbo model.
    Runs transcription in background threads using beam_size=1, best_of=1
    for ultra-low latency streaming.
    """

    def __init__(
        self,
        model_size_or_path: str = "base.en",
        device: str = "auto",
        compute_type: str = "default",
        language: str = "en",
    ):
        self.model_size_or_path = model_size_or_path
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.model = None
        self._load_lock = asyncio.Lock()
        self._init_model()

    def _init_model(self):
        try:
            from faster_whisper import WhisperModel
            logger.info(f"Loading Faster-Whisper model '{self.model_size_or_path}' on device '{self.device}'...")
            
            # Attempt loading primary model
            try:
                self.model = WhisperModel(
                    self.model_size_or_path,
                    device=self.device,
                    compute_type=self.compute_type,
                )
            except Exception as primary_err:
                logger.warning(f"Failed to load '{self.model_size_or_path}' ({primary_err}). Trying fallback 'tiny.en'...")
                self.model = WhisperModel(
                    "tiny.en",
                    device="cpu",
                    compute_type="float32",
                )
            
            logger.info("Faster-Whisper model loaded successfully.")
        except Exception as e:
            logger.error(f"Error initializing Faster-Whisper: {e}")
            self.model = None

    def _sync_transcribe(self, audio_data: np.ndarray) -> Tuple[str, float]:
        """
        Synchronous transcription call using beam_size=1, best_of=1 for target 200-500ms latency.
        """
        if self.model is None:
            return "", 0.0

        try:
            # Faster-whisper accepts 1D float32 array normalized to [-1, 1]
            segments, info = self.model.transcribe(
                audio_data,
                beam_size=1,
                best_of=1,
                language=self.language if self.language else None,
                condition_on_previous_text=False,
                vad_filter=False,  # We perform external Silero VAD filtering
            )

            text_pieces = [seg.text for seg in segments]
            full_text = " ".join(text_pieces).strip()
            confidence = info.transcription_options if hasattr(info, 'transcription_options') else 1.0
            return full_text, float(info.duration) if hasattr(info, 'duration') else 0.0
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return "", 0.0

    async def transcribe_async(self, audio_data: np.ndarray) -> str:
        """
        Executes transcription in a non-blocking background thread.
        """
        if self.model is None or len(audio_data) == 0:
            return ""

        loop = asyncio.get_running_loop()
        text, _ = await loop.run_in_executor(None, self._sync_transcribe, audio_data)
        return text
