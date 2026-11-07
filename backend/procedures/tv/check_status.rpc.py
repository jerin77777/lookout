from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.procedures.tv.sessions import pairing_sessions

class CheckStatusParams(BaseModel):
    code: str

class CheckStatusResponse(BaseModel):
    success: bool
    status: str
    token: Optional[str] = None
    userId: Optional[str] = None

@define_rpc(
    name="tv.checkStatus",
    path="/rpc/tv/checkStatus",
    params=CheckStatusParams,
    response=CheckStatusResponse,
)
async def check_status(params: CheckStatusParams, request=None) -> CheckStatusResponse:
    sess = pairing_sessions.get(params.code)
    if not sess:
        return CheckStatusResponse(success=False, status="EXPIRED")
    return CheckStatusResponse(success=True, status=sess["status"], token=sess.get("token"), userId=sess.get("userId"))
