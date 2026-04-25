import { type PortfolioSelection, type SupportedTicker } from "@/lib/types";

const EPSILON = 0.0001;

export function clampWeight(weight: number) {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(100, Math.max(0, weight));
}

export function roundWeight(weight: number): number {
  return Math.round(weight * 100) / 100;
}

export function evenlySplitSelections(tickers: SupportedTicker[]): PortfolioSelection[] {
  if (tickers.length === 0) {
    return [];
  }

  const base = 100 / tickers.length;
  const selections = tickers.map((ticker) => ({ ticker, weight: base }));
  return normalizeSelections(selections);
}

export function normalizeSelections(selections: PortfolioSelection[]): PortfolioSelection[] {
  if (selections.length === 0) {
    return [];
  }

  const total = selections.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(total) < EPSILON) {
    return evenlySplitSelections(selections.map((item) => item.ticker));
  }

  const scaled = selections.map((item) => ({
    ticker: item.ticker,
    weight: roundWeight((item.weight / total) * 100)
  }));

  const delta = roundWeight(100 - scaled.reduce((sum, item) => sum + item.weight, 0));
  scaled[scaled.length - 1].weight = roundWeight(scaled[scaled.length - 1].weight + delta);
  return scaled;
}

export function rebalanceAfterWeightChange(
  selections: PortfolioSelection[],
  targetTicker: SupportedTicker,
  nextWeight: number
): PortfolioSelection[] {
  if (selections.length === 0) {
    return [];
  }

  const clampedWeight = clampWeight(nextWeight);
  const current = selections.map((item) => ({ ...item }));
  const targetIndex = current.findIndex((item) => item.ticker === targetTicker);
  if (targetIndex < 0) {
    return normalizeSelections(current);
  }

  const currentTargetWeight = current[targetIndex].weight;
  const remainingSelections = current.filter((item) => item.ticker !== targetTicker);
  const remainingCurrentTotal = remainingSelections.reduce((sum, item) => sum + item.weight, 0);
  const remainingNextTotal = Math.max(100 - clampedWeight, 0);

  const rebasedRemaining = remainingSelections.map((item) => ({
    ticker: item.ticker,
    weight:
      remainingCurrentTotal <= EPSILON || remainingSelections.length === 0
        ? remainingSelections.length === 0
          ? 0
          : remainingNextTotal / remainingSelections.length
        : (item.weight / remainingCurrentTotal) * remainingNextTotal
  }));

  const nextSelections = [
    ...rebasedRemaining,
    { ticker: targetTicker, weight: clampedWeight }
  ];

  const normalized = normalizeSelections(nextSelections);
  if (Math.abs(currentTargetWeight - clampedWeight) < EPSILON) {
    return normalized;
  }
  return normalized;
}

export function rebalanceAfterTickerChange(
  selections: PortfolioSelection[],
  ticker: SupportedTicker
): PortfolioSelection[] {
  const filtered = selections.filter((item) => item.ticker !== ticker);
  return normalizeSelections(filtered);
}

export function addTickerToSelections(
  selections: PortfolioSelection[],
  ticker: SupportedTicker
): PortfolioSelection[] {
  if (selections.some((item) => item.ticker === ticker)) {
    return selections;
  }

  const nextTickers = [...selections.map((item) => item.ticker), ticker].slice(0, 5);
  return evenlySplitSelections(nextTickers);
}

export function supportedTickerOptions(
  supportedTickers: SupportedTicker[],
  selected: SupportedTicker[]
): SupportedTicker[] {
  return supportedTickers.filter((ticker) => !selected.includes(ticker));
}
