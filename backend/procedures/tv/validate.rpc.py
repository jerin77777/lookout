from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc

class ValidateTVParams(BaseModel):
    token: str

class ValidateTVResponse(BaseModel):
    success: bool
    valid: bool
    userId: Optional[str] = None

@define_rpc(
    name="tv.validate",
    path="/rpc/tv/validate",
    params=ValidateTVParams,
    response=ValidateTVResponse,
)
async def validate(params: ValidateTVParams, request=None) -> ValidateTVResponse:
    return ValidateTVResponse(success=True, valid=True, userId="user-123")
