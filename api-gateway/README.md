# API Gateway

Go gateway service for the quant stress engine.

## Routes

- `GET /health`
- `GET /metrics`
- `GET /api/v1/supported-tickers`
- `POST /api/v1/stress-test`

## Request Shape

```json
{
  "tickers": ["AAPL", "MSFT", "SPY"],
  "weights": [50, 30, 20],
  "horizon_days": 252,
  "confidence_level": 0.99,
  "risk_free_rate": 0.02,
  "seed": 42,
  "scenario_id": "financial_crisis_2008"
}
```

## Notes

- The gateway supports a 22-ticker universe and accepts up to 20 tickers per portfolio.
- Historical prices are fetched from Yahoo Finance with a bounded worker pool, jittered scheduling, exponential backoff, and `Retry-After` handling.
- Market data uses Redis when `REDIS_URL` is configured, with in-memory fallback. If Yahoo returns `429`, the gateway falls back to the last cached price series even when its freshness TTL has expired.
- `GET /api/v1/supported-tickers` returns the scenario catalog. `POST /api/v1/stress-test` applies the selected drift/covariance shock before padding.
- Stress responses include per-asset volatility contribution in `risk_contributions` without changing the fixed JAX payload.
- Every stress request emits structured `slog` telemetry for `compute_ms`, `data_fetch_ms`, and `total_roundtrip_ms`.
- Prometheus metrics are exposed at `/metrics`.

## Environment

```bash
COMPUTE_ENGINE_URL=http://localhost:8000
MARKET_DATA_BASE_URL=https://query1.finance.yahoo.com
MARKET_DATA_RANGE=3y
MARKET_DATA_CACHE_TTL=6h
MARKET_DATA_FETCH_WORKERS=2
MARKET_DATA_FETCH_MIN_WAIT=120ms
MARKET_DATA_FETCH_MAX_WAIT=320ms
REDIS_URL=redis://localhost:6379/0
```
