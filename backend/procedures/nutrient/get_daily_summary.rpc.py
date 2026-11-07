import logging
from typing import List
from pydantic import BaseModel
from sqlmodel import Session, select
from backend.db.sqlmodel_db import engine, FoodEntryModel
from backend.models import FoodEntryItem
from backend.arri import define_rpc

logger = logging.getLogger("GetDailySummaryRPC")

class EntriesByMeal(BaseModel):
    breakfast: List[FoodEntryItem] = []
    lunch: List[FoodEntryItem] = []
    dinner: List[FoodEntryItem] = []

class DailySummary(BaseModel):
    date: str
    totalCalories: float
    totalMass: float
    totalFats: float
    totalCarbs: float
    totalProteins: float
    totalEntries: int
    entriesByMeal: EntriesByMeal

class GetDailySummaryParams(BaseModel):
    userId: str
    date: str

class GetDailySummaryResponse(BaseModel):
    success: bool
    message: str
    summary: DailySummary

@define_rpc(
    name="nutrient.getDailySummary",
    path="/rpc/nutrient/getDailySummary",
    params=GetDailySummaryParams,
    response=GetDailySummaryResponse,
)
async def get_daily_summary(params: GetDailySummaryParams, request=None) -> GetDailySummaryResponse:
    try:
        with Session(engine) as session:
            statement = select(FoodEntryModel).where(FoodEntryModel.user_id == params.userId).order_by(FoodEntryModel.timestamp.asc())
            results = session.exec(statement).all()

        bf, lu, dn = [], [], []
        t_cal = t_mass = t_fats = t_carbs = t_prot = 0.0

        for r in results:
            item = FoodEntryItem(
                id=str(r.id),
                userId=str(r.user_id),
                mealType=str(r.meal_type or "breakfast"),
                timestamp=r.timestamp.isoformat() if r.timestamp else "",
                photoUrl=str(r.photo_url or ""),
                foodLabel=str(r.food_label or ""),
                classIndex=int(r.class_index or 0),
                confidence=float(r.confidence or 1.0),
                calories=float(r.calories or 0.0),
                mass=float(r.mass or 0.0),
                fats=float(r.fats or 0.0),
                carbs=float(r.carbs or 0.0),
                proteins=float(r.proteins or 0.0),
                createdAt=r.created_at.isoformat() if r.created_at else "",
            )
            t_cal += item.calories
            t_mass += item.mass
            t_fats += item.fats
            t_carbs += item.carbs
            t_prot += item.proteins

            if item.mealType == "breakfast":
                bf.append(item)
            elif item.mealType == "lunch":
                lu.append(item)
            else:
                dn.append(item)

        summary = DailySummary(
            date=params.date,
            totalCalories=t_cal,
            totalMass=t_mass,
            totalFats=t_fats,
            totalCarbs=t_carbs,
            totalProteins=t_prot,
            totalEntries=len(results),
            entriesByMeal=EntriesByMeal(breakfast=bf, lunch=lu, dinner=dn)
        )
        return GetDailySummaryResponse(success=True, message="Summary retrieved", summary=summary)
    except Exception as e:
        logger.error(f"Daily summary error: {e}")
        return GetDailySummaryResponse(
            success=False,
            message=f"Failed: {str(e)}",
            summary=DailySummary(date=params.date, totalCalories=0, totalMass=0, totalFats=0, totalCarbs=0, totalProteins=0, totalEntries=0, entriesByMeal=EntriesByMeal())
        )
