from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc

class CompleteOnboardingParams(BaseModel):
    userId: str
    role: Optional[str] = None

class CompleteOnboardingResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="auth.completeOnboarding",
    path="/rpc/auth/completeOnboarding",
    params=CompleteOnboardingParams,
    response=CompleteOnboardingResponse,
)
async def complete_onboarding(params: CompleteOnboardingParams, request=None) -> CompleteOnboardingResponse:
    return CompleteOnboardingResponse(success=True, message="Onboarding completed")
