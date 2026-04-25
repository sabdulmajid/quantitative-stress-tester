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
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { roundWeight } from "@/lib/portfolio";
import type {
  AppUser,
  SavedPortfolio,
  StressRunRecord,
  StressTestResponse,
  TickerUniverseResponse
} from "@/lib/types";
import { usePortfolioStore } from "@/store/portfolio-store";

const DistributionChart = dynamic(() => import("@/components/DistributionChart"), {
  ssr: false
});

const persistenceEnabled = isSupabaseConfigured();

function formatElapsed(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ms`;
}

function formatGenericValue(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 1 && value !== 0) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "—";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

export default function Page() {
  const selections = usePortfolioStore((state) => state.selections);
  const setSelections = usePortfolioStore((state) => state.setSelections);
  const syncSupportedTickers = usePortfolioStore((state) => state.syncSupportedTickers);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StressTestResponse | null>(null);
  const [clientElapsedMs, setClientElapsedMs] = useState<number | null>(null);
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
        setTickerUniverse(null);
        setTickerUniverseError(tickerError instanceof Error ? tickerError.message : "Unable to load ticker universe");
        syncSupportedTickers([]);
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
  }, [syncSupportedTickers]);

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

  const payload = useMemo(
    () => ({
      tickers: selections.map((selection) => selection.ticker),
      weights: selections.map((selection) => roundWeight(selection.weight))
    }),
    [selections]
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
    setPortfolioMessage("Portfolio loaded from run history.");
    setPortfolioError(null);
  }

  const totalWeight = selections.reduce((sum, item) => sum + item.weight, 0);
  const ready = selections.length > 0 && !loadingTickers && !tickerUniverseError;
  const liveTickerCount = tickerUniverse?.tickers.length ?? 0;
  const cacheMinutes =
    typeof tickerUniverse?.cache_ttl_seconds === "number"
      ? Math.round(tickerUniverse.cache_ttl_seconds / 60)
      : null;

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-[2rem] border border-white/60 bg-white/74 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.1)] backdrop-blur sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div className="space-y-5">
              <div className="inline-flex items-center rounded-full border border-teal-900/10 bg-teal-950/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-teal-900/80">
                Quant Stress Engine
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  Portfolio stress testing with persistence, auth, and a fast path to JAX.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                  Configure the portfolio, run the stress engine, and optionally sign in to save your portfolio and
                  every authenticated simulation run.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  [`${liveTickerCount || "—"} tickers`, "Live market universe"],
                  ["50 bins", "Compact histogram response"],
                  [authUser ? "Signed in" : persistenceEnabled ? "Auth ready" : "Guest mode", authUser?.email ?? "Persistence optional"]
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                    <div className="text-sm font-semibold text-slate-950">{label}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">{detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-950 p-5 text-slate-100 shadow-glow">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>Gateway route</span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-teal-300">
                  Production path
                </span>
              </div>
              <div className="mt-3 break-all font-mono text-sm text-slate-50">/api/v1/stress-test</div>
              <div className="mt-5 grid gap-3 text-sm">
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-slate-400">Portfolio weight total</div>
                  <div className="mt-1 text-2xl font-semibold text-white">{formatGenericValue(totalWeight)}%</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-slate-400">Ticker cache</div>
                  <div className="mt-1 text-2xl font-semibold text-white">
                    {cacheMinutes === null ? "—" : `${cacheMinutes} min`}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-slate-400">Saved portfolio</div>
                  <div className="mt-1 text-sm font-semibold text-white">{formatTimestamp(savedPortfolio?.updated_at)}</div>
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

            <PortfolioInput supportedTickers={tickerUniverse?.tickers ?? []} loadingTickers={loadingTickers} />

            <section className="rounded-[2rem] border border-slate-200/80 bg-white/78 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Run summary</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Results come directly from the gateway response contract. Authenticated runs are written to history
                    after the response returns.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSavePortfolio}
                    disabled={!authUser || portfolioSaving || selections.length === 0}
                    className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {portfolioSaving ? "Saving..." : "Save portfolio"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={!ready || loading}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {loading ? "Running..." : loadingTickers ? "Loading tickers..." : "Run stress test"}
                  </button>
                </div>
              </div>

              {tickerUniverseError ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {tickerUniverseError}
                </div>
              ) : null}

              {portfolioMessage ? (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {portfolioMessage}
                </div>
              ) : null}

              {portfolioError ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {portfolioError}
                </div>
              ) : null}

              {error ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Expected return", formatGenericValue(result?.expected_return)],
                  ["95% VaR", formatGenericValue(result?.var_95)],
                  ["Elapsed", formatElapsed(result?.elapsed_ms)],
                  ["Client round-trip", formatElapsed(clientElapsedMs ?? undefined)]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white/85 p-4">
                    <div className="text-sm text-slate-500">{label}</div>
                    <div className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-3xl bg-slate-950 p-4 text-slate-100">
                <div className="text-sm text-slate-400">Payload sent to gateway</div>
                <pre className="mt-3 overflow-x-auto rounded-2xl bg-white/5 p-4 text-xs leading-6 text-slate-100">
{JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <DistributionChart histogram={result?.histogram ?? []} var95={result?.var_95 ?? 0} />

            <RunHistory
              runs={runHistory}
              loading={historyLoading}
              signedIn={Boolean(authUser)}
              onLoadPortfolio={handleLoadPortfolio}
            />

            <section className="rounded-[2rem] border border-slate-200/80 bg-white/78 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">What this app expects</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                The backend returns `var_95`, `expected_return`, `histogram`, and `elapsed_ms`. The chart colors every
                bin that falls at or below the VaR threshold in red.
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
