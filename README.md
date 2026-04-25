# Quant Stress Engine

Three-tier portfolio stress-testing application:

- `compute-engine/`: Python FastAPI service with JAX-powered fixed-shape Monte Carlo simulation
- `api-gateway/`: Go gateway exposing the public API surface and live market data aggregation
- `edge-ui/`: Next.js frontend for auth, portfolio selection, saved portfolios, run history, and histogram visualization
- `supabase/`: database migrations for persistence and row-level security

## Architecture

`edge-ui` -> `api-gateway` -> `compute-engine`

The compute tier simulates `100000` portfolio paths using vectorized GBM on padded arrays of size `50`, so the JAX/XLA graph can compile once on startup and reuse the same execution shape for live requests.
The gateway now derives annualized drift and covariance from real historical price data at request time, with a small in-memory cache to keep repeated runs fast.
The UI can run in guest mode, or use Supabase-backed auth and persistence for saved portfolios plus authenticated run history.

## API Contract

- Gateway health: `GET /health`
- Gateway supported tickers: `GET /api/v1/supported-tickers`
- Gateway stress route: `POST /api/v1/stress-test`
- UI persistence route: `GET|POST /api/v1/portfolio`
- UI run history route: `GET /api/v1/history`
- Compute health: `GET /health`
- Compute simulation route: `POST /simulate`

## Local Run

```bash
docker compose up --build
```

Service defaults:

- UI: `http://localhost:3000`
- Gateway: `http://localhost:8080`
- Compute: `http://localhost:8000`

## Repo Commands

```bash
make test
make lint
make build
make integration
make up
```

## Render Deploy

The repository now includes [render.yaml](/mnt/slurm_nfs/a6abdulm/projects/quant-stress-engine/render.yaml:1) with:

- `quant-stress-ui` as the public web service
- `quant-stress-gateway` as a private service
- `quant-stress-compute` as a private service

The UI proxies server-side to the gateway, so the browser never needs a direct public gateway URL.

## Supabase Setup

1. Create a Supabase project.
2. Apply [supabase/migrations/202604250001_quant_stress_engine.sql](/mnt/slurm_nfs/a6abdulm/projects/quant-stress-engine/supabase/migrations/202604250001_quant_stress_engine.sql:1).
3. Set these UI environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Enable email/password auth in Supabase Auth.
5. Add your deployed UI origin to the Supabase redirect URL allowlist, including `/auth/callback`.

Without those variables, the UI still works in guest mode and the stress engine remains usable.

## Notes

- The compute service prewarms its default 100,000-path shape on startup so the first live request does not pay the full XLA compile cost.
- `scripts/integration_smoke.py` validates the live ticker universe, warms the stack once, then asserts sub-second warm-path latency through the gateway.
- In this environment, JAX exposed only a CPU device. The simulation code is accelerator-friendly, but GPU deployment requires a GPU-capable JAX install and matching NVIDIA runtime.
- Environment variables are documented in each service directory and wired in `docker-compose.yml`.
