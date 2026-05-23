# Deployment

This project deploys as three Render web services plus one Render Key Value instance. The current production services are public `onrender.com` web services; do not describe them as private network endpoints unless the Render service type is changed and verified.

## Render Topology

| Resource | Type | Runtime | Purpose |
| --- | --- | --- | --- |
| `quant-stress-ui` | Web service | Docker, Next.js standalone | Public operator UI and BFF routes. |
| `quant-stress-gateway` | Web service | Docker, Go | Public API gateway, market-data enrichment, cache use, compute proxy, and metrics. |
| `quant-stress-compute` | Web service | Docker, FastAPI/JAX | Fixed-shape Monte Carlo worker. |
| `quant-stress-redis` | Key Value | Redis-compatible protocol | Shared market-data cache for gateway instances. |

[render.yaml](render.yaml) is the repository deployment specification. It intentionally contains environment variable names and service wiring only, not secret values.

## Environment Variables

Set deployment values in Render or through a secret manager. Do not commit concrete values.

| Service | Variable | Required | Notes |
| --- | --- | --- | --- |
| Compute | `PORT` | No | Render injects a port; the Dockerfile defaults are suitable for local use. |
| Compute | `PYTHONUNBUFFERED` | No | Keeps application logs streaming promptly. |
| Gateway | `PORT` | No | HTTP listen port. |
| Gateway | `REQUEST_TIMEOUT` | No | Upstream and request timeout duration. |
| Gateway | `MARKET_DATA_BASE_URL` | No | Yahoo Finance chart API base URL. |
| Gateway | `MARKET_DATA_RANGE` | No | Historical lookback window. |
| Gateway | `MARKET_DATA_CACHE_TTL` | No | Cache freshness window. |
| Gateway | `MARKET_DATA_FETCH_WORKERS` | No | Bounded worker count for cold market-data fetches. |
| Gateway | `MARKET_DATA_FETCH_MIN_WAIT` | No | Lower jitter bound between cold fetches. |
| Gateway | `MARKET_DATA_FETCH_MAX_WAIT` | No | Upper jitter bound between cold fetches. |
| Gateway | `REDIS_URL` | Recommended | Render Key Value connection string. If absent, the gateway falls back to in-memory cache. |
| Gateway | `COMPUTE_ENGINE_URL` | Yes | Compute service origin used by the gateway. |
| UI | `PORT` | No | Next.js standalone listen port. |
| UI | `NODE_ENV` | No | Production mode on Render. |
| UI | `NEXT_TELEMETRY_DISABLED` | No | Disables Next.js telemetry. |
| UI | `API_GATEWAY_INTERNAL_URL` | Yes | Gateway origin used by BFF routes. |
| UI | `NEXT_PUBLIC_SUPABASE_URL` | Optional | Enables Supabase auth and persistence when paired with a publishable key. |
| UI | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional | Supabase browser and SSR publishable key. |

## Render Key Value

Provision `quant-stress-redis` as Render Key Value in the same region as the gateway. The gateway uses the Redis-compatible URL from `REDIS_URL`; if this variable is missing or invalid, requests still succeed with process-local memory cache, but cache data is not shared across instances or restarts.

Verification checklist:

- Confirm the Key Value instance status is available.
- Confirm `REDIS_URL` is set on the gateway without printing the value.
- Confirm gateway logs have no invalid Redis URL or cache store failures.
- Confirm market-data fetch latency is lower on repeated requests than on cold fetches.

## Supabase

Apply migrations in filename order:

1. `supabase/migrations/202604250001_quant_stress_engine.sql`
2. `supabase/migrations/202605010001_analytics_expansion.sql`
3. `supabase/migrations/202605220001_scenario_risk_attribution.sql`

The migrations create saved portfolios, stress-run history, analytics columns, scenario metadata fields, and risk-attribution JSON. RLS policies restrict authenticated users to their own rows.

Auth checklist:

- Enable email/password auth.
- Set the production Site URL to the UI origin.
- Add the UI callback route to the redirect allowlist.
- Create or verify the smoke-test user through a server-side admin script that reads the service role key from environment only.
- Never commit service role keys, database URLs, test passwords, or generated admin output.

The application uses Supabase SSR clients for persistence and does not require a direct Postgres client in UI code. Use direct database URLs only for migrations. If a pooler URL is introduced for application code later, verify the client does not depend on session-level prepared statements.

## Smoke Tests

Local:

```bash
make test
make lint
make build
make integration
```

Production guest smoke:

```bash
UI_URL=https://quant-stress-ui.onrender.com \
GATEWAY_URL=https://quant-stress-gateway.onrender.com \
COMPUTE_URL=https://quant-stress-compute.onrender.com \
python scripts/integration_smoke.py
```

Production authenticated smoke requires Supabase variables and test credentials to be supplied by the runtime environment. Do not paste or store those values in shell history, docs, or committed files.

```bash
REQUIRE_AUTH_FLOW=1 \
UI_URL=https://quant-stress-ui.onrender.com \
GATEWAY_URL=https://quant-stress-gateway.onrender.com \
COMPUTE_URL=https://quant-stress-compute.onrender.com \
NEXT_PUBLIC_SUPABASE_URL=[REDACTED] \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[REDACTED] \
SUPABASE_TEST_EMAIL=[REDACTED] \
SUPABASE_TEST_PASSWORD=[REDACTED] \
python scripts/integration_smoke.py
```

## Rollback

Use Render's deployment history to roll back a service to the last known good deploy. Roll back the gateway and compute together if the request or response contract changes. Roll back UI independently only when BFF route contracts remain compatible.

After rollback:

- Run service health checks.
- Run a guest-mode stress request through the UI BFF.
- Run authenticated persistence smoke if rotated Supabase credentials are available.
- Check gateway metrics and logs for 5xx responses, compute errors, and cache failures.

## Known Limitations

- Current production services are public web services, not private Render services.
- Free-tier Render services can cold start after idle periods. Benchmark warm-path latency separately from first request after idle or redeploy.
- Render Key Value verification requires Render admin credentials or dashboard access.
- Supabase Auth redirect and test-user verification require Supabase admin credentials or dashboard access.
- Gateway `/metrics` is publicly reachable in the current deployment. Restrict it before using this deployment for sensitive workloads.
