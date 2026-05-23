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
| `504.21 ms` | `276.57 ms` | `110.48 ms` | `137.33 ms` | `50` | `20` |

Ten-run warm live profile:

| Run | Client RTT | Gateway processing | Market data fetch | JAX compute |
| ---: | ---: | ---: | ---: | ---: |
| 1 | `398.95 ms` | `278.11 ms` | `107.70 ms` | `142.39 ms` |
| 2 | `396.30 ms` | `289.44 ms` | `126.62 ms` | `135.44 ms` |
| 3 | `400.83 ms` | `291.85 ms` | `118.34 ms` | `146.45 ms` |
| 4 | `395.97 ms` | `288.49 ms` | `117.37 ms` | `52.15 ms` |
| 5 | `407.42 ms` | `286.49 ms` | `109.05 ms` | `149.13 ms` |
| 6 | `588.41 ms` | `353.48 ms` | `177.30 ms` | `148.93 ms` |
| 7 | `402.57 ms` | `285.09 ms` | `111.28 ms` | `144.98 ms` |
| 8 | `396.44 ms` | `271.44 ms` | `106.25 ms` | `137.80 ms` |
| 9 | `491.15 ms` | `381.95 ms` | `119.39 ms` | `235.38 ms` |
| 10 | `399.95 ms` | `290.72 ms` | `122.15 ms` | `141.20 ms` |

Warm-path small-sample estimates from 10 sequential requests:

| Metric | p50 | p95 estimate | p99 estimate | Mean | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Client RTT | `400.39 ms` | `544.64 ms` | `579.66 ms` | `427.80 ms` | `395.97 ms` | `588.41 ms` |
| Gateway processing | `288.97 ms` | `369.14 ms` | `379.39 ms` | `301.71 ms` | `271.44 ms` | `381.95 ms` |
| Market data fetch | `117.86 ms` | `154.49 ms` | `172.74 ms` | `121.55 ms` | `106.25 ms` | `177.30 ms` |
| JAX compute | `143.69 ms` | `196.57 ms` | `227.62 ms` | `143.38 ms` | `52.15 ms` | `235.38 ms` |

Cache behavior is inferred from gateway telemetry only. Market-data fetch time remained below `178 ms` for all warm requests, which is consistent with cached or otherwise warmed data, but Redis/Key Value usage must be confirmed from Render logs or service metrics with rotated admin credentials.
