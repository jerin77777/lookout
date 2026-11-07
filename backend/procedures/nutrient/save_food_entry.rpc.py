import logging
import uuid
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from sqlmodel import Session
from backend.db.sqlmodel_db import engine, FoodEntryModel
from backend.models import FoodEntryItem
from backend.arri import define_rpc

logger = logging.getLogger("SaveFoodEntryRPC")

class SaveFoodEntryParams(BaseModel):
    userId: str
    mealType: str
    photoUrl: str
    foodLabel: str
    classIndex: int
    confidence: float
    calories: float
    mass: float
    fats: float
    carbs: float
    proteins: float

class SaveFoodEntryResponse(BaseModel):
    success: bool
    message: str
    entry: Optional[FoodEntryItem] = None

@define_rpc(
    name="nutrient.saveFoodEntry",
    path="/rpc/nutrient/saveFoodEntry",
    params=SaveFoodEntryParams,
    response=SaveFoodEntryResponse,
)
async def save_food_entry(params: SaveFoodEntryParams, request=None) -> SaveFoodEntryResponse:
    try:
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow()
        new_entry = FoodEntryModel(
            id=entry_id,
            user_id=params.userId,
            meal_type=params.mealType,
            timestamp=now,
            photo_url=params.photoUrl,
            food_label=params.foodLabel,
            class_index=params.classIndex,
            confidence=params.confidence,
            calories=params.calories,
            mass=params.mass,
            fats=params.fats,
            carbs=params.carbs,
            proteins=params.proteins,
            created_at=now,
        )
        with Session(engine) as session:
            session.add(new_entry)
            session.commit()

        entry = FoodEntryItem(
            id=entry_id,
            userId=params.userId,
            mealType=params.mealType,
            timestamp=now.isoformat(),
            photoUrl=params.photoUrl,
            foodLabel=params.foodLabel,
            classIndex=params.classIndex,
            confidence=params.confidence,
            calories=params.calories,
            mass=params.mass,
            fats=params.fats,
            carbs=params.carbs,
            proteins=params.proteins,
            createdAt=now.isoformat()
        )
        return SaveFoodEntryResponse(success=True, message="Food entry saved", entry=entry)
    except Exception as e:
        logger.error(f"Save food entry error: {e}")
        return SaveFoodEntryResponse(success=False, message=f"Failed: {str(e)}")
        return SaveFoodEntryResponse(success=False, message=f"Failed: {str(e)}")
