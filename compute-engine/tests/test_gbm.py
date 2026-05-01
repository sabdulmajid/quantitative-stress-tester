import math

import jax.numpy as jnp

from app.models.stress import DEFAULT_PATHS, HISTOGRAM_BINS, MAX_ASSETS
from app.services.gbm import compute_portfolio_risk_metrics, simulate_portfolio_gbm, summarize_portfolio_returns


def test_gbm_engine_uses_fixed_shape_padding() -> None:
    padded_weights = jnp.zeros((MAX_ASSETS,), dtype=jnp.float32).at[0].set(0.6).at[1].set(0.4)
    padded_mu = jnp.zeros((MAX_ASSETS,), dtype=jnp.float32).at[0].set(0.12).at[1].set(0.08)
    padded_cov = jnp.eye(MAX_ASSETS, dtype=jnp.float32) * 0.02
    padded_cov = padded_cov.at[0, 1].set(0.006).at[1, 0].set(0.006)

    portfolio_returns = simulate_portfolio_gbm(
        padded_weights=padded_weights,
        padded_mu=padded_mu,
        padded_cov=padded_cov,
        num_paths=DEFAULT_PATHS,
        horizon=252,
        seed=13,
    )

    assert portfolio_returns.shape == (DEFAULT_PATHS,)
    assert portfolio_returns.dtype.name == "float32"

    expected_return, var_95, var_99, value_at_risk, cvar, histogram = summarize_portfolio_returns(
        portfolio_returns,
        confidence_level=0.99,
    )
    assert math.isfinite(expected_return)
    assert var_95 >= 0
    assert var_99 >= var_95
    assert value_at_risk == var_99
    assert cvar >= value_at_risk
    assert len(histogram) == HISTOGRAM_BINS
    assert sum(bin_record["frequency"] for bin_record in histogram) == DEFAULT_PATHS

    annualized_volatility, sharpe_ratio = compute_portfolio_risk_metrics(
        padded_weights=padded_weights,
        padded_mu=padded_mu,
        padded_cov=padded_cov,
        risk_free_rate=0.02,
    )
    assert annualized_volatility > 0
    assert math.isfinite(sharpe_ratio)
