alter table public.stress_runs
  add column if not exists confidence_level double precision not null default 0.95,
  add column if not exists risk_free_rate double precision not null default 0,
  add column if not exists var_99 double precision not null default 0,
  add column if not exists value_at_risk double precision not null default 0,
  add column if not exists cvar double precision not null default 0,
  add column if not exists annualized_volatility double precision not null default 0,
  add column if not exists sharpe_ratio double precision not null default 0,
  add column if not exists data_fetch_ms double precision,
  add column if not exists total_roundtrip_ms double precision;

update public.stress_runs
set value_at_risk = var_95
where value_at_risk = 0 and var_95 <> 0;
