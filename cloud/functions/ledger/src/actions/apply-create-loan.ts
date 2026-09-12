import {
  CURRENCY,
  LEDGER_TIMEZONE,
  LOAN_EVENT_SCHEMA_VERSION,
  LoanEventType,
  LoanStatus,
  type CreateLoanPayload,
  type LedgerRequest,
  type Loan,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { eventIdempotencyKey } from '../data/event-idempotency.js';
import type { LedgerTransaction } from '../data/repo.js';

export type BoundCreateLoanRequest = LedgerRequest & {
  counterpartyUserId: string;
  payload: CreateLoanPayload & {
    borrowerUserId: string;
    lenderUserId: string;
  };
};

/**
 * Create one Loan plus its two explicit genesis events inside the caller's
 * transaction. Request state transition remains owned by the caller.
 */
export async function createLoanWithGenesis(params: {
  tx: LedgerTransaction;
  request: BoundCreateLoanRequest;
  confirmedByUserId: string;
  now: number;
}): Promise<Loan> {
  const { tx, request, confirmedByUserId, now } = params;
  const payload = request.payload;

  const loan = await tx.createLoan({
    lenderUserId: payload.lenderUserId,
    borrowerUserId: payload.borrowerUserId,
    currency: CURRENCY,
    ledgerTimezone: LEDGER_TIMEZONE,
    createdFromRequestId: request._id,
    status: LoanStatus.ACTIVE,
    createdAt: now,
    closedAt: null,
  });

  const [principalSequence, rateSequence] = await tx.allocateEventSequences(
    loan._id,
    2,
  );
  if (principalSequence == null || rateSequence == null) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'Failed to allocate genesis event sequences',
    );
  }

  await tx.appendEventIdempotent({
    loanId: loan._id,
    eventType: LoanEventType.PRINCIPAL_ADD,
    amountFen: payload.initialPrincipalFen,
    effectiveDate: payload.proposedEffectiveDate,
    sourceRequestId: request._id,
    createdBy: request.proposerUserId,
    confirmedBy: confirmedByUserId,
    sequence: principalSequence,
    idempotencyKey: eventIdempotencyKey(request._id, 'initial-principal'),
    createdAt: now,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  });

  await tx.appendEventIdempotent({
    loanId: loan._id,
    eventType: LoanEventType.RATE_CHANGE,
    amountFen: null,
    rate: payload.rate,
    effectiveDate: payload.proposedEffectiveDate,
    sourceRequestId: request._id,
    createdBy: request.proposerUserId,
    confirmedBy: confirmedByUserId,
    sequence: rateSequence,
    idempotencyKey: eventIdempotencyKey(request._id, 'initial-rate'),
    createdAt: now,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  });

  return loan;
}
