import logging
from typing import Optional, Any
from pydantic import BaseModel
from backend.services.event_server import event_server
from backend.arri import define_rpc

logger = logging.getLogger("RelayEventRPC")

class RelayEventParams(BaseModel):
    socketId: Optional[str] = None
    event: str = "message"
    body: Optional[Any] = None
    data: Optional[Any] = None

class RelayEventResponse(BaseModel):
    success: bool
    socketId: str = ""
    error: Optional[str] = None

@define_rpc(
    name="auth.relayEvent",
    path="/rpc/auth/relayEvent",
    params=RelayEventParams,
    response=RelayEventResponse,
)
async def relay_event(params: RelayEventParams, request=None) -> RelayEventResponse:
    try:
        target_socket_id = params.socketId
        if not target_socket_id:
            return RelayEventResponse(success=False, error="Missing socketId")

        payload = params.body if params.body is not None else params.data
        success = await event_server.send(socket_id=target_socket_id, body=payload, event=params.event)
        return RelayEventResponse(success=success, socketId=target_socket_id)
    except Exception as e:
        logger.error(f"Relay event error: {e}")
        return RelayEventResponse(success=False, error=str(e))
