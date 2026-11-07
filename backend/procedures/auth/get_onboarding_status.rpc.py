from pydantic import BaseModel
from backend.arri import define_rpc

class GetOnboardingStatusParams(BaseModel):
    userId: str

class GetOnboardingStatusResponse(BaseModel):
    success: bool
    isOnboarded: bool

@define_rpc(
    name="auth.getOnboardingStatus",
    path="/rpc/auth/getOnboardingStatus",
    params=GetOnboardingStatusParams,
    response=GetOnboardingStatusResponse,
)
async def get_onboarding_status(params: GetOnboardingStatusParams, request=None) -> GetOnboardingStatusResponse:
    return GetOnboardingStatusResponse(success=True, isOnboarded=True)
