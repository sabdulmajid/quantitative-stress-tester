import type { AppUser, PortfolioSelection, SavedPortfolio, StressRunRecord } from "@/lib/types";
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

export async function getAuthenticatedSupabaseContext() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { enabled: false as const, supabase: null, user: null };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

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
  expected_return: number | null;
  var_95: number | null;
  elapsed_ms: number | null;
  created_at: string;
  provider: string | null;
  range: string | null;
}): StressRunRecord {
  return {
    id: row.id,
    tickers: row.tickers ?? [],
    weights: row.weights ?? [],
    horizon_days: row.horizon_days ?? 252,
    seed: row.seed ?? 42,
    expected_return: row.expected_return ?? 0,
    var_95: row.var_95 ?? 0,
    elapsed_ms: row.elapsed_ms ?? 0,
    created_at: row.created_at,
    provider: row.provider,
    range: row.range
  };
}
