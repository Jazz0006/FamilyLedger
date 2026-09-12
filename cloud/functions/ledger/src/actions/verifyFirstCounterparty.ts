import {
  CURRENCY,
  LEDGER_TIMEZONE,
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestStatus,
  LoanEventType,
  LoanStatus,
  type LedgerRequest,
  type Loan,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { assertCanVerifyFirstContact } from '../domain/permissions.js';
import { eventIdempotencyKey } from '../data/event-idempotency.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import { assertBoundFirstContactCreateLoanRequest } from './create-loan-common.js';

export interface VerifyFirstCounterpartyResult {
  request: LedgerRequest;
  loan: Loan;
}

function normalizeRequestId(input: unknown): string {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'verifyFirstCounterparty payload must be an object',
    );
  }
  const value = (input as Record<string, unknown>).requestId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'requestId must be a non-empty string');
  }
  return value.trim();
}

async function resolveAppliedRetry(
  ctx: ActionContext,
  requestId: string,
  actorUserId: string,
): Promise<VerifyFirstCounterpartyResult | null> {
  const request = await ctx.repo.getRequest(requestId);
  if (
    !request ||
    request.status !== LedgerRequestStatus.APPLIED ||
    request.proposerUserId !== actorUserId ||
    request.loanId == null
  ) {
    return null;
  }
  const loan = await ctx.repo.getLoan(request.loanId);
  return loan ? { request, loan } : null;
}

/**
 * Final first-contact verification. This is the first R5 operation that creates
 * formal ledger history, so Loan + both genesis events + request APPLIED are one
 * atomic transaction.
 */
export async function verifyFirstCounterparty(
  ctx: ActionContext,
  input: unknown,
): Promise<VerifyFirstCounterpartyResult> {
  const requestId = normalizeRequestId(input);
  const actor = await requireCurrentUser(ctx);

  try {
    return await ctx.repo.runTransaction(async (tx) => {
      const request = await tx.getRequest(requestId);
      if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');

      if (request.status === LedgerRequestStatus.APPLIED) {
        if (request.proposerUserId !== actor._id) {
          throw new AppError(ErrorCode.FORBIDDEN, 'Only the proposer may verify this request');
        }
        if (request.loanId == null) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN has no Loan id');
        }
        const existingLoan = await tx.getLoan(request.loanId);
        if (!existingLoan) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN Loan is missing');
        }
        return { request, loan: existingLoan };
      }

      assertCanVerifyFirstContact(request, actor._id);
      assertBoundFirstContactCreateLoanRequest(request);

      const payload = request.payload;
      const loan = await tx.createLoan({
        lenderUserId: payload.lenderUserId,
        borrowerUserId: payload.borrowerUserId,
        currency: CURRENCY,
        ledgerTimezone: LEDGER_TIMEZONE,
        createdFromRequestId: request._id,
        status: LoanStatus.ACTIVE,
        createdAt: ctx.now,
        closedAt: null,
      });

      const [principalSequence, rateSequence] = await tx.allocateEventSequences(
        loan._id,
        2,
      );
      if (principalSequence == null || rateSequence == null) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to allocate genesis event sequences');
      }

      await tx.appendEventIdempotent({
        loanId: loan._id,
        eventType: LoanEventType.PRINCIPAL_ADD,
        amountFen: payload.initialPrincipalFen,
        effectiveDate: payload.proposedEffectiveDate,
        sourceRequestId: request._id,
        createdBy: request.proposerUserId,
        confirmedBy: request.counterpartyUserId,
        sequence: principalSequence,
        idempotencyKey: eventIdempotencyKey(request._id, 'initial-principal'),
        createdAt: ctx.now,
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
        confirmedBy: request.counterpartyUserId,
        sequence: rateSequence,
        idempotencyKey: eventIdempotencyKey(request._id, 'initial-rate'),
        createdAt: ctx.now,
        schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
      });

      const applied: LedgerRequest = {
        ...request,
        loanId: loan._id,
        status: LedgerRequestStatus.APPLIED,
        updatedAt: ctx.now,
        resolvedAt: ctx.now,
      };
      await tx.putRequest(applied);

      return { request: applied, loan };
    });
  } catch (error) {
    // If a concurrent verification won a DB uniqueness race, resolve to the
    // committed APPLIED state instead of surfacing a false failure.
    const committed = await resolveAppliedRetry(ctx, requestId, actor._id);
    if (committed) return committed;
    throw error;
  }
}
