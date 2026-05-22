alter table public.stress_runs
  add column if not exists scenario_id text not null default 'baseline',
  add column if not exists scenario_label text,
  add column if not exists risk_contributions jsonb not null default '[]'::jsonb;
