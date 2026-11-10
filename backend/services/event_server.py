import logging
import time
from typing import Any, Dict, Optional, Set
import socketio

logger = logging.getLogger("EventServer")

class EventServer:
    """
    Socket.IO Event Server integrated directly into Python Arri Backend.
    Handles Socket.IO connections and event broadcasting.
    """
    def __init__(self):
        self.sio = socketio.AsyncServer(
            async_mode="asgi",
            cors_allowed_origins="*",
            logger=True,
            engineio_logger=True,
        )
        self.user_sockets: Dict[str, Set[str]] = {}
        self._setup_events()

    def _setup_events(self):
        @self.sio.event
        async def connect(sid: str, environ: dict, auth: Optional[dict] = None):
            logger.info(f"👉 [Socket.IO connect] Handler triggered for sid: {sid}, auth: {auth}")
            user_id = None
            if auth and isinstance(auth, dict):
                user_id = auth.get("userId") or auth.get("user_id") or auth.get("id")

            # Fallback to query string
            query_string = environ.get("QUERY_STRING", "")
            if not user_id and "userId=" in query_string:
                for param in query_string.split("&"):
                    if param.startswith("userId=") or param.startswith("user_id="):
                        user_id = param.split("=")[1]
                        break

            if user_id:
                if user_id not in self.user_sockets:
                    self.user_sockets[user_id] = set()
                self.user_sockets[user_id].add(sid)
                await self.sio.enter_room(sid, f"user:{user_id}")
                logger.info(f"🔌 [Socket.IO] Connected socket {sid} for userId {user_id}")
            else:
                logger.info(f"🔌 [Socket.IO] Connected socket {sid}")

        @self.sio.event
        async def disconnect(sid: str):
            for uid, sids in list(self.user_sockets.items()):
                sids.discard(sid)
                if not sids:
                    del self.user_sockets[uid]

            logger.info(f"🔌 [Socket.IO] Disconnected socket {sid}")

        @self.sio.on("ping")
        async def handle_ping(sid, data):
            client_timestamp = data.get("timestamp", 0) if isinstance(data, dict) else 0
            await self.sio.emit("pong", {
                "type": "pong",
                "timestamp": client_timestamp,
                "server_time": int(time.time() * 1000),
            }, to=sid)

    async def send(self, socket_id: str, body: Any, event: str = "message") -> bool:
        """
        Sends a payload targeted to a specific socket_id via Socket.IO.
        """
        try:
            payload = {
                "socketId": socket_id,
                "event": event,
                "data": body,
                "body": body,
            }
            await self.sio.emit(event, payload, to=socket_id)
            logger.info(f"📡 [Socket.IO] Sent event '{event}' to socket {socket_id}")
            return True
        except Exception as e:
            logger.error(f"❌ [Socket.IO] Error sending event '{event}' to {socket_id}: {e}")
            return False

    async def send_to_user(self, user_id: str, body: Any, event: str = "message") -> int:
        """
        Emits an event to all sockets associated with a given user_id.
        """
        try:
            payload = {"event": event, "data": body, "body": body}
            await self.sio.emit(event, payload, room=f"user:{user_id}")
            sids = self.user_sockets.get(user_id, set())
            logger.info(f"📡 [Socket.IO] Sent event '{event}' to user {user_id} ({len(sids)} sockets)")
            return len(sids)
        except Exception as e:
            logger.error(f"❌ [Socket.IO] Error sending to user {user_id}: {e}")
            return 0

    async def broadcast(self, event_type: str, data: Dict[str, Any]):
        """
        Broadcasts an event to all connected sockets.
        """
        payload = {"event": event_type, "type": event_type, "data": data, "body": data}
        await self.sio.emit(event_type, payload)
        logger.info(f"📡 [Socket.IO] Broadcast event '{event_type}'")

event_server = EventServer()

async def send(socket_id: str, body: Any, event: str = "message") -> bool:
    return await event_server.send(socket_id, body, event)
