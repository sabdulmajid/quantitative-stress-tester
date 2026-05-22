"use client";

import type { StressRunRecord } from "@/lib/types";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

export default function RunHistory({
  runs,
  loading,
  signedIn,
  onLoadPortfolio
}: {
  runs: StressRunRecord[];
  loading: boolean;
  signedIn: boolean;
  onLoadPortfolio: (run: StressRunRecord) => void;
}) {
  return (
    <section className="rounded-lg border border-white/60 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-800/70">History</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Recent saved runs</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Every successful authenticated simulation is written to the database and can be reused as a portfolio
            template.
          </p>
        </div>
        {loading ? (
          <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Loading</span>
        ) : null}
      </div>

      {!signedIn ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          Sign in to persist portfolios and see your recent runs here.
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          No saved runs yet. Execute a stress test while signed in to populate this history.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {runs.map((run) => (
            <article key={run.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{run.tickers.join(" / ")}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatTimestamp(run.created_at)} / {Math.round(run.confidence_level * 100)}% /{" "}
                    {run.horizon_days === 252 ? "1Y" : `${run.horizon_days}D`} /{" "}
                    {run.scenario_label ?? run.scenario_id}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                  onClick={() => onLoadPortfolio(run)}
                >
                  Use portfolio
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs uppercase text-slate-400">Expected</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{formatPercent(run.expected_return)}</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs uppercase text-slate-400">VaR</div>
                  <div className="mt-1 text-lg font-semibold text-rose-600">{formatPercent(run.value_at_risk)}</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs uppercase text-slate-400">CVaR</div>
                  <div className="mt-1 text-lg font-semibold text-rose-600">{formatPercent(run.cvar)}</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs uppercase text-slate-400">Latency</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(run.elapsed_ms)} ms
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
