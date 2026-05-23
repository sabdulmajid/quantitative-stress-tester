"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import AuthPanel from "@/components/AuthPanel";
import PortfolioInput from "@/components/PortfolioInput";
import RunHistory from "@/components/RunHistory";
import {
  fetchSavedPortfolio,
  fetchStressRunHistory,
  fetchTickerUniverse,
  runStressTest,
  savePortfolio
} from "@/lib/api";
import { buildRunExport, buildRunExportCsv, runExportCsvFilename, runExportFilename } from "@/lib/export";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { roundWeight } from "@/lib/portfolio";
import type {
  AppUser,
  ConfidenceLevel,
  HorizonDays,
  SavedPortfolio,
  ScenarioShock,
  StressRunRecord,
  StressTestRequest,
  StressTestResponse,
  TickerUniverseResponse
} from "@/lib/types";
import { usePortfolioStore } from "@/store/portfolio-store";

const DistributionChart = dynamic(() => import("@/components/DistributionChart"), {
  ssr: false
});

const CorrelationMatrix = dynamic(() => import("@/components/CorrelationMatrix"), {
  ssr: false
});

const persistenceEnabled = isSupabaseConfigured();
const horizonOptions: HorizonDays[] = [1, 10, 252];
const confidenceOptions: ConfidenceLevel[] = [0.95, 0.99];
const fallbackScenario: ScenarioShock = {
  id: "baseline",
  label: "Baseline",
  description: "Aligned historical drift and covariance without scenario scaling.",
  drift_multiplier: 1,
  covariance_multiplier: 1
};
const fallbackTickerUniverse: TickerUniverseResponse = {
  provider: "Fallback universe",
  range: "cached",
  cache_ttl_seconds: 21600,
  max_portfolio_tickers: 20,
  padded_asset_count: 50,
  tickers: [
    "AAPL",
    "AMZN",
    "GLD",
    "GOOGL",
    "IWM",
    "JNJ",
    "JPM",
    "META",
    "MSFT",
    "NFLX",
    "NVDA",
    "PG",
    "QQQ",
    "SPY",
    "TSLA",
    "UNH",
    "V",
    "VTI",
    "XLE",
    "XLF"
  ],
  scenarios: [fallbackScenario]
};

