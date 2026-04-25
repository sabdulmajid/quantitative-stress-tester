import time

import jax.numpy as jnp

from app.models.stress import SimulationRequest, SimulationResponse
from app.services.gbm import simulate_portfolio_gbm, summarize_portfolio_returns


class StressService:
    def run(self, request: SimulationRequest) -> SimulationResponse:
        started_at = time.perf_counter()

        portfolio_returns = simulate_portfolio_gbm(
            padded_weights=jnp.asarray(request.padded_weights, dtype=jnp.float32),
            padded_mu=jnp.asarray(request.padded_mu, dtype=jnp.float32),
            padded_cov=jnp.asarray(request.padded_cov, dtype=jnp.float32),
            num_paths=request.num_paths,
            horizon=request.horizon_days,
            seed=request.seed,
        )

        expected_return, var_95, histogram = summarize_portfolio_returns(portfolio_returns)
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0

        return SimulationResponse(
            expected_return=expected_return,
            var_95=var_95,
            histogram=histogram,
            elapsed_ms=elapsed_ms,
        )
