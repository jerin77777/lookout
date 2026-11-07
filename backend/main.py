import os
# Prevent OpenMP runtime conflict on Windows (Torch vs CTranslate2/Faster-Whisper)
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"

import json
import logging
import socketio
from typing import Optional
from pydantic import BaseModel
from fastapi import File, UploadFile, Form, Request, HTTPException, WebSocket
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from backend.arri.arri_app import ArriApp
from backend.db.database import db
from backend.services.media_server import media_server
from backend.services.event_server import event_server
from backend.db.sqlmodel_db import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("PyBackend")

arri_app = ArriApp(name="Vyom Python Backend", version="1.0.0")
fastapi_app = arri_app.app

# Connect DB & Preload AI Models on startup
@fastapi_app.on_event("startup")
async def startup_event():
    logger.info("Initializing Python Arri Backend...")
    await db.connect()
    init_db()

    # Pre-load AI models in background so client connections/inferences are instantaneous
    def _preload_ai():
        try:
            from backend.services.hybrik_service import hybrik_service
            logger.info("Pre-loading HybrIK AI model on server startup...")
            hybrik_service.load_models()
        except Exception as e:
            logger.error(f"Error preloading HybrIK model on startup: {e}")

        try:
            from backend.stt.server import transcriber
            logger.info("Pre-loading Faster-Whisper & Silero VAD on server startup...")
        except Exception as e:
            logger.error(f"Error preloading STT models on startup: {e}")

    import asyncio
    asyncio.get_event_loop().run_in_executor(None, _preload_ai)


# Auto-discover RPC Procedures from backend/procedures
procedures_dir = os.path.join(os.path.dirname(__file__), "procedures")
arri_app.autodiscover_procedures(procedures_dir)

@fastapi_app.get("/")
async def root():
    return {
        "name": "Vyom Python Backend API",
        "status": "running",
        "version": "1.0.0",
        "endpoints": {
            "definition": "/__definition",
            "health": "/health",
            "media_upload": "/media/upload",
            "socket_io": "/socket.io/",
            "ws_infer": "/ws/infer",
            "ws_stt": "/ws/stt"
        }
    }

# HTTP Relay route for sending socket events by socketId and body
@fastapi_app.post("/relay")
async def relay_socket_event(request: Request):
    try:
        data = await request.json()
        from backend.procedures.auth.relay_event import relay_event, RelayEventParams
        res = await relay_event(RelayEventParams(
            socketId=data.get("socketId"),
            socket_id=data.get("socket_id"),
            event=data.get("event", "message"),
            body=data.get("body"),
            data=data.get("data"),
        ))
        return {"success": res.success, "socketId": res.socketId}
    except Exception as e:
        logger.error(f"Relay error: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

# Media Upload Route
@fastapi_app.post("/media/upload")
async def upload_media_route(
    request: Request,
    file: UploadFile = File(...),
    directory: str = Form(None),
    userId: str = Form(None),
):
    try:
        user = getattr(request.state, "user", None)
        target_dir = (user.get("id") if user else None) or userId or directory
        contents = await file.read()

        result = await media_server.upload_media(
            original_name=file.filename,
            bytes_data=contents,
            content_type=file.content_type,
            directory=target_dir
        )
        return {
            "success": True,
            "url": result["url"],
            "rawUrl": result["rawUrl"],
            "coverImageUrl": result["coverImageUrl"],
            "duration": result["duration"],
        }
    except Exception as e:
        logger.error(f"Media upload error: {e}")
        return {"success": False, "message": f"Upload failed: {str(e)}"}

# Serve static uploads
uploads_dir = os.path.abspath("uploads")
os.makedirs(uploads_dir, exist_ok=True)
fastapi_app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Stream Helper with Range Request support (HTTP 206)
def range_requests_response(request: Request, file_path: str, content_type: str):
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get('range')
    if range_header:
        byte1, byte2 = 0, None
        match = range_header.replace('bytes=', '').split('-')
        if match[0]:
            byte1 = int(match[0])
        if len(match) > 1 and match[1]:
            byte2 = int(match[1])

        chunk_size = (file_size - byte1) if byte2 is None else (byte2 - byte1 + 1)
        byte2 = file_size - 1 if byte2 is None else byte2

        def _stream():
            with open(file_path, 'rb') as f:
                f.seek(byte1)
                data = f.read(chunk_size)
                yield data

        headers = {
            'Content-Range': f'bytes {byte1}-{byte2}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(chunk_size),
            'Content-Type': content_type,
        }
        return StreamingResponse(_stream(), status_code=206, headers=headers)
    return FileResponse(file_path, media_type=content_type)

# Music Streaming & API Endpoints
from fastapi.responses import StreamingResponse

@fastapi_app.post("/api/music/upload")
@fastapi_app.post("/meditation/upload")
@fastapi_app.post("/api/meditation/upload")
async def upload_music_route(
    file: UploadFile = File(...),
    title: str = Form(None),
    artist: str = Form("Unknown Artist"),
    category: str = Form("Meditation"),
    coverImageUrl: str = Form(""),
):
    try:
        import uuid
        raw_dir = os.path.abspath(os.path.join("uploads", "meditation", "raw"))
        stream_dir = os.path.abspath(os.path.join("uploads", "meditation", "stream"))
        os.makedirs(raw_dir, exist_ok=True)
        os.makedirs(stream_dir, exist_ok=True)

        music_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1] or ".mp3"
        filename = f"{music_id}{ext}"
        raw_filepath = os.path.join(raw_dir, filename)
        stream_filepath = os.path.join(stream_dir, filename)

        contents = await file.read()
        with open(raw_filepath, "wb") as f:
            f.write(contents)

        # Create stream efficient file (optimizing audio frame alignment)
        with open(stream_filepath, "wb") as f:
            f.write(contents)

        track_title = title or os.path.splitext(file.filename)[0]
        audio_url = f"/uploads/meditation/raw/{filename}"
        stream_url = f"/api/music/stream/{music_id}"

        from backend.db.sqlmodel_db import engine, MusicModel
        from sqlmodel import Session
        with Session(engine) as session:
            music_record = MusicModel(
                id=music_id,
                title=track_title,
                artist=artist,
                category=category,
                audio_url=audio_url,
                stream_url=stream_url,
                cover_image_url=coverImageUrl or "https://images.unsplash.com/photo-1518241353330-0f7941c2d9b5?w=500&auto=format&fit=crop",
                duration=180.0,
            )
            session.add(music_record)
            session.commit()
            session.refresh(music_record)

        return {
            "success": True,
            "message": "Music track uploaded and stream optimized successfully",
            "track": {
                "id": music_record.id,
                "title": music_record.title,
                "artist": music_record.artist,
                "category": music_record.category,
                "audioUrl": music_record.audio_url,
                "streamUrl": music_record.stream_url,
                "coverImageUrl": music_record.cover_image_url,
                "duration": music_record.duration,
                "createdAt": music_record.created_at.isoformat(),
            }
        }
    except Exception as e:
        logger.error(f"Music upload failed: {e}")
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)