function formatElapsed(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ms`;
}

function formatGenericValue(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  if (Math.abs(value) < 1 && value !== 0) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatRatio(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return value.toFixed(2);
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "N/A";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

function formatContribution(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

export default function Page() {
  const selections = usePortfolioStore((state) => state.selections);
  const setSelections = usePortfolioStore((state) => state.setSelections);
  const syncSupportedTickers = usePortfolioStore((state) => state.syncSupportedTickers);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StressTestResponse | null>(null);
  const [clientElapsedMs, setClientElapsedMs] = useState<number | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState<ConfidenceLevel>(0.95);
  const [horizonDays, setHorizonDays] = useState<HorizonDays>(252);
  const [riskFreeRate, setRiskFreeRate] = useState(0.02);
  const [scenarioId, setScenarioId] = useState(fallbackScenario.id);
  const [tickerUniverse, setTickerUniverse] = useState<TickerUniverseResponse | null>(null);
  const [tickerUniverseError, setTickerUniverseError] = useState<string | null>(null);
  const [loadingTickers, setLoadingTickers] = useState(true);
  const [authUser, setAuthUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(persistenceEnabled);
  const [savedPortfolio, setSavedPortfolio] = useState<SavedPortfolio | null>(null);
  const [portfolioSaving, setPortfolioSaving] = useState(false);
  const [portfolioMessage, setPortfolioMessage] = useState<string | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<StressRunRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadTickerUniverse() {
      setLoadingTickers(true);
      try {
        const response = await fetchTickerUniverse();
        if (!active) return;
        setTickerUniverse(response);
        setTickerUniverseError(null);
        syncSupportedTickers(response.tickers);
      } catch (tickerError) {
        if (!active) return;
        setTickerUniverse(fallbackTickerUniverse);
        setTickerUniverseError(
          tickerError instanceof Error
            ? `Live ticker discovery failed: ${tickerError.message}`
            : "Live ticker discovery failed"
        );
        syncSupportedTickers(fallbackTickerUniverse.tickers);
      } finally {
        if (active) {
          setLoadingTickers(false);
        }
      }
    }

    void loadTickerUniverse();
    return () => {
      active = false;
    };
  }, [syncSupportedTickers, retryCount]);

  async function handleRetryTickers() {
    setRetryCount((c) => c + 1);
  }

  async function syncAuthState(supabase = createBrowserSupabaseClient()) {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      setAuthUser(null);
      setSavedPortfolio(null);
      setRunHistory([]);
      setHistoryLoading(false);
      setAuthLoading(false);
      return;
    }

    setAuthUser({
      id: user.id,
      email: user.email ?? null
    });
    setAuthLoading(false);
  }

  useEffect(() => {
    if (!persistenceEnabled) return;

    const supabase = createBrowserSupabaseClient();
    let active = true;

    queueMicrotask(() => {
      if (active) {
        void syncAuthState(supabase);
      }
    });
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(() => {
      if (active) {
        void syncAuthState(supabase);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;

    let active = true;

    async function loadPersistence() {
      setHistoryLoading(true);
      setPortfolioError(null);

      const [portfolioResult, historyResult] = await Promise.allSettled([
        fetchSavedPortfolio(),
        fetchStressRunHistory()
      ]);

      if (!active) return;

      if (portfolioResult.status === "fulfilled") {
        setSavedPortfolio(portfolioResult.value);
        if (portfolioResult.value) {
          setSelections(portfolioResult.value.selections);
        }
      } else {
        setSavedPortfolio(null);
        setPortfolioError(portfolioResult.reason instanceof Error ? portfolioResult.reason.message : "Unable to load saved portfolio");
      }

      if (historyResult.status === "fulfilled") {
        setRunHistory(historyResult.value.runs);
      } else {
        setRunHistory([]);
      }

      setHistoryLoading(false);
    }

    void loadPersistence();
    return () => {
      active = false;
    };
  }, [authUser, setSelections]);

  async function handleAuthChange() {
    await syncAuthState();
  }

  const scenarioOptions = tickerUniverse?.scenarios?.length ? tickerUniverse.scenarios : [fallbackScenario];
  const selectedScenario =
    scenarioOptions.find((scenario) => scenario.id === scenarioId) ?? scenarioOptions[0] ?? fallbackScenario;

  const payload = useMemo<StressTestRequest>(
    () => ({
      tickers: selections.map((selection) => selection.ticker),
      weights: selections.map((selection) => roundWeight(selection.weight)),
      horizon_days: horizonDays,
      confidence_level: confidenceLevel,
      risk_free_rate: riskFreeRate,
      scenario_id: selectedScenario.id
    }),
    [confidenceLevel, horizonDays, riskFreeRate, selectedScenario.id, selections]
  );

  async function handleRun() {
    setLoading(true);
    setError(null);
    const startedAt = performance.now();

    try {
      const response = await runStressTest(payload);
      setResult(response);
      setClientElapsedMs(performance.now() - startedAt);
      if (authUser) {
        const history = await fetchStressRunHistory();
        setRunHistory(history.runs);
      }
    } catch (submissionError) {
      setResult(null);
      setClientElapsedMs(null);
      setError(submissionError instanceof Error ? submissionError.message : "Unable to run stress test");
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePortfolio() {
    setPortfolioSaving(true);
    setPortfolioMessage(null);
    setPortfolioError(null);

    try {
      const portfolio = await savePortfolio({
        name: "Default portfolio",
        selections
      });
      setSavedPortfolio(portfolio);
      setPortfolioMessage("Portfolio saved.");
    } catch (saveError) {
      setPortfolioError(saveError instanceof Error ? saveError.message : "Unable to save portfolio");
    } finally {
      setPortfolioSaving(false);
    }
  }

  function handleLoadPortfolio(run: StressRunRecord) {
    setSelections(
      run.tickers.map((ticker, index) => ({
        ticker,
        weight: run.weights[index] ?? 0
      }))
    );
    setHorizonDays(run.horizon_days);
    setConfidenceLevel(run.confidence_level);
    setRiskFreeRate(run.risk_free_rate);
    setScenarioId(run.scenario_id);
    setPortfolioMessage("Portfolio loaded from run history.");
    setPortfolioError(null);
  }

  function downloadText(filename: string, text: string, type: string) {
    const blob = new Blob([text], {
      type
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function handleExportRun(format: "json" | "csv") {
    if (!result) return;
    const exportedAt = new Date().toISOString();
    const exportPayload = buildRunExport(payload, result, exportedAt);
    if (format === "json") {
      downloadText(runExportFilename(exportedAt), JSON.stringify(exportPayload, null, 2), "application/json");
      return;
    }
    downloadText(runExportCsvFilename(exportedAt), buildRunExportCsv(exportPayload), "text/csv");
  }

  const totalWeight = selections.reduce((sum, item) => sum + item.weight, 0);
  const ready = selections.length > 0 && !loadingTickers;
  const liveTickerCount = tickerUniverse?.tickers.length ?? 0;
  const maxPortfolioTickers = tickerUniverse?.max_portfolio_tickers ?? 20;
  const riskContributions = result?.risk_contributions ?? [];
  const cacheMinutes =
    typeof tickerUniverse?.cache_ttl_seconds === "number"
      ? Math.round(tickerUniverse.cache_ttl_seconds / 60)
      : null;

  return (
    <main className="min-h-screen bg-[#f6f7fb] px-4 py-5 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
            <div className="space-y-5">
              <div className="inline-flex items-center rounded-md border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase text-teal-900">
                Live risk console
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold text-slate-950 sm:text-4xl">
                  Quant Stress Engine
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                  Configure a portfolio, run the live gateway path, and inspect risk, timing, attribution, scenario,
                  and matrix outputs from one focused workspace.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  [`${liveTickerCount || "N/A"} tickers`, "Live market universe"],
                  ["50 bins", "Compact histogram response"],
                  [authUser ? "Signed in" : persistenceEnabled ? "Auth ready" : "Guest mode", authUser?.email ?? "Persistence optional"]
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-950">{label}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">{detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-950">Production path</span>
                <span className="rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  Health checked
                </span>
              </div>
              <div className="mt-4 break-all font-mono text-sm text-slate-700">
                {"UI BFF -> Go gateway -> JAX worker"}
              </div>
              <div className="mt-5 grid gap-3 text-sm">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-slate-500">Portfolio weight total</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">{formatGenericValue(totalWeight)}%</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-slate-500">Ticker cache</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-950">
                    {cacheMinutes === null ? "N/A" : `${cacheMinutes} min`}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-slate-500">Saved portfolio</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{formatTimestamp(savedPortfolio?.updated_at)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
          <div className="space-y-6">
            <AuthPanel
              enabled={persistenceEnabled}
              user={authUser}
              loading={authLoading}
              onAuthChange={handleAuthChange}
            />

            <PortfolioInput
              supportedTickers={tickerUniverse?.tickers ?? []}
              loadingTickers={loadingTickers}
              maxPortfolioTickers={maxPortfolioTickers}
            />

            <section className="rounded-lg border border-slate-200/80 bg-white p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">Run summary</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Results come directly from the gateway response contract. Authenticated runs are written to history
                    after the response returns.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleExportRun("json")}
                    disabled={!result}
                    className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportRun("csv")}
                    disabled={!result}
                    className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePortfolio}
                    disabled={!authUser || portfolioSaving || selections.length === 0}
                    className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {portfolioSaving ? "Saving..." : "Save portfolio"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={!ready || loading}
                    className="rounded-md bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {loading ? "Running..." : loadingTickers ? "Loading tickers..." : "Run stress test"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_0.9fr_1.2fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm font-medium text-slate-700">Confidence</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                    {confidenceOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setConfidenceLevel(option)}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          confidenceLevel === option ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                        }`}
                      >
                        {Math.round(option * 100)}%
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="text-sm font-medium text-slate-700">Horizon</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-slate-100 p-1">
                    {horizonOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setHorizonDays(option)}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          horizonDays === option ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                        }`}
                      >
                        {option === 252 ? "1Y" : `${option}D`}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="rounded-lg border border-slate-200 bg-white p-4">
                  <span className="text-sm font-medium text-slate-700">Risk-free rate</span>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="field"
                      type="number"
                      min={-10}
                      max={25}
                      step={0.25}
                      value={(riskFreeRate * 100).toFixed(2)}
                      onChange={(event) => {
                        const nextRate = Number(event.target.value);
                        if (Number.isFinite(nextRate)) {
                          setRiskFreeRate(nextRate / 100);
                        }
                      }}
                    />
                    <span className="text-sm font-semibold text-slate-500">%</span>
                  </div>
                </label>

                <label className="rounded-lg border border-slate-200 bg-white p-4">
                  <span className="text-sm font-medium text-slate-700">Scenario shock</span>
                  <select
                    className="field mt-3"
                    value={selectedScenario.id}
                    onChange={(event) => setScenarioId(event.target.value)}
                  >
                    {scenarioOptions.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-2 block text-xs leading-5 text-slate-500" title={selectedScenario.description}>
                    Drift x{selectedScenario.drift_multiplier.toFixed(2)}, covariance x
                    {selectedScenario.covariance_multiplier.toFixed(2)}
                  </span>
                </label>
              </div>

              {loading ? (
                <div className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4">
                  <div className="flex items-center justify-between gap-4 text-sm font-medium text-teal-900">
                    <span>Simulating 100,000 paths</span>
                    <span>{Math.round(confidenceLevel * 100)}% VaR</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-md bg-teal-100">
                    <div className="simulation-progress h-full rounded-md bg-teal-700" />
                  </div>
                </div>
              ) : null}

              {tickerUniverseError ? (
                <div className="mt-5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <span>{tickerUniverseError}. A fallback ticker list is active so the console remains usable.</span>
                  <button
                    type="button"
                    onClick={handleRetryTickers}
                    className="ml-4 rounded-md bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-900 transition hover:bg-amber-300"
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {portfolioMessage ? (
                <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {portfolioMessage}
                </div>
              ) : null}

              {portfolioError ? (
                <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {portfolioError}
                </div>
              ) : null}

              {error ? (
                <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  {
                    label: "Expected return",
                    value: formatGenericValue(result?.expected_return),
                    help: "Mean simulated portfolio return over the selected horizon."
                  },
                  {
                    label: `VaR ${Math.round(confidenceLevel * 100)}%`,
                    value: formatGenericValue(result?.value_at_risk),
                    help: "Value at Risk is the loss threshold exceeded by the selected lower-tail probability."
                  },
                  {
                    label: "CVaR",
                    value: formatGenericValue(result?.cvar),
                    help: "Conditional Value at Risk is the average loss inside the selected VaR tail."
                  },
                  {
                    label: "Annualized vol",
                    value: formatGenericValue(result?.annualized_volatility),
                    help: "Annualized volatility is the square root of portfolio variance from the scenario covariance matrix."
                  },
                  {
                    label: "Sharpe",
                    value: formatRatio(result?.sharpe_ratio),
                    help: "Sharpe ratio is annualized excess return divided by annualized volatility."
                  },
                  { label: "Compute", value: formatElapsed(result?.elapsed_ms), help: "JAX simulation time." },
                  { label: "Data fetch", value: formatElapsed(result?.data_fetch_ms), help: "Gateway market-data time." },
                  {
                    label: "Gateway round-trip",
                    value: formatElapsed(result?.total_roundtrip_ms),
                    help: "Total gateway request duration."
                  },
                  {
                    label: "Client round-trip",
                    value: formatElapsed(clientElapsedMs ?? undefined),
                    help: "Browser-observed request duration."
                  }
                ].map((metric) => (
                  <div key={metric.label} title={metric.help} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="text-sm text-slate-500">{metric.label}</div>
                    <div className="mt-2 text-xl font-semibold text-slate-950">{metric.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Execution preview</div>
                <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase text-slate-400">Tickers</div>
                    <div className="mt-1 font-medium text-slate-900">
                      {payload.tickers.length ? payload.tickers.join(", ") : "Loading universe"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-400">Horizon</div>
                    <div className="mt-1 font-medium text-slate-900">{horizonDays === 252 ? "1 year" : `${horizonDays} days`}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-400">Confidence</div>
                    <div className="mt-1 font-medium text-slate-900">{Math.round(confidenceLevel * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-400">Scenario</div>
                    <div className="mt-1 font-medium text-slate-900">{selectedScenario.label}</div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <DistributionChart
              histogram={result?.histogram ?? []}
              valueAtRisk={result?.value_at_risk ?? 0}
              confidenceLevel={confidenceLevel}
              loading={loading}
            />

            <section className="rounded-lg border border-white/60 bg-white p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-teal-800/70">Risk attribution</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">Volatility contribution</h2>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  {result ? result.scenario.label : selectedScenario.label}
                </div>
              </div>

              {riskContributions.length ? (
                <div className="mt-5 space-y-3">
                  {riskContributions.map((contribution) => (
                    <div key={contribution.ticker} className="grid gap-2 sm:grid-cols-[72px_1fr_72px] sm:items-center">
                      <div className="text-sm font-semibold text-slate-950">{contribution.ticker}</div>
                      <div className="h-2 overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="h-full rounded-md bg-teal-700"
                          style={{
                            width: `${Math.max(0, Math.min(100, contribution.contribution_percent * 100))}%`
                          }}
                        />
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-700">
                        {formatContribution(contribution.contribution_percent)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  Run a simulation to populate per-asset volatility contribution.
                </div>
              )}
            </section>

            <CorrelationMatrix
              tickers={result?.tickers ?? []}
              correlationMatrix={result?.correlation_matrix ?? []}
              covarianceMatrix={result?.covariance_matrix ?? []}
            />

            <RunHistory
              runs={runHistory}
              loading={historyLoading}
              signedIn={Boolean(authUser)}
              onLoadPortfolio={handleLoadPortfolio}
            />

            <section className="rounded-lg border border-slate-200/80 bg-white p-6">
              <h2 className="text-2xl font-semibold text-slate-950">Response contract</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The gateway returns VaR, CVaR, annualized volatility, Sharpe, timing telemetry, covariance, and
                correlation data for the selected portfolio.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Scenario shocks are applied in the gateway before padding the unchanged 50-asset compute payload.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                When Supabase is configured, the app uses cookie-backed sessions for auth and stores one saved portfolio
                plus recent run history per user. Without Supabase, the stress engine stays available in guest mode.
              </p>
              {tickerUniverse ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Live market source:
                  <span className="font-medium text-slate-900">
                    {" "}
                    {tickerUniverse.provider} ({tickerUniverse.range})
                  </span>
                </p>
              ) : null}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
