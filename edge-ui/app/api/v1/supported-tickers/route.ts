import { NextResponse } from "next/server";
import { getGatewayBaseUrl } from "@/lib/server/gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  const gatewayBaseUrl = getGatewayBaseUrl();
  const upstream = await fetch(`${gatewayBaseUrl}/api/v1/supported-tickers`, {
    cache: "no-store"
  });

  const responseText = await upstream.text();
  return new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}
