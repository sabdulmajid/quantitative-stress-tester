"use client";

import { useMemo, useState } from "react";
import type { SupportedTicker } from "@/lib/types";

type ActiveCell = {
  row: SupportedTicker;
  column: SupportedTicker;
  correlation: number;
  covariance: number;
};

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function cellColor(value: number) {
  const bounded = Math.max(-1, Math.min(1, value));
  if (bounded >= 0) {
    const intensity = Math.round(30 + bounded * 150);
    return `rgba(13, ${intensity}, 148, ${0.18 + bounded * 0.58})`;
  }
  const intensity = Math.round(80 + Math.abs(bounded) * 150);
  return `rgba(${intensity}, 38, 38, ${0.18 + Math.abs(bounded) * 0.58})`;
}

export default function CorrelationMatrix({
  tickers,
  correlationMatrix,
  covarianceMatrix
}: {
  tickers: SupportedTicker[];
  correlationMatrix: number[][];
  covarianceMatrix: number[][];
}) {
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const cells = useMemo(
    () =>
      tickers.flatMap((rowTicker, rowIndex) =>
        tickers.map((columnTicker, columnIndex) => ({
          key: `${rowTicker}-${columnTicker}`,
          rowTicker,
          columnTicker,
          rowIndex,
          columnIndex,
          correlation: correlationMatrix[rowIndex]?.[columnIndex] ?? 0,
          covariance: covarianceMatrix[rowIndex]?.[columnIndex] ?? 0
        }))
      ),
    [correlationMatrix, covarianceMatrix, tickers]
  );

  if (tickers.length === 0 || correlationMatrix.length === 0) {
    return (
      <section className="rounded-lg border border-white/60 bg-white p-6">
        <p className="text-xs font-semibold uppercase text-teal-800/70">Correlation</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">Covariance heatmap</h2>
        <div className="mt-5 h-48 animate-pulse rounded-md bg-slate-100" />
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/60 bg-white p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-800/70">Correlation</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Covariance heatmap</h2>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {activeCell ? (
            <>
              <span className="font-semibold text-slate-950">
                {activeCell.row} / {activeCell.column}
              </span>
              <span className="ml-2">rho {formatNumber(activeCell.correlation)}</span>
              <span className="ml-2">cov {formatNumber(activeCell.covariance, 4)}</span>
            </>
          ) : (
            <span>Hover or focus a cell</span>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div
          className="grid min-w-[620px] gap-1"
          style={{ gridTemplateColumns: `88px repeat(${tickers.length}, minmax(34px, 1fr))` }}
        >
          <div />
          {tickers.map((ticker) => (
            <div key={ticker} className="truncate text-center text-xs font-semibold text-slate-500">
              {ticker}
            </div>
          ))}
          {tickers.map((ticker) => (
            <div key={`${ticker}-row`} className="contents">
              <div className="flex h-9 items-center text-xs font-semibold text-slate-500">{ticker}</div>
              {cells
                .filter((cell) => cell.rowTicker === ticker)
                .map((cell) => (
                  <button
                    key={cell.key}
                    type="button"
                    className="h-9 rounded-md border border-white/60 text-[11px] font-semibold text-slate-950 outline-none ring-teal-500 transition focus:ring-2"
                    style={{ background: cellColor(cell.correlation) }}
                    onMouseEnter={() =>
                      setActiveCell({
                        row: cell.rowTicker,
                        column: cell.columnTicker,
                        correlation: cell.correlation,
                        covariance: cell.covariance
                      })
                    }
                    onFocus={() =>
                      setActiveCell({
                        row: cell.rowTicker,
                        column: cell.columnTicker,
                        correlation: cell.correlation,
                        covariance: cell.covariance
                      })
                    }
                  >
                    {formatNumber(cell.correlation, 1)}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
