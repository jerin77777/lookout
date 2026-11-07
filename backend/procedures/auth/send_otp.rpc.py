from pydantic import BaseModel
from backend.arri import define_rpc

class SendOtpParams(BaseModel):
    userId: str

class SendOtpResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="auth.sendOtp",
    path="/rpc/auth/sendOtp",
    params=SendOtpParams,
    response=SendOtpResponse,
)
async def send_otp(params: SendOtpParams, request=None) -> SendOtpResponse:
    return SendOtpResponse(success=True, message="OTP sent successfully")
