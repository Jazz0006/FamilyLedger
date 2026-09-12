import { describe, expect, it } from 'vitest';
import {
  LedgerRequestType,
  RateSource,
  type CorrectionPayload,
  type CreateLoanPayload,
  type RateChangePayload,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import {
  assertMatchingRequestFingerprint,
  computeRequestFingerprint,
  type RequestFingerprintInput,
} from './request-fingerprint.js';

function baseInput(): RequestFingerprintInput {
  return {
    type: LedgerRequestType.PRINCIPAL_REPAY,
    loanId: 'loan-1',
    proposerUserId: 'u1',
    counterpartyUserId: 'u2',
    requiresInitiatorVerify: false,
    payload: {
      amountFen: 12_300,
      proposedEffectiveDate: '2026-09-12',
      note: 'repayment',
    },
  };
}

describe('request fingerprint', () => {
  it('is stable when object keys are reordered', () => {
    const a = baseInput();
    const b: RequestFingerprintInput = {
      payload: {
        note: 'repayment',
        proposedEffectiveDate: '2026-09-12',
        amountFen: 12_300,
      },
      requiresInitiatorVerify: false,
      counterpartyUserId: 'u2',
      proposerUserId: 'u1',
      loanId: 'loan-1',
      type: LedgerRequestType.PRINCIPAL_REPAY,
    };
    expect(computeRequestFingerprint(a)).toBe(computeRequestFingerprint(b));
  });

  it('changes when amount changes', () => {
    const a = baseInput();
    const b: RequestFingerprintInput = {
      ...a,
      payload: {
        amountFen: 12_301,
        proposedEffectiveDate: '2026-09-12',
        note: 'repayment',
      },
    };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('changes when Loan changes', () => {
    const a = baseInput();
    const b: RequestFingerprintInput = { ...a, loanId: 'loan-2' };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('changes when counterparty changes', () => {
    const a = baseInput();
    const b: RequestFingerprintInput = { ...a, counterpartyUserId: 'u3' };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('includes rate snapshot value and metadata', () => {
    const payload: RateChangePayload = {
      rate: {
        annualEffectiveRate: '0.03',
        rateSource: RateSource.CPI_REFERENCE,
        rateReferenceYear: 2026,
        rateReferenceLabel: 'CPI 2026',
      },
      proposedEffectiveDate: '2027-01-01',
    };
    const a: RequestFingerprintInput = {
      ...baseInput(),
      type: LedgerRequestType.RATE_CHANGE,
      payload,
    };
    const b: RequestFingerprintInput = {
      ...a,
      payload: {
        ...payload,
        rate: { ...payload.rate, rateReferenceYear: 2025 },
      },
    };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('includes CREATE_LOAN direction and unknown-party semantics', () => {
    const payload: CreateLoanPayload = {
      borrowerUserId: null,
      lenderUserId: 'u1',
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 100_000,
      rate: { annualEffectiveRate: '0.03', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
    };
    const a: RequestFingerprintInput = {
      type: LedgerRequestType.CREATE_LOAN,
      loanId: null,
      proposerUserId: 'u1',
      counterpartyUserId: null,
      requiresInitiatorVerify: true,
      payload,
    };
    const b: RequestFingerprintInput = {
      ...a,
      payload: {
        ...payload,
        borrowerUserId: 'u1',
        lenderUserId: null,
        unknownPartyRole: 'LENDER',
      },
    };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('includes principal correction target, delta and reason', () => {
    const payload: CorrectionPayload = {
      correctionKind: 'PRINCIPAL',
      targetEventId: 'event-1',
      principalDeltaFen: -500,
      reason: 'fix',
    };
    const a: RequestFingerprintInput = {
      ...baseInput(),
      type: LedgerRequestType.CORRECTION,
      payload,
    };
    const b: RequestFingerprintInput = {
      ...a,
      payload: { ...payload, principalDeltaFen: -501 },
    };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('includes rate correction replacement rate metadata', () => {
    const payload: CorrectionPayload = {
      correctionKind: 'RATE',
      targetEventId: 'rate-event',
      replacementRate: {
        annualEffectiveRate: '0.04',
        rateSource: RateSource.MANUAL,
      },
      reason: null,
    };
    const a: RequestFingerprintInput = {
      ...baseInput(),
      type: LedgerRequestType.CORRECTION,
      payload,
    };
    const b: RequestFingerprintInput = {
      ...a,
      payload: {
        ...payload,
        replacementRate: { ...payload.replacementRate, annualEffectiveRate: '0.05' },
      },
    };
    expect(computeRequestFingerprint(a)).not.toBe(computeRequestFingerprint(b));
  });

  it('does not hash server-derived Correction effectiveDate or UI-only fields', () => {
    const payload: CorrectionPayload = {
      correctionKind: 'PRINCIPAL',
      targetEventId: 'event-1',
      principalDeltaFen: -500,
      reason: 'fix',
    };
    const a: RequestFingerprintInput = {
      ...baseInput(),
      type: LedgerRequestType.CORRECTION,
      payload,
    };
    const extended = {
      ...a,
      payload: {
        ...payload,
        proposedEffectiveDate: '2099-01-01',
        uiDraftId: 'client-only',
      },
    } as unknown as RequestFingerprintInput;
    expect(computeRequestFingerprint(extended)).toBe(computeRequestFingerprint(a));
  });

  it('does not hash top-level transport/server-only fields passed accidentally', () => {
    const a = baseInput();
    const extended = {
      ...a,
      _id: 'server-id',
      status: 'PENDING',
      createdAt: 123,
      requestFingerprint: 'old-value',
    } as RequestFingerprintInput;
    expect(computeRequestFingerprint(extended)).toBe(computeRequestFingerprint(a));
  });

  it('does not hash non-semantic payload fields', () => {
    const a = baseInput();
    const extended = {
      ...a,
      payload: {
        ...(a.payload as unknown as Record<string, unknown>),
        uiDraftId: 'temporary-client-only-value',
      },
    } as unknown as RequestFingerprintInput;
    expect(computeRequestFingerprint(extended)).toBe(computeRequestFingerprint(a));
  });

  it('normalizes absent optional note and explicit null note', () => {
    const withoutNote: RequestFingerprintInput = {
      ...baseInput(),
      payload: { amountFen: 12_300, proposedEffectiveDate: '2026-09-12' },
    };
    const nullNote: RequestFingerprintInput = {
      ...withoutNote,
      payload: {
        amountFen: 12_300,
        proposedEffectiveDate: '2026-09-12',
        note: null,
      },
    };
    expect(computeRequestFingerprint(withoutNote)).toBe(
      computeRequestFingerprint(nullNote),
    );
  });

  it('treats same idempotency key with different fingerprint as CONFLICT', () => {
    const first = computeRequestFingerprint(baseInput());
    const changed = computeRequestFingerprint({ ...baseInput(), loanId: 'loan-other' });
    expect(() =>
      assertMatchingRequestFingerprint({
        storedFingerprint: first,
        incomingFingerprint: first,
      }),
    ).not.toThrow();
    try {
      assertMatchingRequestFingerprint({
        storedFingerprint: first,
        incomingFingerprint: changed,
      });
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    }
  });
});
