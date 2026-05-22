# Supabase

This directory contains the persistence schema for the web application.

## Apply

Run every migration in [migrations](migrations) against your Supabase project in filename order.

## What It Creates

- `saved_portfolios`
- `stress_runs`
- analytics columns for VaR, CVaR, volatility, Sharpe, scenario metadata, risk attribution, and timing telemetry
- row-level security policies scoped to `auth.uid()`

## Required UI Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```
