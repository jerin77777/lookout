import uuid
from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.procedures.tv.sessions import pairing_sessions
from backend.services.event_server import event_server

class AuthorizePairingParams(BaseModel):
    code: str
    userId: str
    socketId: Optional[str] = None

class AuthorizePairingResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="tv.authorize",
    path="/rpc/tv/authorize",
    params=AuthorizePairingParams,
    response=AuthorizePairingResponse,
)
async def authorize(params: AuthorizePairingParams, request=None) -> AuthorizePairingResponse:
    sess = pairing_sessions.get(params.code)
    if not sess:
        return AuthorizePairingResponse(success=False, message="Invalid or expired code")
    token = str(uuid.uuid4())
    sess["status"] = "AUTHORIZED"
    sess["userId"] = params.userId
    sess["token"] = token

    socket_id = params.socketId or sess.get("socketId")
    if socket_id:
        await event_server.send(
            socket_id=socket_id,
            body={
                "status": "AUTHORIZED",
                "userId": params.userId,
                "token": token,
                "deviceName": sess.get("deviceName", "TV"),
            },
            event="tv_authorized",
        )

    return AuthorizePairingResponse(success=True, message="TV Authorized successfully")
