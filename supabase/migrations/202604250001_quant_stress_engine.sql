create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.saved_portfolios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Default portfolio',
  selections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists saved_portfolios_set_updated_at on public.saved_portfolios;
create trigger saved_portfolios_set_updated_at
before update on public.saved_portfolios
for each row
execute function public.set_updated_at();

create table if not exists public.stress_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tickers text[] not null default '{}',
  weights double precision[] not null default '{}',
  horizon_days integer not null default 252,
  seed bigint not null default 42,
  expected_return double precision not null,
  var_95 double precision not null,
  elapsed_ms double precision not null,
  histogram jsonb not null default '[]'::jsonb,
  provider text,
  range text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists stress_runs_user_created_at_idx
on public.stress_runs (user_id, created_at desc);

alter table public.saved_portfolios enable row level security;
alter table public.stress_runs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.saved_portfolios to authenticated;
grant select, insert, delete on public.stress_runs to authenticated;

drop policy if exists "saved_portfolios_select_own" on public.saved_portfolios;
create policy "saved_portfolios_select_own"
on public.saved_portfolios
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "saved_portfolios_insert_own" on public.saved_portfolios;
create policy "saved_portfolios_insert_own"
on public.saved_portfolios
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "saved_portfolios_update_own" on public.saved_portfolios;
create policy "saved_portfolios_update_own"
on public.saved_portfolios
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved_portfolios_delete_own" on public.saved_portfolios;
create policy "saved_portfolios_delete_own"
on public.saved_portfolios
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "stress_runs_select_own" on public.stress_runs;
create policy "stress_runs_select_own"
on public.stress_runs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "stress_runs_insert_own" on public.stress_runs;
create policy "stress_runs_insert_own"
on public.stress_runs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "stress_runs_delete_own" on public.stress_runs;
create policy "stress_runs_delete_own"
on public.stress_runs
for delete
to authenticated
using (auth.uid() = user_id);
