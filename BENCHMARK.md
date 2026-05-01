# Benchmark

Date: 2026-05-01

Host: local Linux CPU environment with the compute engine, gateway, and Next.js standalone server running on localhost. Redis was not available as a local daemon in this shell, so the gateway used its in-memory fallback cache. Market data was warmed before load testing.

Payload: 20 tickers, equal weights, `100000` Monte Carlo paths, `252` day horizon, `0.99` confidence, `0.02` risk-free rate.

## Smoke

```bash
GATEWAY_URL=http://127.0.0.1:8080 \
COMPUTE_URL=http://127.0.0.1:8000 \
UI_URL=http://127.0.0.1:3002 \
WARM_THRESHOLD_MS=1000 \
python scripts/integration_smoke.py
```

Result:

```json
{
  "warmup_http_ms": 166.62,
  "warm_http_ms": 128.59,
  "warm_compute_ms": 112.84,
  "data_fetch_ms": 10.31,
  "total_roundtrip_ms": 127.45,
  "ticker_universe_http_ms": 0.82,
  "authenticated_ui_flow": "skipped:no-supabase-credentials",
  "ticker_count": 20,
  "confidence_level": 0.99
}
```

## wrk

Command:

```bash
/tmp/wrk/wrk -t2 -c4 -d20s --timeout 10s --latency \
  -s /tmp/quant_stress_post.lua \
  http://127.0.0.1:8080/api/v1/stress-test
```

Result:

```text
Latency   390.93ms avg, 44.37ms stdev, 495.06ms max
50%       397.61ms
75%       414.19ms
90%       440.95ms
99%       476.46ms
203 requests in 20.07s
Requests/sec: 10.12
Errors: 0
```

## p95

`wrk` does not print p95 in its default latency report, so a Python concurrency harness was run with the same warmed 20-ticker payload and 4 workers.

```json
{
  "requests": 120,
  "errors": 0,
  "elapsed_s": 11.93,
  "rps": 10.06,
  "p50_ms": 391.58,
  "p95_ms": 470.28,
  "p99_ms": 570.07,
  "avg_ms": 395.72,
  "max_ms": 603.97
}
```

## Stress Note

A `wrk -t4 -c16 -d20s` run pushed the local CPU-bound compute path to the gateway timeout edge: throughput stayed near `10.16 req/s`, p99 was `1.98s`, and `wrk` reported 15 client-side timeouts with its default 2 second timeout. The c4 run above is the stable local benchmark profile for this CPU environment.
