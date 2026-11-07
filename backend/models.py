from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class Vector3(BaseModel):
    x: float
    y: float
    z: float

class Rotation(BaseModel):
    bone: str
    x: float
    y: float
    z: float

class Bone(BaseModel):
    name: str
    rotation: Vector3
    position: Optional[Vector3] = None
    lockToFloor: Optional[bool] = None
    ikLegsEnabled: Optional[bool] = None
    ikArmsEnabled: Optional[bool] = None
    symmetricArmsEnabled: Optional[bool] = None
    symmetricLegsEnabled: Optional[bool] = None

class Observable(BaseModel):
    bone: str
    x: bool
    y: bool
    z: bool

class Audio(BaseModel):
    url: str
    rawUrl: str
    duration: float

class CheckPoint(BaseModel):
    id: str
    name: str
    timestamp: float
    rotations: List[Rotation]
    worldLandmarks: List[List[float]]
    observables: List[Observable]
    audio: Optional[Audio] = None
    verifyPose: bool
    accuracyThreshold: float

class YogaTutorial(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    videoUrl: str
    rawVideoUrl: str
    coverImageUrl: str
    duration: int
    createdAt: str
    updatedAt: Optional[str] = None
    checkpoints: List[CheckPoint] = []

class Pose(BaseModel):
    id: str
    name: str
    skeleton: List[Bone] = []
    lastDetectedPose: Optional[List[Bone]] = None
    createdAt: str
    updatedAt: str

class FoodEntryItem(BaseModel):
    id: str
    userId: str
    mealType: str
    timestamp: str
    photoUrl: str
    foodLabel: str
    classIndex: int
    confidence: float
    calories: float
    mass: float
    fats: float
    carbs: float
    proteins: float
    createdAt: str

class MusicTrack(BaseModel):
    id: str
    title: str
    artist: Optional[str] = "Unknown Artist"
    category: Optional[str] = "Meditation"
    audioUrl: str
    streamUrl: str
    coverImageUrl: Optional[str] = ""
    duration: float = 0.0
    isDefault: bool = False
    createdAt: str
    updatedAt: Optional[str] = None