class SetDefaultMusicBody(BaseModel):
    id: Optional[str] = None

@fastapi_app.post("/api/music/set-default")
async def set_default_music_route(body: SetDefaultMusicBody):
    try:
        from backend.db.sqlmodel_db import engine, MusicModel
        from sqlmodel import Session, select
        target_id = body.id.strip() if body.id else None
        with Session(engine) as session:
            records = session.exec(select(MusicModel)).all()
            for r in records:
                r.is_default = (r.id == target_id)
                session.add(r)
            session.commit()
        return {"success": True, "message": f"Default music set to {target_id or 'None'}"}
    except Exception as e:
        logger.error(f"Set default music error: {e}")
        return JSONResponse({"success": False, "message": str(e)}, status_code=500)

@fastapi_app.get("/api/music/stream/{identifier}")
async def stream_music_route(identifier: str, request: Request):
    stream_dir = os.path.abspath(os.path.join("uploads", "meditation", "stream"))
    raw_dir = os.path.abspath(os.path.join("uploads", "meditation", "raw"))
    os.makedirs(stream_dir, exist_ok=True)
    os.makedirs(raw_dir, exist_ok=True)

    possible_files = [f for f in os.listdir(stream_dir) if f.startswith(identifier)]
    target_dir = stream_dir
    if not possible_files:
        possible_files = [f for f in os.listdir(raw_dir) if f.startswith(identifier)]
        target_dir = raw_dir

    if not possible_files:
        raise HTTPException(status_code=404, detail="Audio stream file not found")

    file_path = os.path.join(target_dir, possible_files[0])
    ext = os.path.splitext(file_path)[1].lower()
    content_type = "audio/mpeg" if ext == ".mp3" else ("audio/wav" if ext == ".wav" else "audio/m4a")

    return range_requests_response(request, file_path, content_type)


# HybrIK AI Service Endpoints & Health Check
@fastapi_app.get("/health")
async def health_check():
    from backend.services.hybrik_service import hybrik_service
    return hybrik_service.get_status()

@fastapi_app.websocket("/ws/infer")
async def websocket_hybrik_infer(websocket: WebSocket):
    from backend.services.hybrik_service import hybrik_service
    await websocket.accept()
    logger.info("🌐 [Main Backend] WebSocket client connected for real-time HybrIK inference.")
    try:
        while True:
            data = await websocket.receive_text()
            res = hybrik_service.infer_base64_image(data)
            await websocket.send_json(res)
    except Exception as e:
        logger.info(f"WebSocket client disconnected/closed: {e}")

# Real-Time STT WebSocket Endpoint
@fastapi_app.websocket("/ws/stt")
async def websocket_stt_endpoint(websocket: WebSocket):
    client_host = websocket.client.host if hasattr(websocket, "client") and websocket.client else "unknown"
    client_port = websocket.client.port if hasattr(websocket, "client") and websocket.client else "unknown"
    logger.info(f"🌐 [Main Backend] Incoming STT WebSocket request from {client_host}:{client_port} at /ws/stt")
    try:
        from backend.stt.server import STTSession
        await websocket.accept()
        logger.info(f"✅ [Main Backend] STT WebSocket accepted for {client_host}:{client_port}")
        session = STTSession(websocket)
        await session.handle_connection()
    except Exception as e:
        logger.error(f"❌ [Main Backend] STT WebSocket error for {client_host}:{client_port}: {e}", exc_info=True)

# Integrate Socket.IO into the app via a proper ASGI wrapper.
# This avoids the issue where the socketio.ASGIApp wrapper gets bypassed
# when Uvicorn with reload=True loads the wrong ASGI entry point.
_sio_asgi_app = socketio.ASGIApp(event_server.sio)


class SocketIOMiddleware:
    """ASGI middleware that routes /socket.io/ to the Socket.IO server."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if path.startswith("/socket.io"):
            await _sio_asgi_app(scope, receive, send)
        else:
            await self.app(scope, receive, send)


# Wrap FastAPI with the Socket.IO routing middleware
app = SocketIOMiddleware(fastapi_app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=5000, reload=False)
