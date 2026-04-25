# API Gateway

Go gateway service for the quant stress engine.

## Routes

- `GET /health`
- `GET /api/v1/supported-tickers`
- `POST /api/v1/stress-test`

## Request Shape

```json
{
  "tickers": ["AAPL", "MSFT", "SPY"],
  "weights": [50, 30, 20],
  "horizon_days": 252,
  "seed": 42
}
```

## Notes

- Supported tickers are currently: `AAPL`, `MSFT`, `TSLA`, `SPY`, `GLD`.
- `GET /api/v1/supported-tickers` returns the live UI contract, including provider metadata, cache TTL, and padded asset count.
- The gateway fetches real historical price data, computes annualized `mu` and `Sigma` from daily log returns, pads them to `50`, and proxies the request to `POST /simulate`.
- Historical series are cached in memory with a TTL to reduce repeat upstream requests.
- Upstream market-data fetches retry on transient `429` and `5xx` responses before failing the request.
- `net/http` handles incoming requests concurrently, and the cached series store is protected for safe shared reads and writes.

## Environment

```bash
COMPUTE_ENGINE_URL=http://localhost:8000
MARKET_DATA_BASE_URL=https://query1.finance.yahoo.com
MARKET_DATA_RANGE=3y
MARKET_DATA_CACHE_TTL=6h
```
