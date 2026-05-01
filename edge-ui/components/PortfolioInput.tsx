"use client";

import { useEffect, useMemo, useState } from "react";
import { clampWeight, supportedTickerOptions } from "@/lib/portfolio";
import { type SupportedTicker } from "@/lib/types";
import { usePortfolioStore } from "@/store/portfolio-store";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function TickerWeightSlider({
  ticker,
  weight,
  onChange,
  onRemove,
  disableRemove
}: {
  ticker: SupportedTicker;
  weight: number;
  onChange: (ticker: SupportedTicker, weight: number) => void;
  onRemove: (ticker: SupportedTicker) => void;
  disableRemove: boolean;
}) {
  const [draftWeight, setDraftWeight] = useState(weight);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onChange(ticker, clampWeight(draftWeight));
    }, 150);

    return () => window.clearTimeout(timer);
  }, [draftWeight, onChange, ticker]);

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/75 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">{ticker}</div>
          <div className="text-xs text-slate-500">Weight allocation</div>
        </div>
        <div className="rounded-full bg-slate-950 px-3 py-1 text-xs font-medium text-white">
          {formatPercent(weight)}
        </div>
      </div>

      <div className="mt-4">
        <input
          aria-label={`${ticker} weight`}
          className="w-full accent-teal-600"
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={draftWeight}
          onChange={(event) => setDraftWeight(Number(event.target.value))}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>0%</span>
        <span>100%</span>
      </div>

      <button
        type="button"
        className="mt-4 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onRemove(ticker)}
        disabled={disableRemove}
      >
        Remove
      </button>
    </div>
  );
}

export default function PortfolioInput({
  supportedTickers,
  loadingTickers,
  maxPortfolioTickers
}: {
  supportedTickers: SupportedTicker[];
  loadingTickers: boolean;
  maxPortfolioTickers: number;
}) {
  const selections = usePortfolioStore((state) => state.selections);
  const addTicker = usePortfolioStore((state) => state.addTicker);
  const removeTicker = usePortfolioStore((state) => state.removeTicker);
  const setWeight = usePortfolioStore((state) => state.setWeight);

  const availableTickers = useMemo(
    () => supportedTickerOptions(supportedTickers, selections.map((item) => item.ticker)),
    [selections, supportedTickers]
  );
  const [pendingTicker, setPendingTicker] = useState<SupportedTicker | "">("");
  const selectedPendingTicker =
    pendingTicker && availableTickers.includes(pendingTicker) ? pendingTicker : (availableTickers[0] ?? "");

  return (
    <section className="rounded-[2rem] border border-white/60 bg-white/72 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-800/70">Portfolio</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Configure tickers and weights</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Add up to {maxPortfolioTickers} supported tickers, then tune allocations with debounced sliders.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-slate-100">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Selections</div>
          <div className="mt-1 text-lg font-semibold">
            {selections.length}/{maxPortfolioTickers}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-slate-700">Add supported ticker</span>
          <select
            className="field"
            value={selectedPendingTicker}
            onChange={(event) => setPendingTicker(event.target.value as SupportedTicker)}
            disabled={availableTickers.length === 0 || loadingTickers}
          >
            <option value="">Choose a ticker</option>
            {loadingTickers ? (
              <option value="" disabled>
                Loading live tickers
              </option>
            ) : availableTickers.length === 0 ? (
              <option value="" disabled>
                No tickers left
              </option>
            ) : (
              availableTickers.map((ticker) => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))
            )}
          </select>
        </label>

        <button
          type="button"
          className="rounded-full bg-teal-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          onClick={() => {
            if (selectedPendingTicker) {
              addTicker(selectedPendingTicker);
              setPendingTicker("");
            }
          }}
          disabled={availableTickers.length === 0 || loadingTickers || !selectedPendingTicker}
        >
          Add ticker
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {selections.map((selection) => (
          <TickerWeightSlider
            key={`${selection.ticker}-${selection.weight.toFixed(2)}`}
            ticker={selection.ticker}
            weight={selection.weight}
            onChange={setWeight}
            onRemove={removeTicker}
            disableRemove={selections.length === 1}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
          Supported: {supportedTickers.length > 0 ? supportedTickers.join(", ") : "Loading"}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
          Sliders sync through a debounced update
        </span>
      </div>
    </section>
  );
}
