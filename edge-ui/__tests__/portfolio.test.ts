import { describe, it, expect } from 'vitest';
import { clampWeight, roundWeight, normalizeSelections, addTickerToSelections } from '../lib/portfolio';

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
});
