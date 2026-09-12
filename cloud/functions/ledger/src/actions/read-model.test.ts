import { describe, expect, it } from 'vitest';
import {
  LoanEventType,
  LoanStatus,
  RateSource,
  type Loan,
  type LoanEvent,
} from '@family-ledger/shared';
import { deriveLoanSummary } from './read-model.js';

const loan: Loan = {
  _id: 'loan-1',
  lenderUserId: 'lender',
  borrowerUserId: 'borrower',
  currency: 'CNY',
  ledgerTimezone: 'Asia/Shanghai',
  createdFromRequestId: 'request-1',
  status: LoanStatus.ACTIVE,
  createdAt: 1,
  closedAt: null,
};

function event(
  partial: Partial<LoanEvent> & Pick<LoanEvent, 'eventType' | 'sequence' | 'effectiveDate'>,
): LoanEvent {
  return {
    _id: `event-${partial.sequence}`,
    loanId: loan._id,
    amountFen: null,
    sourceRequestId: 'request-1',
    createdBy: 'lender',
    confirmedBy: 'borrower',
    idempotencyKey: `event-key-${partial.sequence}`,
    createdAt: partial.sequence,
    schemaVersion: 2,
    ...partial,
  };
}

describe('deriveLoanSummary', () => {
  it('reports zero today-interest on the genesis effective date', () => {
    const summary = deriveLoanSummary(
      loan,
      [
        event({
          eventType: LoanEventType.PRINCIPAL_ADD,
          sequence: 1,
          effectiveDate: '2026-09-12',
          amountFen: 100_000,
        }),
        event({
          eventType: LoanEventType.RATE_CHANGE,
          sequence: 2,
          effectiveDate: '2026-09-12',
          rate: {
            annualEffectiveRate: '0.05',
            rateSource: RateSource.MANUAL,
            rateReferenceLabel: 'agreed 5%',
          },
        }),
      ],
      '2026-09-12',
    );

    expect(summary.principalFen).toBe(100_000);
    expect(summary.interestFen).toBe(0);
    expect(summary.todayInterestFen).toBe(0);
    expect(summary.currentRate.rateReferenceLabel).toBe('agreed 5%');
  });

  it('selects the latest effective confirmed RateSnapshot metadata', () => {
    const summary = deriveLoanSummary(
      loan,
      [
        event({
          eventType: LoanEventType.PRINCIPAL_ADD,
          sequence: 1,
          effectiveDate: '2026-01-01',
          amountFen: 100_000,
        }),
        event({
          eventType: LoanEventType.RATE_CHANGE,
          sequence: 2,
          effectiveDate: '2026-01-01',
          rate: {
            annualEffectiveRate: '0.02',
            rateSource: RateSource.MANUAL,
          },
        }),
        event({
          eventType: LoanEventType.RATE_CHANGE,
          sequence: 3,
          effectiveDate: '2026-07-01',
          rate: {
            annualEffectiveRate: '0.03',
            rateSource: RateSource.CPI_REFERENCE,
            rateReferenceYear: 2026,
            rateReferenceLabel: 'CPI reference 2026',
          },
        }),
      ],
      '2026-09-12',
    );

    expect(summary.currentRate.annualEffectiveRate).toBe('0.03');
    expect(summary.currentRate.rateSource).toBe(RateSource.CPI_REFERENCE);
    expect(summary.currentRate.rateReferenceYear).toBe(2026);
  });
});
