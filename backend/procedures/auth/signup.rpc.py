import logging
import os
import uuid
import jwt
from typing import Optional
from pydantic import BaseModel
import datetime
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, User
from backend.arri import define_rpc

logger = logging.getLogger("SignUpRPC")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")

class RegisterUserParams(BaseModel):
    email: str
    password: str
    userName: Optional[str] = None

class RegisterUserResponse(BaseModel):
    success: bool
    message: str
    token: str = ""
    userId: str = ""
    userName: str = ""
    isEmailVerified: bool = False

@define_rpc(
    name="auth.signup",
    path="/rpc/auth/signup",
    params=RegisterUserParams,
    response=RegisterUserResponse,
)
async def signup(params: RegisterUserParams, request=None) -> RegisterUserResponse:
    try:
        user_id = str(uuid.uuid4())
        user_name = params.userName or params.email.split("@")[0]
        new_user = User(
            id=user_id,
            email_id=params.email,
            password=params.password,
            user_name=user_name,
        )
        with Session(engine) as session:
            session.add(new_user)
            session.commit()

        exp_time = int((datetime.datetime.utcnow() + datetime.timedelta(days=30)).timestamp())
        token = jwt.encode({"id": user_id, "email": params.email, "exp": exp_time}, JWT_SECRET, algorithm="HS256")
        return RegisterUserResponse(
            success=True,
            message="Registration successful",
            token=token,
            userId=user_id,
            userName=user_name,
            isEmailVerified=False
        )
    except Exception as e:
        logger.error(f"Register error: {e}")
        return RegisterUserResponse(success=False, message=f"Registration failed: {str(e)}")
