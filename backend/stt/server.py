import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"

import asyncio
import json
import logging
import time
import uuid
import numpy as np
from typing import Dict, Any, Optional

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

from .vad_pipeline import SileroVADPipeline
from .whisper_transcriber import FasterWhisperTranscriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("stt_server")

# Instantiate global transcriber instance so model is loaded once
transcriber = FasterWhisperTranscriber()

class STTSession:
    """
    Manages a single real-time client STT streaming session (supports Socket.IO and WebSocket).
    """

    def __init__(self, websocket: Any = None, sio: Any = None, sid: Optional[str] = None):
        self.websocket = websocket
        self.sio = sio
        self.sid = sid
        self.session_id = sid or str(uuid.uuid4())
        self.vad_pipeline = SileroVADPipeline()
        self.current_utterance_id: str = str(uuid.uuid4())
        self.last_partial_text: str = ""
        self.audio_queue = asyncio.Queue()
        self.is_running: bool = True
        self.partial_task: Optional[asyncio.Task] = None

    async def send_json(self, data: Dict[str, Any]):
        """Helper to send JSON response back to Socket.IO or WebSocket client."""
        try:
            if self.sio and self.sid:
                await self.sio.emit("message", data, to=self.sid)
            elif self.websocket and hasattr(self.websocket, 'send_text'):
                await self.websocket.send_text(json.dumps(data))
            elif self.websocket and hasattr(self.websocket, 'send'):
                await self.websocket.send(json.dumps(data))
        except Exception as e:
            logger.error(f"[{self.session_id}] Error sending STT message: {e}")

    async def start_session(self):
        """Starts background audio processing for Socket.IO session."""
        logger.info(f"[{self.session_id}] STT Socket.IO session initialized.")
        audio_task = asyncio.create_task(self.process_audio_loop())

        await self.send_json({
            "type": "connected",
            "session_id": self.session_id,
            "sample_rate": 16000,
            "channels": 1,
            "chunk_ms": 250,
        })
        return audio_task

    async def process_audio_loop(self):
        """
        Background loop consuming raw binary PCM audio chunks.
        Performs VAD checks and schedules partial/final transcriptions concurrently.
        """
        logger.info(f"[{self.session_id}] Audio processing loop started.")

        while self.is_running:
            try:
                # Retrieve audio chunk bytes from queue
                chunk_bytes = await self.audio_queue.get()
                if chunk_bytes is None:
                    break

                receive_time = time.time()
                float32_chunk = self.vad_pipeline.pcm_bytes_to_float32(chunk_bytes)

                # Process VAD
                is_speech, confidence, final_audio, is_finalized = self.vad_pipeline.process_chunk(float32_chunk)

                # Broadcast VAD status
                await self.send_json({
                    "type": "vad_status",
                    "is_speech": is_speech,
                    "confidence": round(float(confidence), 3),
                    "utterance_id": self.current_utterance_id,
                })

                if is_finalized and final_audio is not None:
                    # Speech segment ended due to silence timeout
                    logger.info(f"[{self.session_id}] Finalizing utterance {self.current_utterance_id} ({len(final_audio)} samples)")
                    
                    # Run final transcription in non-blocking thread
                    final_text = await transcriber.transcribe_async(final_audio)
                    latency_ms = int((time.time() - receive_time) * 1000)

                    if final_text:
                        await self.send_json({
                            "type": "final",
                            "utterance_id": self.current_utterance_id,
                            "text": final_text,
                            "latency_ms": latency_ms,
                        })
                    
                    # Reset utterance ID for next turn
                    self.current_utterance_id = str(uuid.uuid4())
                    self.last_partial_text = ""

                elif is_speech:
                    # Active speech: trigger fast non-blocking partial transcription
                    current_speech_audio = self.vad_pipeline.get_current_speech_audio()
                    if current_speech_audio is not None and len(current_speech_audio) >= 4000: # at least 250ms speech
                        # Cancel prior pending partial task if still running to keep latency minimal
                        if self.partial_task and not self.partial_task.done():
                            self.partial_task.cancel()

                        self.partial_task = asyncio.create_task(
                            self._run_partial_transcription(current_speech_audio, receive_time)
                        )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[{self.session_id}] Error in audio loop: {e}", exc_info=True)

        logger.info(f"[{self.session_id}] Audio processing loop stopped.")

    async def _run_partial_transcription(self, audio_data: np.ndarray, receive_time: float):
        """Helper to run partial transcription concurrently and stream partial text updates."""
        try:
            partial_text = await transcriber.transcribe_async(audio_data)
            latency_ms = int((time.time() - receive_time) * 1000)

            # Stream partial transcript if text improved / updated
            if partial_text and partial_text != self.last_partial_text:
                self.last_partial_text = partial_text
                await self.send_json({
                    "type": "partial",
                    "utterance_id": self.current_utterance_id,
                    "text": partial_text,
                    "latency_ms": latency_ms,
                })
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[{self.session_id}] Error in partial transcription task: {e}")

    async def handle_connection(self):
        """Main WebSocket connection handler."""
        logger.info(f"[{self.session_id}] New WebSocket connection established.")
        
        # Start background processing task
        audio_task = asyncio.create_task(self.process_audio_loop())

        # Notify client connection confirmed
        await self.send_json({
            "type": "connected",
            "session_id": self.session_id,
            "sample_rate": 16000,
            "channels": 1,
            "chunk_ms": 250,
        })

        try:
            while self.is_running:
                # Receive message (binary audio or text JSON)
                if hasattr(self.websocket, 'receive'):
                    msg = await self.websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "bytes" in msg and msg["bytes"]:
                        await self.audio_queue.put(msg["bytes"])
                    elif "text" in msg and msg["text"]:
                        await self._handle_text_payload(msg["text"])
                else:
                    message = await self.websocket.recv()
                    if isinstance(message, bytes):
                        await self.audio_queue.put(message)
                    elif isinstance(message, str):
                        await self._handle_text_payload(message)

        except Exception as e:
            logger.info(f"[{self.session_id}] WebSocket disconnected or closed ({e})")
        finally:
            self.is_running = False
            await self.audio_queue.put(None)
            audio_task.cancel()
            if self.partial_task and not self.partial_task.done():
                self.partial_task.cancel()

    async def _handle_text_payload(self, text_data: str):
        """Parses and acts on incoming JSON text commands (ping, config, flush)."""
        try:
            if isinstance(text_data, dict):
                payload = text_data
            else:
                payload = json.loads(text_data)
            msg_type = payload.get("type")

            if msg_type == "ping":
                # Heartbeat response
                client_timestamp = payload.get("timestamp", 0)
                await self.send_json({
                    "type": "pong",
                    "timestamp": client_timestamp,
                    "server_time": int(time.time() * 1000),
                })
            elif msg_type == "config":
                # Dynamic VAD / server configuration
                new_threshold = payload.get("vad_threshold")
                new_timeout = payload.get("silence_timeout_sec")
                if new_threshold is not None:
                    self.vad_pipeline.vad_threshold = float(new_threshold)
                if new_timeout is not None:
                    self.vad_pipeline.silence_timeout_samples = int(16000 * float(new_timeout))
                logger.info(f"[{self.session_id}] Updated session config: threshold={new_threshold}, timeout={new_timeout}")

            elif msg_type == "flush":
                # Force finalization of current speech buffer
                current_speech = self.vad_pipeline.get_current_speech_audio()
                if current_speech is not None and len(current_speech) > 0:
                    final_text = await transcriber.transcribe_async(current_speech)
                    if final_text:
                        await self.send_json({
                            "type": "final",
                            "utterance_id": self.current_utterance_id,
                            "text": final_text,
                            "latency_ms": 0,
                        })
                self.vad_pipeline.reset_speech_state()
                self.current_utterance_id = str(uuid.uuid4())
                self.last_partial_text = ""

        except Exception as e:
            logger.error(f"[{self.session_id}] Error parsing text payload: {e}")


# FastAPI Web App
if HAS_FASTAPI:
    app = FastAPI(title="Real-Time Speech-To-Text Socket Server")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def root():
        return {"status": "online", "service": "Real-Time STT Socket Server"}

    @app.websocket("/ws/stt")
    async def websocket_stt_endpoint(websocket: WebSocket):
        client_host = websocket.client.host if websocket.client else "unknown"
        client_port = websocket.client.port if websocket.client else "unknown"
        logger.info(f"🌐 [STT Server] Incoming WebSocket connection request from {client_host}:{client_port} to /ws/stt")
        try:
            await websocket.accept()
            logger.info(f"✅ [STT Server] WebSocket connection accepted for {client_host}:{client_port}")
            session = STTSession(websocket)
            await session.handle_connection()
        except Exception as err:
            logger.error(f"❌ [STT Server] WebSocket endpoint error for {client_host}:{client_port}: {err}", exc_info=True)


def main():
    """Runs standalone server on 0.0.0.0:8000."""
    import uvicorn
    uvicorn.run("backend.stt.server:app", host="0.0.0.0", port=8000, reload=False)

if __name__ == "__main__":
    main()
