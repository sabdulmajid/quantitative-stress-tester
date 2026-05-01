export type SupportedTicker = string;

export type PortfolioSelection = {
  ticker: SupportedTicker;
  weight: number;
};

export type ConfidenceLevel = 0.95 | 0.99;
export type HorizonDays = 1 | 10 | 252;

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
  horizon_days?: HorizonDays;
  confidence_level?: ConfidenceLevel;
  risk_free_rate?: number;
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
  var_99: number;
  value_at_risk: number;
  cvar: number;
  annualized_volatility: number;
  sharpe_ratio: number;
  confidence_level: ConfidenceLevel;
  expected_return: number;
  histogram: HistogramBin[];
  elapsed_ms: number;
  data_fetch_ms: number;
  total_roundtrip_ms: number;
  horizon_days: HorizonDays;
  risk_free_rate: number;
  tickers: SupportedTicker[];
  weights: number[];
  mu: number[];
  covariance_matrix: number[][];
  correlation_matrix: number[][];
  provider?: string;
  range?: string;
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
  horizon_days: HorizonDays;
  seed: number;
  confidence_level: ConfidenceLevel;
  risk_free_rate: number;
  expected_return: number;
  var_95: number;
  var_99: number;
  value_at_risk: number;
  cvar: number;
  annualized_volatility: number;
  sharpe_ratio: number;
  elapsed_ms: number;
  data_fetch_ms: number | null;
  total_roundtrip_ms: number | null;
  created_at: string;
  provider: string | null;
  range: string | null;
};

export type StressRunHistoryResponse = {
  runs: StressRunRecord[];
};
