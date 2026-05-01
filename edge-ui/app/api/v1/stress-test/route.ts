import { NextRequest, NextResponse } from "next/server";
import { getGatewayBaseUrl } from "@/lib/server/gateway";
import { getAuthenticatedSupabaseContext } from "@/lib/server/persistence";
import type { StressTestRequest, StressTestResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const gatewayBaseUrl = getGatewayBaseUrl();
  const payload = (await request.json()) as StressTestRequest;
  const body = JSON.stringify(payload);

  const upstream = await fetch(`${gatewayBaseUrl}/api/v1/stress-test`, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("content-type") ?? "application/json"
    },
    body,
    cache: "no-store"
  });

  const responseText = await upstream.text();

  if (upstream.ok) {
    try {
      const result = JSON.parse(responseText) as StressTestResponse;
      const context = await getAuthenticatedSupabaseContext(request.headers.get("authorization"));
      if (context.enabled && context.user) {
        await context.supabase.from("stress_runs").insert({
          user_id: context.user.id,
          tickers: payload.tickers ?? [],
          weights: payload.weights ?? [],
          horizon_days: payload.horizon_days ?? 252,
          seed: payload.seed ?? 42,
          confidence_level: result.confidence_level,
          risk_free_rate: result.risk_free_rate,
          expected_return: result.expected_return,
          var_95: result.var_95,
          var_99: result.var_99,
          value_at_risk: result.value_at_risk,
          cvar: result.cvar,
          annualized_volatility: result.annualized_volatility,
          sharpe_ratio: result.sharpe_ratio,
          elapsed_ms: result.elapsed_ms,
          data_fetch_ms: result.data_fetch_ms,
          total_roundtrip_ms: result.total_roundtrip_ms,
          histogram: result.histogram,
          provider: result.provider ?? null,
          range: result.range ?? null
        });
      }
    } catch {
      // The proxied response is forwarded even if persistence fails.
    }
  }

  return new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}
