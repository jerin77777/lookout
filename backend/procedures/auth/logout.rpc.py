from pydantic import BaseModel
from backend.arri import define_rpc

class LogoutParams(BaseModel):
    userId: str

class LogoutResponse(BaseModel):
    success: bool

@define_rpc(
    name="auth.logout",
    path="/rpc/auth/logout",
    params=LogoutParams,
    response=LogoutResponse,
)
async def logout(params: LogoutParams, request=None) -> LogoutResponse:
    return LogoutResponse(success=True)
