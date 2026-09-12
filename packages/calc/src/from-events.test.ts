import { describe, expect, it } from 'vitest';
import {
  LoanEventType,
  RateSource,
  type LoanEvent,
  type RateSnapshot,
} from '@family-ledger/shared';
import { toInterestInput } from './from-events.js';
import { computeBalance } from './interest.js';

const YUAN = 100;

function rate(annualEffectiveRate: string): RateSnapshot {
  return {
    annualEffectiveRate,
    rateSource: RateSource.MANUAL,
  };
}

function evt(
  partial: Partial<LoanEvent> & Pick<LoanEvent, 'eventType' | 'effectiveDate'>,
): LoanEvent {
  return {
    _id: partial._id ?? 'e' + Math.round(partial.amountFen ?? 0),
    loanId: 'loan1',
    amountFen: null,
    sourceRequestId: 'request1',
    createdBy: 'user1',
    confirmedBy: 'user2',
    sequence: partial.sequence ?? 1,
    createdAt: 0,
    idempotencyKey: partial._id ?? 'key',
    schemaVersion: 2,
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

  it('round-trips genesis events -> input -> balance for the headline case', () => {
    const events = [
      evt({
        eventType: LoanEventType.PRINCIPAL_ADD,
        amountFen: 100_000 * YUAN,
        effectiveDate: '2026-01-01',
        sequence: 1,
      }),
      evt({
        _id: 'initial-rate',
        eventType: LoanEventType.RATE_CHANGE,
        rate: rate('0.05'),
        effectiveDate: '2026-01-01',
        sequence: 2,
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
          amountFen: -5_000 * YUAN,
          effectiveDate: '2026-03-01',
        }),
      ],
      '2026-03-01',
    );
    expect(input.principalSegments[0]?.deltaFen).toBe(-5_000 * YUAN);
  });

  it('maps RATE_CHANGE snapshot to a rate period with source sequence', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.RATE_CHANGE,
          rate: rate('0.06'),
          effectiveDate: '2026-07-01',
          sequence: 1,
        }),
      ],
      '2026-12-01',
    );
    expect(input.ratePeriods).toEqual([
      {
        annualEffectiveRate: '0.06',
        effectiveFrom: '2026-07-01',
        sequence: 1,
      },
    ]);
  });

  it('ignores LOAN_CLOSED for historical money math', () => {
    const input = toInterestInput(
      [
        evt({
          eventType: LoanEventType.LOAN_CLOSED,
          effectiveDate: '2026-12-31',
        }),
      ],
      '2026-12-31',
    );
    expect(input.principalSegments).toEqual([]);
    expect(input.ratePeriods).toEqual([]);
  });
});