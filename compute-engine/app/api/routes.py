from fastapi import APIRouter

from app.models.stress import SimulationRequest, SimulationResponse
from app.services.stress_service import StressService


router = APIRouter()
service = StressService()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/simulate", response_model=SimulationResponse)
def run_simulation(request: SimulationRequest) -> SimulationResponse:
    return service.run(request)
