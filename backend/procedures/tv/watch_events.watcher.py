from typing import Optional, Any
from pydantic import BaseModel
from backend.arri import define_watcher
from backend.services.event_server import event_server

class WatchEventsParams(BaseModel):
    socketId: Optional[str] = None
    userId: Optional[str] = None

class EventPayload(BaseModel):
    event: str
    socketId: Optional[str] = None
    userId: Optional[str] = None
    data: Optional[Any] = None

@define_watcher(
    name="tv.watchEvents",
    path="/rpc/tv/watchEvents",
    params=WatchEventsParams,
    response=EventPayload,
    description="Streams real-time events for TV/User watcher session using socketId and userId",
)
async def watch_events(params: Optional[WatchEventsParams] = None, request=None):
    socket_id = params.socketId if params else None
    user_id = params.userId if params else None

    # Fallback to user extracted by auth middleware if present
    if not user_id and request and hasattr(request.state, "user") and request.state.user:
        user_id = request.state.user.get("id") or request.state.user.get("userId")

    return event_server.subscribe(socket_id=socket_id, user_id=user_id)
