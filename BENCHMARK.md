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
wrk -t2 -c4 -d20s --timeout 10s --latency \
  -s scripts/wrk_stress_post.lua \
  http://127.0.0.1:8080/api/v1/stress-test
```

The relative script path points to the committed `wrk` POST payload helper used for reproducible local load testing.

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

## Production Verification

Date: 2026-05-23

Host: Render production gateway endpoint. The run did not use privileged Render API access, so it could not force an idle cold start or verify backend logs. The first request is therefore a current-state first request, not a true redeploy or idle cold-start sample.

Payload: 20 tickers, equal weights, `100000` Monte Carlo paths, `252` day horizon, `0.99` confidence, `0.02` risk-free rate, `financial_crisis_2008` scenario, seed `42`.

Current first request:

| Client RTT | Gateway processing | Market data fetch | JAX compute | Histogram bins | Risk contributions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| `670.57 ms` | `439.47 ms` | `82.07 ms` | `116.10 ms` | `50` | `20` |

Ten-run warm live profile:

| Run | Client RTT | Gateway processing | Market data fetch | JAX compute |
| ---: | ---: | ---: | ---: | ---: |
| 1 | `507.20 ms` | `269.78 ms` | `100.08 ms` | `141.41 ms` |
| 2 | `500.63 ms` | `379.35 ms` | `200.91 ms` | `151.68 ms` |
| 3 | `496.84 ms` | `353.23 ms` | `78.01 ms` | `247.72 ms` |
| 4 | `496.02 ms` | `353.95 ms` | `85.92 ms` | `239.04 ms` |
| 5 | `599.38 ms` | `474.87 ms` | `200.89 ms` | `233.60 ms` |
| 6 | `633.09 ms` | `506.67 ms` | `201.84 ms` | `244.69 ms` |
| 7 | `571.29 ms` | `441.27 ms` | `186.88 ms` | `229.00 ms` |
| 8 | `494.31 ms` | `368.02 ms` | `97.99 ms` | `242.92 ms` |
| 9 | `401.50 ms` | `289.61 ms` | `29.99 ms` | `151.28 ms` |
| 10 | `497.33 ms` | `352.13 ms` | `90.63 ms` | `234.78 ms` |

Warm-path small-sample estimates from 10 sequential requests:

| Metric | p50 | p95 estimate | p99 estimate | Mean | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Client RTT | `498.98 ms` | `617.92 ms` | `630.06 ms` | `519.76 ms` | `401.50 ms` | `633.09 ms` |
| Gateway processing | `360.99 ms` | `492.36 ms` | `503.81 ms` | `378.89 ms` | `269.78 ms` | `506.67 ms` |
| Market data fetch | `99.03 ms` | `201.42 ms` | `201.76 ms` | `127.31 ms` | `29.99 ms` | `201.84 ms` |
| JAX compute | `234.19 ms` | `246.36 ms` | `247.45 ms` | `211.61 ms` | `141.41 ms` | `247.72 ms` |

Cache behavior is inferred from gateway telemetry only. Market-data fetch time remained below `202 ms` for all warm requests, which is consistent with cached or otherwise warmed data, but Redis/Key Value usage must be confirmed from Render logs or service metrics with rotated admin credentials.
