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
      const context = await getAuthenticatedSupabaseContext();
      if (context.enabled && context.user) {
        await context.supabase.from("stress_runs").insert({
          user_id: context.user.id,
          tickers: payload.tickers ?? [],
          weights: payload.weights ?? [],
          horizon_days: payload.horizon_days ?? 252,
          seed: payload.seed ?? 42,
          expected_return: result.expected_return,
          var_95: result.var_95,
          elapsed_ms: result.elapsed_ms,
          histogram: result.histogram,
          provider: null,
          range: null
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
