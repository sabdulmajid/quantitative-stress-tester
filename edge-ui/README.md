# edge-ui

Next.js + TypeScript + Tailwind frontend for the quant stress engine.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm start
```

## Environment

Set `API_GATEWAY_INTERNAL_URL` to the API gateway origin, for example:

```bash
API_GATEWAY_INTERNAL_URL=http://localhost:8080
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The browser uses same-origin Next.js routes:

- `GET /api/v1/history`
- `GET /api/v1/portfolio`
- `POST /api/v1/portfolio`
- `GET /api/v1/supported-tickers`
- `POST /api/v1/stress-test`
- `GET /auth/callback`

The stress routes proxy server-side to `API_GATEWAY_INTERNAL_URL`. The persistence routes use Supabase when its env vars are configured.

## Runtime Notes

- `npm start` serves the standalone production output created by `npm run build`.
- The app is pinned to Next.js `16.2.4` and audited clean for production dependencies in this workspace.
- The UI uses Zustand for portfolio state, debounced slider updates, Recharts for the 50-bin histogram view, and Supabase SSR auth when the public Supabase env vars are present.
- The supported ticker universe is fetched from the gateway at runtime instead of being hardcoded in the frontend bundle.
- Operators can choose 95% or 99% confidence, 1-day/10-day/1-year horizons, and a risk-free rate for Sharpe.
- The dashboard renders VaR, CVaR, annualized volatility, Sharpe, gateway telemetry, and a covariance-backed correlation heatmap.
- If Supabase is not configured, the UI falls back to guest mode while keeping the core stress workflow available.
