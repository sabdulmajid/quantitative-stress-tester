export type SupportedTicker = string;

export type PortfolioSelection = {
  ticker: SupportedTicker;
  weight: number;
};

export type HistogramBin = {
  bin_start: number;
  bin_end: number;
  frequency: number;
};

export type AppUser = {
  id: string;
  email: string | null;
};

export type StressTestRequest = {
  tickers: SupportedTicker[];
  weights: number[];
  horizon_days?: number;
  seed?: number;
};

export type TickerUniverseResponse = {
  provider: string;
  range: string;
  cache_ttl_seconds: number;
  max_portfolio_tickers: number;
  padded_asset_count: number;
  tickers: SupportedTicker[];
};

export type StressTestResponse = {
  var_95: number;
  expected_return: number;
  histogram: HistogramBin[];
  elapsed_ms: number;
};

export type SavedPortfolio = {
  name: string;
  selections: PortfolioSelection[];
  updated_at: string;
};

export type SavedPortfolioResponse = {
  portfolio: SavedPortfolio | null;
};

export type SavePortfolioRequest = {
  name?: string;
  selections: PortfolioSelection[];
};

export type StressRunRecord = {
  id: string;
  tickers: SupportedTicker[];
  weights: number[];
  horizon_days: number;
  seed: number;
  expected_return: number;
  var_95: number;
  elapsed_ms: number;
  created_at: string;
  provider: string | null;
  range: string | null;
};

export type StressRunHistoryResponse = {
  runs: StressRunRecord[];
};
