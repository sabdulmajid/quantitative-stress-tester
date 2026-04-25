import { create } from "zustand";
import {
  addTickerToSelections,
  evenlySplitSelections,
  normalizeSelections,
  rebalanceAfterTickerChange,
  rebalanceAfterWeightChange
} from "@/lib/portfolio";
import { type PortfolioSelection, type SupportedTicker } from "@/lib/types";

type PortfolioStore = {
  supportedTickers: SupportedTicker[];
  selections: PortfolioSelection[];
  syncSupportedTickers: (tickers: SupportedTicker[]) => void;
  setSelections: (selections: PortfolioSelection[]) => void;
  addTicker: (ticker: SupportedTicker) => void;
  removeTicker: (ticker: SupportedTicker) => void;
  setWeight: (ticker: SupportedTicker, weight: number) => void;
  reset: () => void;
};

function uniqueTickers(tickers: SupportedTicker[]) {
  return Array.from(new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)));
}

function fallbackSelections(tickers: SupportedTicker[]) {
  return tickers.length > 0 ? evenlySplitSelections([tickers[0]]) : [];
}

function keepSupportedSelections(
  selections: PortfolioSelection[],
  supportedTickers: SupportedTicker[]
): PortfolioSelection[] {
  const allowed = new Set(uniqueTickers(supportedTickers));
  if (allowed.size === 0) {
    return [];
  }

  const deduped: PortfolioSelection[] = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    if (!allowed.has(selection.ticker) || seen.has(selection.ticker)) {
      continue;
    }
    deduped.push(selection);
    seen.add(selection.ticker);
  }

  if (deduped.length === 0) {
    return fallbackSelections(supportedTickers);
  }

  return normalizeSelections(deduped.slice(0, 5));
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  supportedTickers: [],
  selections: [],
  syncSupportedTickers: (tickers) =>
    set((state) => {
      const nextSupportedTickers = uniqueTickers(tickers);
      return {
        supportedTickers: nextSupportedTickers,
        selections: keepSupportedSelections(state.selections, nextSupportedTickers)
      };
    }),
  setSelections: (selections) =>
    set((state) => ({
      selections: keepSupportedSelections(normalizeSelections(selections), state.supportedTickers)
    })),
  addTicker: (ticker) =>
    set((state) => {
      if (!state.supportedTickers.includes(ticker) || state.selections.length >= 5) {
        return state;
      }
      return {
        selections: addTickerToSelections(state.selections, ticker)
      };
    }),
  removeTicker: (ticker) =>
    set((state) => {
      const nextSelections = rebalanceAfterTickerChange(state.selections, ticker);
      return {
        selections: nextSelections.length > 0 ? nextSelections : fallbackSelections(state.supportedTickers)
      };
    }),
  setWeight: (ticker, weight) =>
    set((state) => ({
      selections: rebalanceAfterWeightChange(state.selections, ticker, weight)
    })),
  reset: () => {
    const supportedTickers = get().supportedTickers;
    set({ selections: fallbackSelections(supportedTickers) });
  }
}));
