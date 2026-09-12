import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LedgerRequestType,
  RateSource,
  type CreateLoanPayload,
  type LedgerRequest,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { assertCreateLoanRequestStructure } from './validation.js';

function request(params?: Partial<LedgerRequest> & { payload?: CreateLoanPayload }): LedgerRequest {
  return {
    _id: 'req-1',
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: 'u1',
    counterpartyUserId: null,
    payload: {
      borrowerUserId: null,
      lenderUserId: 'u1',
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 100_000,
      rate: {
        annualEffectiveRate: '0.03',
        rateSource: RateSource.MANUAL,
      },
      proposedEffectiveDate: '2026-09-12',
    },
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: true,
    idempotencyKey: 'idem-1',
    requestFingerprint: 'fingerprint',
    createdAt: 1,
    updatedAt: 1,
    resolvedAt: null,
    expiresAt: 2,
    ...params,
  };
}

function expectValidationError(value: LedgerRequest): void {
  try {
    assertCreateLoanRequestStructure(value);
    throw new Error('expected validation error');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
  }
}

describe('CREATE_LOAN structure', () => {
  it('accepts a first-contact request with exactly one unknown party', () => {
    expect(() => assertCreateLoanRequestStructure(request())).not.toThrow();
  });

  it('accepts first-contact state after a distinct invite claimant is bound', () => {
    expect(() =>
      assertCreateLoanRequestStructure(
        request({
          status: LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
          counterpartyUserId: 'u2',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a first-contact request where both sides are unknown', () => {
    expectValidationError(
      request({
        payload: {
          ...(request().payload as CreateLoanPayload),
          lenderUserId: null,
        },
      }),
    );
  });

  it('rejects unknown-party role that does not match the null side', () => {
    expectValidationError(
      request({
        payload: {
          ...(request().payload as CreateLoanPayload),
          unknownPartyRole: 'LENDER',
        },
      }),
    );
  });

  it('rejects a first-contact request whose known side is not proposer', () => {
    expectValidationError(
      request({
        payload: {
          ...(request().payload as CreateLoanPayload),
          lenderUserId: 'someone-else',
        },
      }),
    );
  });

  it('accepts known-counterparty CREATE_LOAN when proposer and counterparty are opposite sides', () => {
    expect(() =>
      assertCreateLoanRequestStructure(
        request({
          counterpartyUserId: 'u2',
          requiresInitiatorVerify: false,
          payload: {
            borrowerUserId: 'u2',
            lenderUserId: 'u1',
            unknownPartyRole: null,
            initialPrincipalFen: 100_000,
            rate: {
              annualEffectiveRate: '0.03',
              rateSource: RateSource.MANUAL,
            },
            proposedEffectiveDate: '2026-09-12',
          },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects known-counterparty request with mismatched counterparty identity', () => {
    expectValidationError(
      request({
        counterpartyUserId: 'u3',
        requiresInitiatorVerify: false,
        payload: {
          borrowerUserId: 'u2',
          lenderUserId: 'u1',
          unknownPartyRole: null,
          initialPrincipalFen: 100_000,
          rate: {
            annualEffectiveRate: '0.03',
            rateSource: RateSource.MANUAL,
          },
          proposedEffectiveDate: '2026-09-12',
        },
      }),
    );
  });

  it('rejects unsafe or non-positive principal Fen', () => {
    for (const initialPrincipalFen of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expectValidationError(
        request({
          payload: {
            ...(request().payload as CreateLoanPayload),
            initialPrincipalFen,
          },
        }),
      );
    }
  });
});
