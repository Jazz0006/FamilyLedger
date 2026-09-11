import { describe, expect, it } from 'vitest';
import { computeBalance, dailyRate, interestGrowthOn } from './interest.js';
import { daysBetween } from './dates.js';

const YUAN = 100; // 分 per 元

describe('dailyRate', () => {
  it('derives the daily rate so one year of 365 compounds ~= 5%', () => {
    const r = dailyRate('0.05');
    const yearGrowth = r.plus(1).pow(365).minus(1);
    // Should be essentially exactly 0.05 (spec Rule D).
    expect(yearGrowth.toDecimalPlaces(10).toNumber()).toBeCloseTo(0.05, 10);
  });
});

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('counts a leap year February correctly', () => {
    // 2024 is a leap year: Feb has 29 days.
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
  });
  it('counts a non-leap year February correctly', () => {
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28);
  });
  it('spans a full year (365 days) across a non-leap year', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('computeBalance — golden vectors', () => {
  it('on the effective date, balance equals bare principal (day 0)', () => {
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
      ],
      asOf: '2026-01-01',
    });
    expect(r.principalFen).toBe(100_000 * YUAN);
    expect(r.interestFen).toBe(0);
    expect(r.totalDueFen).toBe(100_000 * YUAN);
  });

  it('100,000元 held one full year ~= 105,000元 (spec Rule D headline)', () => {
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
      ],
      asOf: '2027-01-01', // 365 days later
    });
    // 105,000.00 元 = 10,500,000 分, within rounding.
    expect(r.totalDueFen).toBe(105_000 * YUAN);
    expect(r.principalFen).toBe(100_000 * YUAN);
    expect(r.interestFen).toBe(5_000 * YUAN);
  });

  it('later-added principal only accrues from its own effective date', () => {
    // 100k from Jan 1, +50k from Jul 1, valued at next Jan 1.
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
        { deltaFen: 50_000 * YUAN, effectiveDate: '2026-07-01' },
      ],
      asOf: '2027-01-01',
    });
    // First tranche: full year -> 105,000. Second: 184 days.
    expect(r.principalFen).toBe(150_000 * YUAN);
    expect(r.totalDueFen).toBeGreaterThan(150_000 * YUAN);
    // Sanity: total interest less than if all 150k ran a full year.
    expect(r.interestFen).toBeLessThan(7_500 * YUAN);
  });

  it('a repayment stops that principal from accruing further', () => {
    const withRepay = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
        { deltaFen: -40_000 * YUAN, effectiveDate: '2026-07-01' },
      ],
      asOf: '2027-01-01',
    });
    expect(withRepay.principalFen).toBe(60_000 * YUAN);
    expect(withRepay.totalDueFen).toBeGreaterThan(60_000 * YUAN);
  });

  it('is deterministic: identical inputs give identical 分', () => {
    const input = {
      principalSegments: [
        { deltaFen: 12_345 * YUAN, effectiveDate: '2026-03-15' },
      ],
      asOf: '2026-09-11',
    };
    expect(computeBalance(input)).toEqual(computeBalance(input));
  });
});

describe('interestGrowthOn — 今日增加', () => {
  it('reports pure interest, excluding same-day principal additions', () => {
    // Big principal add today must NOT be counted as today's interest.
    const growth = interestGrowthOn(
      {
        principalSegments: [
          { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
          { deltaFen: 20_000 * YUAN, effectiveDate: '2026-09-11' }, // today
        ],
        asOf: '2026-09-11',
      },
      '2026-09-10',
    );
    // The 20,000元 add contributes 0 interest on its effective day, so today's
    // interest is only the growth on the original 100,000元 — a small number,
    // definitely far less than the 20,000元 principal.
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(100 * YUAN);
  });
});
