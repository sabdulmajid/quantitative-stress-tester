import { NextResponse } from "next/server";
import { getAuthenticatedSupabaseContext, mapStressRun } from "@/lib/server/persistence";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthenticatedSupabaseContext();

  if (!context.enabled) {
    return NextResponse.json({ error: "Supabase persistence is not configured" }, { status: 503 });
  }

  if (!context.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await context.supabase
    .from("stress_runs")
    .select("id, tickers, weights, horizon_days, seed, expected_return, var_95, elapsed_ms, created_at, provider, range")
    .eq("user_id", context.user.id)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    runs: (data ?? []).map(mapStressRun)
  });
}
