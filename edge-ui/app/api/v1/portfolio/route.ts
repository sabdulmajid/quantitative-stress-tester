import { NextRequest, NextResponse } from "next/server";
import { normalizeSelections } from "@/lib/portfolio";
import { getAuthenticatedSupabaseContext, mapSavedPortfolio } from "@/lib/server/persistence";
import type { SavePortfolioRequest } from "@/lib/types";

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
    .from("saved_portfolios")
    .select("name, selections, updated_at")
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    portfolio: data ? mapSavedPortfolio(data) : null
  });
}

export async function POST(request: NextRequest) {
  const context = await getAuthenticatedSupabaseContext();

  if (!context.enabled) {
    return NextResponse.json({ error: "Supabase persistence is not configured" }, { status: 503 });
  }

  if (!context.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const payload = (await request.json()) as SavePortfolioRequest;
  const selections = normalizeSelections(payload.selections ?? []);

  if (selections.length === 0) {
    return NextResponse.json({ error: "At least one selection is required" }, { status: 400 });
  }

  const { data, error } = await context.supabase
    .from("saved_portfolios")
    .upsert(
      {
        user_id: context.user.id,
        name: (payload.name || "Default portfolio").trim() || "Default portfolio",
        selections
      },
      { onConflict: "user_id" }
    )
    .select("name, selections, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    portfolio: mapSavedPortfolio(data)
  });
}
