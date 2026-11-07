from typing import List
from pydantic import BaseModel
from backend.arri import define_rpc

class TVDevice(BaseModel):
    id: str
    deviceName: str
    createdAt: str

class GetUserTVsParams(BaseModel):
    userId: str

class GetUserTVsResponse(BaseModel):
    success: bool
    devices: List[TVDevice] = []

@define_rpc(
    name="tv.getUserTvs",
    path="/rpc/tv/getUserTvs",
    params=GetUserTVsParams,
    response=GetUserTVsResponse,
)
async def get_user_tvs(params: GetUserTVsParams, request=None) -> GetUserTVsResponse:
    return GetUserTVsResponse(success=True, devices=[])
