import type { AppUser, ConfidenceLevel, HorizonDays, PortfolioSelection, SavedPortfolio, StressRunRecord } from "@/lib/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function selectionsAreValid(selections: unknown): selections is PortfolioSelection[] {
  if (!Array.isArray(selections)) {
    return false;
  }

  return selections.every((selection) => {
    if (!selection || typeof selection !== "object") {
      return false;
    }

    const candidate = selection as { ticker?: unknown; weight?: unknown };
    return typeof candidate.ticker === "string" && typeof candidate.weight === "number";
  });
}

function bearerToken(authorizationHeader: string | null | undefined) {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function getAuthenticatedSupabaseContext(authorizationHeader?: string | null) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { enabled: false as const, supabase: null, user: null };
  }

  const token = bearerToken(authorizationHeader);
  const {
    data: { user }
  } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();

  if (!user) {
    return { enabled: true as const, supabase, user: null };
  }

  return {
    enabled: true as const,
    supabase,
    user: {
      id: user.id,
      email: user.email ?? null
    } satisfies AppUser
  };
}

export function mapSavedPortfolio(row: {
  name: string | null;
  selections: unknown;
  updated_at: string;
}): SavedPortfolio | null {
  if (!selectionsAreValid(row.selections)) {
    return null;
  }

  return {
    name: row.name || "Default portfolio",
    selections: row.selections,
    updated_at: row.updated_at
  };
}

export function mapStressRun(row: {
  id: string;
  tickers: string[] | null;
  weights: number[] | null;
  horizon_days: number | null;
  seed: number | null;
  confidence_level: number | null;
  risk_free_rate: number | null;
  expected_return: number | null;
  var_95: number | null;
  var_99: number | null;
  value_at_risk: number | null;
  cvar: number | null;
  annualized_volatility: number | null;
  sharpe_ratio: number | null;
  elapsed_ms: number | null;
  data_fetch_ms: number | null;
  total_roundtrip_ms: number | null;
  created_at: string;
  provider: string | null;
  range: string | null;
}): StressRunRecord {
  const confidenceLevel: ConfidenceLevel = row.confidence_level === 0.99 ? 0.99 : 0.95;
  const horizonDays: HorizonDays = row.horizon_days === 1 || row.horizon_days === 10 ? row.horizon_days : 252;

  return {
    id: row.id,
    tickers: row.tickers ?? [],
    weights: row.weights ?? [],
    horizon_days: horizonDays,
    seed: row.seed ?? 42,
    confidence_level: confidenceLevel,
    risk_free_rate: row.risk_free_rate ?? 0,
    expected_return: row.expected_return ?? 0,
    var_95: row.var_95 ?? 0,
    var_99: row.var_99 ?? row.var_95 ?? 0,
    value_at_risk: row.value_at_risk ?? row.var_95 ?? 0,
    cvar: row.cvar ?? 0,
    annualized_volatility: row.annualized_volatility ?? 0,
    sharpe_ratio: row.sharpe_ratio ?? 0,
    elapsed_ms: row.elapsed_ms ?? 0,
    data_fetch_ms: row.data_fetch_ms,
    total_roundtrip_ms: row.total_roundtrip_ms,
    created_at: row.created_at,
    provider: row.provider,
    range: row.range
  };
}
