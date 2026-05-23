# AGENTS.md

## Master Agent
- Owns cross-service architecture, interface control, validation, and deployment readiness.
- Defines the fixed-shape execution contract shared across compute, gateway, and UI.
- Coordinates service-owned work and resolves drift between gateway, compute, UI, persistence, and deployment layers.

## Subagent A: Compute Engineer
- Scope: `compute-engine/`
- Stack: Python, FastAPI, JAX
- Responsibilities:
  - Implement a FastAPI server wrapping a JAX-compiled Monte Carlo simulation.
  - Enforce static-shape padding so XLA compiles exactly once on startup.
  - Pad all covariance matrices to `50 x 50` and operate on padded weights and mean-return vectors of length `50`.
  - Implement `simulate_portfolio_gbm(padded_weights, padded_mu, padded_cov, num_paths=100000, horizon=252)`.
  - Use Cholesky decomposition of the padded covariance matrix.
  - Use `jax.vmap` across the path dimension and `jax.jit` over the simulation.
  - Expose `POST /simulate` returning expected return, 95%/99% VaR, selected confidence VaR, CVaR, annualized volatility, Sharpe ratio, elapsed time, and exactly `50` histogram bins.

## Subagent B: Systems Gateway
- Scope: `api-gateway/`
- Stack: Go
- Responsibilities:
  - Build a highly concurrent native controller on port `8080`.
  - Receive standard HTTP requests from the frontend.
  - Fetch real historical price data for the `22` supported symbols exposed by `GET /api/v1/supported-tickers`.
  - Use Render Key Value or another Redis-compatible cache for shared market-data caching when configured, with an in-memory fallback for local and degraded operation.
  - Derive annualized `mu` and covariance `Sigma` from aligned daily log returns.
  - Extract the relevant subvector and submatrix for up to `20` requested tickers.
  - Apply gateway-owned macroeconomic scenario shocks to drift and covariance before fixed-shape padding.
  - Calculate per-asset contribution to total volatility without changing the JAX compute contract.
  - Pad weights and `mu` to length `50` and `Sigma` to `50 x 50`.
  - Proxy the padded execution payload to the JAX worker.
  - Expose `GET /api/v1/supported-tickers` with provider, range, cache, selection-limit, padding, ticker, and scenario metadata.
  - Expose `POST /api/v1/stress-test` with VaR, CVaR, volatility, Sharpe, scenario, attribution, matrix, histogram, and timing fields.

## Subagent C: Frontend Developer
- Scope: `edge-ui/`
- Stack: Next.js App Router, TypeScript, Tailwind
- Responsibilities:
  - Scaffold the operator UI with a Zustand store.
  - Manage portfolio weights through debounced inputs.
  - Discover the supported ticker universe from the gateway instead of hardcoding it in the bundle.
  - Provide a portfolio editor for up to `20` tickers while preserving the `50`-asset execution payload downstream.
  - Render the histogram using a React charting library such as Recharts.
  - Color the selected lower-tail histogram region red to indicate VaR.
  - Display risk attribution, scenario selection, covariance/correlation matrices, authenticated history, and structured run export.
  - Connect the UI to the Go gateway at `localhost:8080` in local development.

## Subagent D: DevOps and QA
- Scope: repo root and deployment assets
- Responsibilities:
  - Generate deployment-oriented Dockerfiles for the Go and Python services suitable for Render.
  - Maintain `docker-compose.yml` for local end-to-end startup.
  - Write an integration test script that verifies sub-second execution time after the initial XLA warmup.
  - Validate the end-to-end request path across the UI, gateway, and compute tiers.

## Shared Contract
- Compute health: `GET /health`
- Compute simulation: `POST /simulate`
- Gateway health: `GET /health`
- Gateway supported tickers: `GET /api/v1/supported-tickers`
- Gateway public API: `POST /api/v1/stress-test`
- UI BFF supported tickers: `GET /api/v1/supported-tickers`
- UI BFF public API: `POST /api/v1/stress-test`
- UI persistence: `GET|POST /api/v1/portfolio`, `GET /api/v1/history`
- Fixed dimensions:
  - weights: `50`
  - mu: `50`
  - covariance: `50 x 50`
  - histogram bins: `50`
  - Monte Carlo paths: `100000`
- Gateway maximum live portfolio selection: `20`
- Gateway supported ticker universe: `22`

## Coordination Rules
- Each subagent edits only its assigned directory unless the Master Agent reassigns ownership.
- Shared payload changes must be reflected across all affected tiers before merge.
- No subagent may revert another agent's work without explicit approval.
- Startup warmup must compile the exact fixed-shape JAX path used for live requests.
