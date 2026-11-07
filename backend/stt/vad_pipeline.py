import numpy as np
import torch
import logging
from typing import Tuple, List, Optional

logger = logging.getLogger("stt_server.vad")

class SileroVADPipeline:
    """
    Silero VAD pipeline that continuously ingests 16 kHz mono PCM audio,
    maintains a rolling buffer (0.5s - 1.0s) for pre-speech context,
    and detects speech start / silence timeouts.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        vad_threshold: float = 0.35,
        rolling_buffer_sec: float = 0.8,
        silence_timeout_sec: float = 1.5,
        min_speech_duration_sec: float = 0.3,
    ):
        self.sample_rate = sample_rate
        self.vad_threshold = vad_threshold
        self.rolling_buffer_max_samples = int(sample_rate * rolling_buffer_sec)
        self.silence_timeout_samples = int(sample_rate * silence_timeout_sec)
        self.min_speech_samples = int(sample_rate * min_speech_duration_sec)

        # Ring buffer for 0.5-1.0s context prior to speech trigger
        self.rolling_buffer: List[float] = []

        # Current active speech accumulation
        self.speech_buffer: List[float] = []
        self.is_in_speech: bool = False
        self.silence_samples_count: int = 0
        self.speech_samples_count: int = 0

        # Load Silero VAD model via PyTorch Hub with dynamic fallback
        self.model = None
        self.utils = None
        self._init_silero_vad()

    def _init_silero_vad(self):
        try:
            logger.info("Loading Silero VAD model...")
            self.model, self.utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                trust_repo=True,
            )
            self.model.eval()
            logger.info("Silero VAD model loaded successfully.")
        except Exception as e:
            logger.warning(f"Failed to load Silero VAD via PyTorch hub ({e}). Falling back to energy-based VAD.")
            self.model = None

    def pcm_bytes_to_float32(self, pcm_bytes: bytes) -> np.ndarray:
        """Converts raw 16-bit PCM bytes to normalized float32 numpy array [-1.0, 1.0]."""
        int16_arr = np.frombuffer(pcm_bytes, dtype=np.int16)
        float32_arr = int16_arr.astype(np.float32) / 32768.0
        return float32_arr

    def get_speech_confidence(self, audio_chunk: np.ndarray) -> float:
        """Calculates VAD speech confidence probability for a float32 audio chunk."""
        if self.model is not None:
            try:
                # Silero VAD requires exact frame window sizes (512 samples for 16kHz, 256 for 8kHz)
                window_size = 512 if self.sample_rate == 16000 else 256
                if len(audio_chunk) == 0:
                    return 0.0

                confidences = []
                for i in range(0, len(audio_chunk), window_size):
                    sub_chunk = audio_chunk[i : i + window_size]
                    if len(sub_chunk) < window_size:
                        sub_chunk = np.pad(sub_chunk, (0, window_size - len(sub_chunk)))

                    tensor_chunk = torch.from_numpy(sub_chunk)
                    with torch.no_grad():
                        speech_prob = self.model(tensor_chunk, self.sample_rate).item()
                        confidences.append(speech_prob)

                return float(np.max(confidences)) if confidences else 0.0
            except Exception as e:
                logger.error(f"Error during Silero VAD inference: {e}")

        # Fallback Energy-based VAD if model loading failed or inference failed
        rms = np.sqrt(np.mean(np.square(audio_chunk))) if len(audio_chunk) > 0 else 0.0
        return float(np.clip(rms / 0.03, 0.0, 1.0))

    def process_chunk(self, audio_chunk: np.ndarray) -> Tuple[bool, float, Optional[np.ndarray], bool]:
        """
        Processes a float32 PCM audio chunk (~250 ms).

        Returns:
            (is_speech, confidence, full_speech_audio_if_finalized, is_finalized)
        """
        confidence = self.get_speech_confidence(audio_chunk)
        chunk_len = len(audio_chunk)
        chunk_list = audio_chunk.tolist()

        # Always maintain rolling buffer for pre-padding
        self.rolling_buffer.extend(chunk_list)
        if len(self.rolling_buffer) > self.rolling_buffer_max_samples:
            overflow = len(self.rolling_buffer) - self.rolling_buffer_max_samples
            self.rolling_buffer = self.rolling_buffer[overflow:]

        is_speech_frame = confidence >= self.vad_threshold

        if is_speech_frame:
            self.silence_samples_count = 0
            if not self.is_in_speech:
                # Speech Triggered! Prepend rolling buffer to speech buffer
                self.is_in_speech = True
                self.speech_buffer = list(self.rolling_buffer)
                logger.info(f"VAD: Speech started (prob={confidence:.2f}, prepended {len(self.speech_buffer)} samples)")
            else:
                self.speech_buffer.extend(chunk_list)

            self.speech_samples_count += chunk_len
            return True, confidence, None, False
        else:
            if self.is_in_speech:
                self.speech_buffer.extend(chunk_list)
                self.silence_samples_count += chunk_len

                # Check if silence timeout reached
                if self.silence_samples_count >= self.silence_timeout_samples:
                    logger.info(f"VAD: Silence timeout reached ({self.silence_samples_count / self.sample_rate:.2f}s silence)")
                    final_audio = np.array(self.speech_buffer, dtype=np.float32)
                    self.reset_speech_state()

                    # Only return final audio if minimum speech duration met
                    if len(final_audio) >= self.min_speech_samples:
                        return False, confidence, final_audio, True
                    return False, confidence, None, False

                return True, confidence, None, False
            else:
                return False, confidence, None, False

    def get_current_speech_audio(self) -> Optional[np.ndarray]:
        """Returns the current accumulated speech audio buffer for partial transcription."""
        if self.is_in_speech and len(self.speech_buffer) >= self.min_speech_samples:
            return np.array(self.speech_buffer, dtype=np.float32)
        return None

    def reset_speech_state(self):
        """Resets active speech tracking state."""
        self.is_in_speech = False
        self.speech_buffer = []
        self.silence_samples_count = 0
        self.speech_samples_count = 0
