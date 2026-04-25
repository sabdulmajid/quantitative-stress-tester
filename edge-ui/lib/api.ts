import type {
  SavedPortfolio,
  SavedPortfolioResponse,
  SavePortfolioRequest,
  StressRunHistoryResponse,
  StressTestRequest,
  StressTestResponse,
  TickerUniverseResponse
} from "@/lib/types";

async function parseError(response: Response) {
  const message = await response.text();
  try {
    const payload = JSON.parse(message) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Fall back to the raw response text below.
  }
  return message || `Request failed with status ${response.status}`;
}

export async function fetchTickerUniverse(): Promise<TickerUniverseResponse> {
  const response = await fetch("/api/v1/supported-tickers", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as TickerUniverseResponse;
}

export async function fetchSavedPortfolio(): Promise<SavedPortfolio | null> {
  const response = await fetch("/api/v1/portfolio", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = (await response.json()) as SavedPortfolioResponse;
  return payload.portfolio;
}

export async function savePortfolio(payload: SavePortfolioRequest): Promise<SavedPortfolio> {
  const response = await fetch("/api/v1/portfolio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const saved = (await response.json()) as SavedPortfolioResponse;
  if (!saved.portfolio) {
    throw new Error("Portfolio was not returned by the server");
  }
  return saved.portfolio;
}

export async function fetchStressRunHistory() {
  const response = await fetch("/api/v1/history", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as StressRunHistoryResponse;
}

export async function runStressTest(payload: StressTestRequest): Promise<StressTestResponse> {
  const response = await fetch("/api/v1/stress-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as StressTestResponse;
}
