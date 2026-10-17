import { describe, expect, it } from 'vitest';
import { computeBalance, dailyRate, interestGrowthOn } from './interest.js';
import { daysBetween } from './dates.js';

const YUAN = 100;
const FIVE_PERCENT = [
  { annualEffectiveRate: '0.05', effectiveFrom: '2026-01-01' },
];

describe('dailyRate', () => {
  it('derives the daily rate so one year of 365 compounds ~= 5%', () => {
    const r = dailyRate('0.05');
    const yearGrowth = r.plus(1).pow(365).minus(1);
    expect(yearGrowth.toDecimalPlaces(10).toNumber()).toBeCloseTo(0.05, 10);
  });
});

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('counts a leap year February correctly', () => {
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
  });
  it('counts a non-leap year February correctly', () => {
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28);
  });
  it('spans a full year across a non-leap year', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('computeBalance — golden vectors', () => {
  it('rejects ledger state with no confirmed rate history', () => {
    expect(() =>
      computeBalance({
        principalSegments: [
          { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
        ],
        ratePeriods: [],
        asOf: '2026-01-01',
      }),
    ).toThrow('Missing confirmed rate history');
  });

  it('on the effective date, balance equals bare principal (day 0)', () => {
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
      ],
      ratePeriods: FIVE_PERCENT,
      asOf: '2026-01-01',
    });
    expect(r.principalFen).toBe(100_000 * YUAN);
    expect(r.interestFen).toBe(0);
    expect(r.totalDueFen).toBe(100_000 * YUAN);
  });

  it('100,000元 held one full year ~= 105,000元', () => {
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
      ],
      ratePeriods: FIVE_PERCENT,
      asOf: '2027-01-01',
    });
    expect(r.totalDueFen).toBe(105_000 * YUAN);
    expect(r.principalFen).toBe(100_000 * YUAN);
    expect(r.interestFen).toBe(5_000 * YUAN);
  });

  it('later-added principal only accrues from its own effective date', () => {
    const r = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
        { deltaFen: 50_000 * YUAN, effectiveDate: '2026-07-01' },
      ],
      ratePeriods: FIVE_PERCENT,
      asOf: '2027-01-01',
    });
    expect(r.principalFen).toBe(150_000 * YUAN);
    expect(r.totalDueFen).toBeGreaterThan(150_000 * YUAN);
    expect(r.interestFen).toBeLessThan(7_500 * YUAN);
  });

  it('a repayment stops that principal from accruing further', () => {
    const withRepay = computeBalance({
      principalSegments: [
        { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
        { deltaFen: -40_000 * YUAN, effectiveDate: '2026-07-01' },
      ],
      ratePeriods: FIVE_PERCENT,
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
      ratePeriods: FIVE_PERCENT,
      asOf: '2026-09-11',
    };
    expect(computeBalance(input)).toEqual(computeBalance(input));
  });
});

describe('interestGrowthOn — 今日增加', () => {
  it('reports pure interest, excluding same-day principal additions', () => {
    const growth = interestGrowthOn(
      {
        principalSegments: [
          { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
          { deltaFen: 20_000 * YUAN, effectiveDate: '2026-09-11' },
        ],
        ratePeriods: FIVE_PERCENT,
        asOf: '2026-09-11',
      },
      '2026-09-10',
    );
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(100 * YUAN);
  });
});
