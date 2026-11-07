import logging
import os
import jwt
from pydantic import BaseModel
import datetime
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, User
from backend.arri import define_rpc

logger = logging.getLogger("SignInRPC")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")

class LoginUserParams(BaseModel):
    email: str
    password: str

class LoginUserResponse(BaseModel):
    success: bool
    message: str
    token: str = ""
    userId: str = ""
    userName: str = ""
    isEmailVerified: bool = False

@define_rpc(
    name="auth.signin",
    path="/rpc/auth/signin",
    params=LoginUserParams,
    response=LoginUserResponse,
)
async def signin(params: LoginUserParams, request=None) -> LoginUserResponse:
    try:
        with Session(engine) as session:
            statement = select(User).where(User.email_id == params.email)
            user = session.exec(statement).first()

            if not user or user.password != params.password:
                return LoginUserResponse(success=False, message="Invalid email or password")

            user_id = str(user.id)
            user_name = user.user_name or ""
            is_email_verified = user.is_email_verified

        exp_time = int((datetime.datetime.utcnow() + datetime.timedelta(days=30)).timestamp())
        token = jwt.encode({"id": user_id, "email": params.email, "exp": exp_time}, JWT_SECRET, algorithm="HS256")

        return LoginUserResponse(
            success=True,
            message="Login successful",
            token=token,
            userId=user_id,
            userName=user_name,
            isEmailVerified=is_email_verified
        )
    except Exception as e:
        logger.error(f"Login error: {e}")
        return LoginUserResponse(success=False, message=f"Login failed: {str(e)}")
