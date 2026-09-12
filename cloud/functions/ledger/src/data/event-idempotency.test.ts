import { describe, expect, it } from 'vitest';
import { LoanEventType } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import {
  assertSameEventMutation,
  eventIdempotencyKey,
  sameEventMutation,
} from './event-idempotency.js';
import type { NewLoanEvent } from './repo.js';

function sample(): NewLoanEvent {
  return {
    loanId: 'loan-1',
    eventType: LoanEventType.PRINCIPAL_ADD,
    amountFen: 10_000,
    effectiveDate: '2026-09-12',
    sourceRequestId: 'request-1',
    createdBy: 'u1',
    confirmedBy: 'u2',
    sequence: 1,
    idempotencyKey: 'request-1:principal-add',
    createdAt: 1,
    schemaVersion: 2,
  };
}

function closeSample(accruedInterestFen: number): NewLoanEvent {
  return {
    loanId: 'loan-1',
    eventType: LoanEventType.LOAN_CLOSED,
    amountFen: null,
    closeSettlement: { accruedInterestFen },
    effectiveDate: '2027-01-01',
    sourceRequestId: 'request-close',
    createdBy: 'u1',
    confirmedBy: 'u2',
    sequence: 9,
    idempotencyKey: 'request-close:loan-close',
    createdAt: 2,
    schemaVersion: 2,
  };
}

describe('formal event idempotency', () => {
  it('derives deterministic keys from request and event purpose', () => {
    expect(eventIdempotencyKey('request-1', 'initial-principal')).toBe(
      'request-1:initial-principal',
    );
    expect(eventIdempotencyKey('request-1', 'initial-rate')).toBe(
      'request-1:initial-rate',
    );
    expect(eventIdempotencyKey('request-close', 'loan-close')).toBe(
      'request-close:loan-close',
    );
  });

  it('rejects ambiguous request ids in deterministic keys', () => {
    expect(() => eventIdempotencyKey('request:bad', 'principal-add')).toThrow(
      AppError,
    );
  });

  it('treats an identical retry as the same mutation', () => {
    expect(sameEventMutation(sample(), sample())).toBe(true);
    expect(() => assertSameEventMutation(sample(), sample())).not.toThrow();
  });

  it('conflicts when one event key is reused for different content', () => {
    const first = sample();
    const changed = { ...first, amountFen: 20_000 };
    expect(sameEventMutation(first, changed)).toBe(false);

    try {
      assertSameEventMutation(first, changed);
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    }
  });

  it('treats a changed close settlement snapshot as different event content', () => {
    expect(sameEventMutation(closeSample(5_000), closeSample(5_000))).toBe(true);
    expect(sameEventMutation(closeSample(5_000), closeSample(5_001))).toBe(false);
    expect(() =>
      assertSameEventMutation(closeSample(5_000), closeSample(5_001)),
    ).toThrow(AppError);
  });
});
