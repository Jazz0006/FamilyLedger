import { describe, expect, it } from 'vitest';
import { LoanEventType, type LoanEvent } from '@family-ledger/shared';
import { toInterestInput } from './from-events.js';
import { computeBalance } from './interest.js';

const YUAN = 100;

function evt(partial: Partial<LoanEvent> & Pick<LoanEvent, 'eventType' | 'effectiveDate'>): LoanEvent {
  return {
    _id: partial._id ?? 'e' + Math.round(partial.amountFen ?? 0),
    loanId: 'loan1',
    amountFen: null,
    sourceRequestId: null,
    createdBy: 'admin',
    confirmedBy: 'admin',
    createdAt: 0,
    idempotencyKey: partial._id ?? 'key',
    schemaVersion: 1,
    ...partial,
  };
}

describe('toInterestInput', () => {
  it('maps PRINCIPAL_ADD to a positive segment', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.PRINCIPAL_ADD,
          amountFen: 100_000 * YUAN,
          effectiveDate: '2026-01-01',
        }),
      ],
      '2026-01-01',
    );
    expect(input.principalSegments).toEqual([
      { deltaFen: 100_000 * YUAN, effectiveDate: '2026-01-01' },
    ]);
  });

  it('maps PRINCIPAL_REPAY (stored positive) to a negative segment', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.PRINCIPAL_REPAY,
          amountFen: 30_000 * YUAN,
          effectiveDate: '2026-06-01',
        }),
      ],
      '2026-06-01',
    );
    expect(input.principalSegments[0]).toEqual({
      deltaFen: -30_000 * YUAN,
      effectiveDate: '2026-06-01',
    });
  });

  it('round-trips events -> input -> balance for the headline case', () => {
    const events = [
      evt({
        eventType: LoanEventType.PRINCIPAL_ADD,
        amountFen: 100_000 * YUAN,
        effectiveDate: '2026-01-01',
      }),
    ];
    const balance = computeBalance(toInterestInput(events, '2027-01-01'));
    expect(balance.totalDueFen).toBe(105_000 * YUAN);
  });

  it('carries a signed CORRECTION delta', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.CORRECTION,
          amountFen: -5_000 * YUAN, // lowering correction
          effectiveDate: '2026-03-01',
        }),
      ],
      '2026-03-01',
    );
    expect(input.principalSegments[0]?.deltaFen).toBe(-5_000 * YUAN);
  });

  it('maps RATE_CHANGE to a rate period', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.RATE_CHANGE,
          rate: '0.06',
          effectiveDate: '2026-07-01',
        }),
      ],
      '2026-12-01',
    );
    expect(input.ratePeriods).toEqual([
      { annualEffectiveRate: '0.06', effectiveFrom: '2026-07-01' },
    ]);
  });
});
