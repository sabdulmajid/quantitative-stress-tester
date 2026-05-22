import { describe, it, expect } from 'vitest';
import { buildRunExport, runExportFilename } from '../lib/export';
import { clampWeight, roundWeight, normalizeSelections, addTickerToSelections } from '../lib/portfolio';
import type { StressTestRequest, StressTestResponse } from '../lib/types';

describe('portfolio util functions', () => {
  it('clampWeight should clamp values between 0 and 100', () => {
    expect(clampWeight(150)).toBe(100);
    expect(clampWeight(-50)).toBe(0);
    expect(clampWeight(50)).toBe(50);
  });

  it('roundWeight should round to two decimal places', () => {
    expect(roundWeight(33.333333)).toBe(33.33);
    expect(roundWeight(66.666666)).toBe(66.67);
  });

  it('normalizeSelections should make weights sum up to 100', () => {
    const selections = [
      { ticker: 'AAPL', weight: 50 },
      { ticker: 'MSFT', weight: 50 },
    ];
    const normalized = normalizeSelections(selections);
    expect(normalized.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
    expect(normalized[0].weight).toBe(50);
    expect(normalized[1].weight).toBe(50);
  });

  it('addTickerToSelections should evenly split when adding up to max limits', () => {
    const selections = [
      { ticker: 'AAPL', weight: 100 },
    ];
    const newSelections = addTickerToSelections(selections, 'MSFT');
    expect(newSelections.length).toBe(2);
    expect(newSelections[0].weight).toBe(50);
    expect(newSelections[1].weight).toBe(50);
  });

  it('buildRunExport should include inputs, risk metrics, timings, and attribution', () => {
    const request: StressTestRequest = {
      tickers: ['AAPL', 'MSFT'],
      weights: [60, 40],
      horizon_days: 252,
      confidence_level: 0.99,
      risk_free_rate: 0.02,
      scenario_id: 'financial_crisis_2008'
    };
    const result: StressTestResponse = {
      var_95: 0.12,
      var_99: 0.18,
      value_at_risk: 0.18,
      cvar: 0.22,
      annualized_volatility: 0.31,
      sharpe_ratio: -0.42,
      confidence_level: 0.99,
      expected_return: -0.07,
      histogram: [],
      elapsed_ms: 90,
      data_fetch_ms: 15,
      total_roundtrip_ms: 128,
      horizon_days: 252,
      risk_free_rate: 0.02,
      scenario: {
        id: 'financial_crisis_2008',
        label: '2008 Financial Crisis',
        description: 'Test scenario',
        drift_multiplier: -1.25,
        covariance_multiplier: 2.4
      },
      risk_contributions: [
        {
          ticker: 'AAPL',
          weight: 0.6,
          marginal_volatility: 0.2,
          volatility_contribution: 0.12,
          contribution_percent: 0.65
        }
      ],
      tickers: ['AAPL', 'MSFT'],
      weights: [0.6, 0.4],
      mu: [-0.08, -0.05],
      covariance_matrix: [[0.1, 0.02], [0.02, 0.08]],
      correlation_matrix: [[1, 0.22], [0.22, 1]],
      provider: 'Yahoo Finance',
      range: '3y'
    };

    const exported = buildRunExport(request, result, '2026-05-22T00:00:00.000Z');

    expect(exported.schema_version).toBe('quant-stress-engine.run.v1');
    expect(exported.request.scenario_id).toBe('financial_crisis_2008');
    expect(exported.inputs.covariance_matrix[0][0]).toBe(0.1);
    expect(exported.risk_metrics.cvar).toBe(0.22);
    expect(exported.risk_contributions[0].ticker).toBe('AAPL');
    expect(exported.timings_ms.gateway_roundtrip).toBe(128);
    expect(runExportFilename('2026-05-22T00:00:00.000Z')).toBe('quant-stress-run-2026-05-22T00-00-00-000Z.json');
  });
});
