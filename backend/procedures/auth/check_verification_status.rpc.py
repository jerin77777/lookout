from pydantic import BaseModel
from backend.arri import define_rpc

class CheckVerificationStatusParams(BaseModel):
    userId: str

class CheckVerificationStatusResponse(BaseModel):
    success: bool
    isVerified: bool

@define_rpc(
    name="auth.checkVerificationStatus",
    path="/rpc/auth/checkVerificationStatus",
    params=CheckVerificationStatusParams,
    response=CheckVerificationStatusResponse,
)
async def check_verification_status(params: CheckVerificationStatusParams, request=None) -> CheckVerificationStatusResponse:
    return CheckVerificationStatusResponse(success=True, isVerified=True)
