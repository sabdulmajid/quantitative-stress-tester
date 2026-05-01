import time

import jax.numpy as jnp

from app.models.stress import SimulationRequest, SimulationResponse
from app.services.gbm import compute_portfolio_risk_metrics, simulate_portfolio_gbm, summarize_portfolio_returns


class StressService:
    def run(self, request: SimulationRequest) -> SimulationResponse:
        started_at = time.perf_counter()
        padded_weights = jnp.asarray(request.padded_weights, dtype=jnp.float32)
        padded_mu = jnp.asarray(request.padded_mu, dtype=jnp.float32)
        padded_cov = jnp.asarray(request.padded_cov, dtype=jnp.float32)

        portfolio_returns = simulate_portfolio_gbm(
            padded_weights=padded_weights,
            padded_mu=padded_mu,
            padded_cov=padded_cov,
            num_paths=request.num_paths,
            horizon=request.horizon_days,
            seed=request.seed,
        )

        expected_return, var_95, var_99, value_at_risk, cvar, histogram = summarize_portfolio_returns(
            portfolio_returns,
            confidence_level=request.confidence_level,
        )
        annualized_volatility, sharpe_ratio = compute_portfolio_risk_metrics(
            padded_weights=padded_weights,
            padded_mu=padded_mu,
            padded_cov=padded_cov,
            risk_free_rate=request.risk_free_rate,
        )
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0

        return SimulationResponse(
            expected_return=expected_return,
            var_95=var_95,
            var_99=var_99,
            value_at_risk=value_at_risk,
            cvar=cvar,
            annualized_volatility=annualized_volatility,
            sharpe_ratio=sharpe_ratio,
            confidence_level=request.confidence_level,
            histogram=histogram,
            elapsed_ms=elapsed_ms,
        )
