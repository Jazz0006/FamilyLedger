import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LoanStatus,
  type Loan,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import {
  assertCanCancelRequest,
  assertCanProposeLoanChange,
  assertCanRespondToKnownCounterpartyRequest,
  assertCanVerifyFirstContact,
  assertLoanParticipant,
  getLoanCounterpartyUserId,
  isLoanParticipant,
} from './permissions.js';

function loan(id: string, lenderUserId: string, borrowerUserId: string): Loan {
  return {
    _id: id,
    lenderUserId,
    borrowerUserId,
    currency: 'CNY',
    ledgerTimezone: 'Asia/Shanghai',
    createdFromRequestId: `req-${id}`,
    status: LoanStatus.ACTIVE,
    createdAt: 1,
    closedAt: null,
  };
}

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('loan participant permissions', () => {
  it('supports the same user as lender in one Loan and borrower in another', () => {
    const asLender = loan('l1', 'u1', 'u2');
    const asBorrower = loan('l2', 'u3', 'u1');

    expect(isLoanParticipant(asLender, 'u1')).toBe(true);
    expect(isLoanParticipant(asBorrower, 'u1')).toBe(true);
    expect(getLoanCounterpartyUserId(asLender, 'u1')).toBe('u2');
    expect(getLoanCounterpartyUserId(asBorrower, 'u1')).toBe('u3');
  });

  it('allows both Loan participants to read/propose and rejects unrelated users', () => {
    const value = loan('l1', 'lender', 'borrower');

    expect(() => assertLoanParticipant(value, 'lender')).not.toThrow();
    expect(() => assertLoanParticipant(value, 'borrower')).not.toThrow();
    expect(() => assertCanProposeLoanChange(value, 'lender')).not.toThrow();
    expect(() => assertCanProposeLoanChange(value, 'borrower')).not.toThrow();
    expectCode(() => assertLoanParticipant(value, 'stranger'), ErrorCode.FORBIDDEN);
    expectCode(
      () => assertCanProposeLoanChange(value, 'stranger'),
      ErrorCode.FORBIDDEN,
    );
  });
});

describe('request permissions', () => {
  const knownPending = {
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: false,
    proposerUserId: 'u1',
    counterpartyUserId: 'u2',
  } as const;

  it('counterparty can accept/reject a normal pending request', () => {
    expect(() =>
      assertCanRespondToKnownCounterpartyRequest(knownPending, 'u2'),
    ).not.toThrow();
  });

  it('proposer cannot accept/reject their own request', () => {
    expectCode(
      () => assertCanRespondToKnownCounterpartyRequest(knownPending, 'u1'),
      ErrorCode.FORBIDDEN,
    );
  });

  it('unrelated user cannot accept/reject a request', () => {
    expectCode(
      () => assertCanRespondToKnownCounterpartyRequest(knownPending, 'u3'),
      ErrorCode.FORBIDDEN,
    );
  });

  it('only proposer can cancel while cancellation is a legal transition', () => {
    expect(() => assertCanCancelRequest(knownPending, 'u1')).not.toThrow();
    expectCode(() => assertCanCancelRequest(knownPending, 'u2'), ErrorCode.FORBIDDEN);
  });

  it('cannot cancel an already-applied request', () => {
    expectCode(
      () =>
        assertCanCancelRequest(
          { ...knownPending, status: LedgerRequestStatus.APPLIED },
          'u1',
        ),
      ErrorCode.INVALID_STATE,
    );
  });

  it('first-contact initiator verification is proposer-only', () => {
    const awaitingVerify = {
      status: LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
      requiresInitiatorVerify: true,
      proposerUserId: 'u1',
      counterpartyUserId: 'u2',
    } as const;

    expect(() => assertCanVerifyFirstContact(awaitingVerify, 'u1')).not.toThrow();
    expectCode(
      () => assertCanVerifyFirstContact(awaitingVerify, 'u2'),
      ErrorCode.FORBIDDEN,
    );
  });

  it('normal response helper refuses first-contact requests', () => {
    expectCode(
      () =>
        assertCanRespondToKnownCounterpartyRequest(
          {
            ...knownPending,
            requiresInitiatorVerify: true,
            counterpartyUserId: null,
          },
          'u2',
        ),
      ErrorCode.INVALID_STATE,
    );
  });
});
