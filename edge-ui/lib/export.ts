import type {
  HistogramBin,
  RiskContribution,
  ScenarioShock,
  StressTestRequest,
  StressTestResponse,
  SupportedTicker
} from "@/lib/types";

export type StressRunExport = {
  schema_version: "quant-stress-engine.run.v1";
  exported_at: string;
  request: StressTestRequest;
  scenario: ScenarioShock;
  risk_metrics: {
    expected_return: number;
    var_95: number;
    var_99: number;
    value_at_risk: number;
    cvar: number;
    annualized_volatility: number;
    sharpe_ratio: number;
    confidence_level: number;
  };
  inputs: {
    tickers: SupportedTicker[];
    weights: number[];
    mu: number[];
    covariance_matrix: number[][];
    correlation_matrix: number[][];
  };
  risk_contributions: RiskContribution[];
  histogram: HistogramBin[];
  timings_ms: {
    compute: number;
    data_fetch: number;
    gateway_roundtrip: number;
  };
  metadata: {
    provider: string | null;
    range: string | null;
    padded_asset_count: 50;
    monte_carlo_paths: 100000;
    histogram_bins: 50;
  };
};

export function buildRunExport(
  request: StressTestRequest,
  result: StressTestResponse,
  exportedAt = new Date().toISOString()
): StressRunExport {
  return {
    schema_version: "quant-stress-engine.run.v1",
    exported_at: exportedAt,
    request,
    scenario: result.scenario,
    risk_metrics: {
      expected_return: result.expected_return,
      var_95: result.var_95,
      var_99: result.var_99,
      value_at_risk: result.value_at_risk,
      cvar: result.cvar,
      annualized_volatility: result.annualized_volatility,
      sharpe_ratio: result.sharpe_ratio,
      confidence_level: result.confidence_level
    },
    inputs: {
      tickers: result.tickers,
      weights: result.weights,
      mu: result.mu,
      covariance_matrix: result.covariance_matrix,
      correlation_matrix: result.correlation_matrix
    },
    risk_contributions: result.risk_contributions,
    histogram: result.histogram,
    timings_ms: {
      compute: result.elapsed_ms,
      data_fetch: result.data_fetch_ms,
      gateway_roundtrip: result.total_roundtrip_ms
    },
    metadata: {
      provider: result.provider ?? null,
      range: result.range ?? null,
      padded_asset_count: 50,
      monte_carlo_paths: 100000,
      histogram_bins: 50
    }
  };
}

export function runExportFilename(exportedAt = new Date().toISOString()) {
  return `quant-stress-run-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildRunExportCsv(exportPayload: StressRunExport) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["section", "name", "value"],
    ["metadata", "schema_version", exportPayload.schema_version],
    ["metadata", "exported_at", exportPayload.exported_at],
    ["metadata", "provider", exportPayload.metadata.provider],
    ["metadata", "range", exportPayload.metadata.range],
    ["request", "tickers", exportPayload.request.tickers.join(" ")],
    ["request", "weights", exportPayload.request.weights.join(" ")],
    ["request", "horizon_days", exportPayload.request.horizon_days],
    ["request", "confidence_level", exportPayload.request.confidence_level],
    ["request", "risk_free_rate", exportPayload.request.risk_free_rate],
    ["scenario", "id", exportPayload.scenario.id],
    ["scenario", "label", exportPayload.scenario.label],
    ["scenario", "drift_multiplier", exportPayload.scenario.drift_multiplier],
    ["scenario", "covariance_multiplier", exportPayload.scenario.covariance_multiplier],
    ["metrics", "expected_return", exportPayload.risk_metrics.expected_return],
    ["metrics", "var_95", exportPayload.risk_metrics.var_95],
    ["metrics", "var_99", exportPayload.risk_metrics.var_99],
    ["metrics", "value_at_risk", exportPayload.risk_metrics.value_at_risk],
    ["metrics", "cvar", exportPayload.risk_metrics.cvar],
    ["metrics", "annualized_volatility", exportPayload.risk_metrics.annualized_volatility],
    ["metrics", "sharpe_ratio", exportPayload.risk_metrics.sharpe_ratio],
    ["timings_ms", "compute", exportPayload.timings_ms.compute],
    ["timings_ms", "data_fetch", exportPayload.timings_ms.data_fetch],
    ["timings_ms", "gateway_roundtrip", exportPayload.timings_ms.gateway_roundtrip],
    ["inputs", "mu", exportPayload.inputs.mu.join(" ")],
    ["inputs", "covariance_matrix", JSON.stringify(exportPayload.inputs.covariance_matrix)],
    ["inputs", "correlation_matrix", JSON.stringify(exportPayload.inputs.correlation_matrix)],
    ["risk_attribution", "rows", JSON.stringify(exportPayload.risk_contributions)],
    ["histogram", "bins", JSON.stringify(exportPayload.histogram)]
  ];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

export function runExportCsvFilename(exportedAt = new Date().toISOString()) {
  return `quant-stress-run-${exportedAt.replace(/[:.]/g, "-")}.csv`;
}
