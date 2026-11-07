from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc

class UpdateProfileParams(BaseModel):
    userId: str
    userName: Optional[str] = None
    avatarUrl: Optional[str] = None

class UpdateProfileResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="auth.updateProfile",
    path="/rpc/auth/updateProfile",
    params=UpdateProfileParams,
    response=UpdateProfileResponse,
)
async def update_profile(params: UpdateProfileParams, request=None) -> UpdateProfileResponse:
    return UpdateProfileResponse(success=True, message="Profile updated")
