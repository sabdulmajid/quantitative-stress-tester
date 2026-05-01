from typing import Literal

from pydantic import BaseModel, Field, PositiveInt, field_validator


MAX_ASSETS = 50
DEFAULT_PATHS = 100_000
HISTOGRAM_BINS = 50


class HistogramBin(BaseModel):
    bin_start: float
    bin_end: float
    frequency: int = Field(..., ge=0)


class SimulationRequest(BaseModel):
    padded_weights: list[float]
    padded_mu: list[float]
    padded_cov: list[list[float]]
    num_paths: Literal[DEFAULT_PATHS] = DEFAULT_PATHS
    horizon_days: PositiveInt = Field(default=252)
    confidence_level: float = Field(default=0.95)
    risk_free_rate: float = Field(default=0.0)
    seed: int = Field(default=42)

    @field_validator("padded_weights", "padded_mu")
    @classmethod
    def validate_vector_length(cls, value: list[float]) -> list[float]:
        if len(value) != MAX_ASSETS:
            raise ValueError(f"expected exactly {MAX_ASSETS} values")
        return value

    @field_validator("padded_cov")
    @classmethod
    def validate_covariance_shape(cls, value: list[list[float]]) -> list[list[float]]:
        if len(value) != MAX_ASSETS:
            raise ValueError(f"expected exactly {MAX_ASSETS} covariance rows")
        if any(len(row) != MAX_ASSETS for row in value):
            raise ValueError(f"expected covariance rows of length {MAX_ASSETS}")
        return value

    @field_validator("confidence_level")
    @classmethod
    def validate_confidence_level(cls, value: float) -> float:
        if value not in (0.95, 0.99):
            raise ValueError("confidence_level must be 0.95 or 0.99")
        return value


class SimulationResponse(BaseModel):
    expected_return: float
    var_95: float
    var_99: float
    value_at_risk: float
    cvar: float
    annualized_volatility: float
    sharpe_ratio: float
    confidence_level: float
    elapsed_ms: float
    histogram: list[HistogramBin] = Field(min_length=HISTOGRAM_BINS, max_length=HISTOGRAM_BINS)
