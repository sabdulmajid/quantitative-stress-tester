# Supabase

This directory contains the persistence schema for the web application.

## Apply

Run the migration in [migrations/202604250001_quant_stress_engine.sql](/mnt/slurm_nfs/a6abdulm/projects/quant-stress-engine/supabase/migrations/202604250001_quant_stress_engine.sql:1) against your Supabase project.

## What It Creates

- `saved_portfolios`
- `stress_runs`
- row-level security policies scoped to `auth.uid()`

## Required UI Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```
