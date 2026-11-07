from pydantic import BaseModel
from backend.arri import define_rpc

class RefreshTokenParams(BaseModel):
    token: str

class RefreshTokenResponse(BaseModel):
    success: bool
    token: str = ""

@define_rpc(
    name="auth.refresh",
    path="/rpc/auth/refresh",
    params=RefreshTokenParams,
    response=RefreshTokenResponse,
)
async def refresh_token(params: RefreshTokenParams, request=None) -> RefreshTokenResponse:
    return RefreshTokenResponse(success=True, token=params.token)
