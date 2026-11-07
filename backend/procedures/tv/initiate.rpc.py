import uuid
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.procedures.tv.sessions import pairing_sessions

class InitiatePairingParams(BaseModel):
    deviceName: str

class InitiatePairingResponse(BaseModel):
    success: bool
    code: str
    message: str

@define_rpc(
    name="tv.initiate",
    path="/rpc/tv/initiate",
    params=InitiatePairingParams,
    response=InitiatePairingResponse,
)
async def initiate(params: InitiatePairingParams, request=None) -> InitiatePairingResponse:
    code = str(uuid.uuid4())[:6].upper()
    pairing_sessions[code] = {"deviceName": params.deviceName, "status": "PENDING", "userId": None, "token": None}
    return InitiatePairingResponse(success=True, code=code, message="Pairing code generated")
