import {
  LEDGER_TIMEZONE,
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestType,
  LoanEventType,
  type CloseLoanPayload,
  type LedgerRequest,
  type Loan,
  type LoanEvent,
} from '@family-ledger/shared';
import { computeBalance, isoDateInTimezone, toInterestInput } from '@family-ledger/calc';
import { eventIdempotencyKey } from '../data/event-idempotency.js';
import type { NewLoanEvent } from '../data/repo.js';
import { AppError, ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { assertIsoDate } from './create-loan-common.js';
import {
  createKnownLoanChangeRequest,
  normalizeIdempotencyKey,
  normalizeLoanId,
  normalizeNote,
  requireObject,
  validation,
} from './known-change-common.js';

function normalizeClosePayload(input: unknown): CloseLoanPayload {
  const raw = requireObject(input, 'close loan payload');
  return {
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
  };
}

export function closePayloadForStoredRequest(
  request: LedgerRequest,
): CloseLoanPayload {
  if (request.type !== LedgerRequestType.CLOSE_LOAN) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request is not CLOSE_LOAN');
  }
  const payload = normalizeClosePayload(request.payload);
  return payload;
}

export async function createCloseLoanRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createCloseLoanRequest payload');
  const payload = normalizeClosePayload(raw);
  const today = isoDateInTimezone(ctx.now, LEDGER_TIMEZONE);
  if (payload.proposedEffectiveDate > today) {
    validation('Close effective date cannot be in the future');
  }
  return createKnownLoanChangeRequest(ctx, {
    loanId: normalizeLoanId(raw.loanId),
    type: LedgerRequestType.CLOSE_LOAN,
    payload,
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  });
}

function latestFormalEffectiveDate(events: LoanEvent[]): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (latest == null || event.effectiveDate > latest) latest = event.effectiveDate;
  }
  return latest;
}

export function buildCloseFormalEvent(params: {
  request: LedgerRequest & { loanId: string; payload: CloseLoanPayload };
  loan: Loan;
  actorUserId: string;
  sequence: number;
  now: number;
  currentEvents: LoanEvent[];
}): NewLoanEvent {
  const closeDate = params.request.payload.proposedEffectiveDate;
  const today = isoDateInTimezone(params.now, params.loan.ledgerTimezone);
  if (closeDate > today) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Close effective date cannot be in the future',
    );
  }

  const latestDate = latestFormalEffectiveDate(params.currentEvents);
  if (latestDate != null && closeDate < latestDate) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `Close effective date cannot precede existing formal event date ${latestDate}`,
    );
  }
  if (
    params.currentEvents.some((event) => event.eventType === LoanEventType.LOAN_CLOSED)
  ) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'ACTIVE Loan unexpectedly already contains a close event',
    );
  }

  const balance = computeBalance(toInterestInput(params.currentEvents, closeDate));
  if (balance.principalFen !== 0) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `Loan principal must be zero before close; current principal is ${balance.principalFen}`,
    );
  }
  if (balance.interestFen < 0) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `Loan has negative residual interest ${balance.interestFen}; correct history before close`,
    );
  }

  return {
    loanId: params.loan._id,
    eventType: LoanEventType.LOAN_CLOSED,
    amountFen: null,
    closeSettlement: {
      accruedInterestFen: balance.interestFen,
    },
    effectiveDate: closeDate,
    sourceRequestId: params.request._id,
    createdBy: params.request.proposerUserId,
    confirmedBy: params.actorUserId,
    sequence: params.sequence,
    idempotencyKey: eventIdempotencyKey(params.request._id, 'loan-close'),
    createdAt: params.now,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  };
}
