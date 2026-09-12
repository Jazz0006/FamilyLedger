import { describe, expect, it } from 'vitest';
import { computeBalance } from './interest.js';

describe('same-effective-date rate precedence', () => {
  it('uses the later formal event sequence even when input order is reversed', () => {
    const result = computeBalance({
      principalSegments: [
        { deltaFen: 100_000, effectiveDate: '2026-01-01' },
      ],
      ratePeriods: [
        {
          annualEffectiveRate: '0.10',
          effectiveFrom: '2026-01-01',
          sequence: 2,
        },
        {
          annualEffectiveRate: '0.05',
          effectiveFrom: '2026-01-01',
          sequence: 1,
        },
      ],
      asOf: '2027-01-01',
    });

    expect(result.principalFen).toBe(100_000);
    expect(result.totalDueFen).toBe(110_000);
    expect(result.interestFen).toBe(10_000);
  });
});
