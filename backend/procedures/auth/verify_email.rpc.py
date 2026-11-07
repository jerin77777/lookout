from pydantic import BaseModel
from backend.arri import define_rpc

class VerifyEmailOtpParams(BaseModel):
    userId: str
    otp: str

class VerifyEmailOtpResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="auth.verifyEmail",
    path="/rpc/auth/verifyEmail",
    params=VerifyEmailOtpParams,
    response=VerifyEmailOtpResponse,
)
async def verify_email(params: VerifyEmailOtpParams, request=None) -> VerifyEmailOtpResponse:
    return VerifyEmailOtpResponse(success=True, message="Email verified successfully")
