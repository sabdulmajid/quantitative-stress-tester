from functools import partial

import jax
import jax.numpy as jnp

from app.models.stress import DEFAULT_PATHS, HISTOGRAM_BINS, MAX_ASSETS


_DIAGONAL_JITTER = 1e-6


def _single_path_portfolio_return(
    random_draws: jax.Array,
    padded_weights: jax.Array,
    padded_mu: jax.Array,
    cholesky: jax.Array,
    variances: jax.Array,
    horizon_years: jax.Array,
) -> jax.Array:
    drift = (padded_mu - 0.5 * variances) * horizon_years
    diffusion = jnp.sqrt(horizon_years) * (cholesky @ random_draws)
    terminal_growth = jnp.exp(drift + diffusion)
    return jnp.dot(padded_weights, terminal_growth - 1.0)


@partial(jax.jit, static_argnames=("num_paths",))
def simulate_portfolio_gbm(
    padded_weights: jax.Array,
    padded_mu: jax.Array,
    padded_cov: jax.Array,
    num_paths: int = DEFAULT_PATHS,
    horizon: int = 252,
    seed: int = 42,
) -> jax.Array:
    safe_cov = padded_cov + jnp.eye(MAX_ASSETS, dtype=jnp.float32) * _DIAGONAL_JITTER
    cholesky = jnp.linalg.cholesky(safe_cov)
    variances = jnp.diag(safe_cov)
    horizon_years = jnp.asarray(horizon / 252.0, dtype=jnp.float32)

    random_draws = jax.random.normal(
        jax.random.PRNGKey(seed),
        shape=(num_paths, MAX_ASSETS),
        dtype=jnp.float32,
    )

    return jax.vmap(
        _single_path_portfolio_return,
        in_axes=(0, None, None, None, None, None),
    )(random_draws, padded_weights, padded_mu, cholesky, variances, horizon_years)


def summarize_portfolio_returns(portfolio_returns: jax.Array) -> tuple[float, float, list[dict[str, float | int]]]:
    returns = jax.device_get(portfolio_returns)
    import numpy as np

    expected_return = float(np.mean(returns))
    var_cutoff = float(np.percentile(returns, 5))
    frequencies, edges = np.histogram(returns, bins=HISTOGRAM_BINS)

    histogram = [
        {
            "bin_start": float(edges[index]),
            "bin_end": float(edges[index + 1]),
            "frequency": int(frequencies[index]),
        }
        for index in range(HISTOGRAM_BINS)
    ]
    return expected_return, float(-var_cutoff), histogram


def prewarm_gbm_engine() -> None:
    padded_weights = jnp.zeros((MAX_ASSETS,), dtype=jnp.float32).at[0].set(1.0)
    padded_mu = jnp.zeros((MAX_ASSETS,), dtype=jnp.float32)
    padded_cov = jnp.eye(MAX_ASSETS, dtype=jnp.float32) * 0.04

    portfolio_returns = simulate_portfolio_gbm(
        padded_weights=padded_weights,
        padded_mu=padded_mu,
        padded_cov=padded_cov,
        num_paths=DEFAULT_PATHS,
        horizon=252,
        seed=0,
    )
    portfolio_returns.block_until_ready()
    summarize_portfolio_returns(portfolio_returns)
