import logging
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, FoodEntryModel
from backend.arri import define_rpc

logger = logging.getLogger("DeleteFoodEntryRPC")

class DeleteFoodEntryParams(BaseModel):
    id: str

class DeleteFoodEntryResponse(BaseModel):
    success: bool
    message: str

@define_rpc(
    name="nutrient.deleteFoodEntry",
    path="/rpc/nutrient/deleteFoodEntry",
    params=DeleteFoodEntryParams,
    response=DeleteFoodEntryResponse,
)
async def delete_food_entry(params: DeleteFoodEntryParams, request=None) -> DeleteFoodEntryResponse:
    try:
        with Session(engine) as session:
            statement = select(FoodEntryModel).where(FoodEntryModel.id == params.id)
            entry = session.exec(statement).first()
            if entry:
                session.delete(entry)
                session.commit()
        return DeleteFoodEntryResponse(success=True, message="Food entry deleted")
    except Exception as e:
        logger.error(f"Delete food entry error: {e}")
        return DeleteFoodEntryResponse(success=False, message=f"Failed: {str(e)}")
