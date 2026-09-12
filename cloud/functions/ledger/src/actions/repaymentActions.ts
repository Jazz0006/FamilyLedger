import {
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestStatus,
  LedgerRequestType,
  LoanEventType,
  LoanStatus,
  type LedgerRequest,
  type LoanEvent,
  type PrincipalRepayPayload,
} from '@family-ledger/shared';
import { computeBalance, toInterestInput } from '@family-ledger/calc';
import { computeRequestFingerprint } from '../domain/request-fingerprint.js';
import {
  assertCanCancelRequest,
  assertCanRespondToKnownCounterpartyRequest,
  assertLoanParticipant,
  getLoanCounterpartyUserId,
} from '../domain/permissions.js';
import { assertLedgerRequestTransition } from '../domain/request-state.js';
import { AppError, ErrorCode } from '../errors.js';
import { eventIdempotencyKey } from '../data/event-idempotency.js';
import type { LedgerTransaction, NewLedgerRequest } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import { assertIsoDate } from './create-loan-common.js';

const MAX_NOTE_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const TX_EVENT_PAGE_SIZE = 100;

interface RepaymentRequestInput {
  loanId: string;
  amountFen: number;
  proposedEffectiveDate: string;
  note: string | null;
  idempotencyKey: string;
}

interface RequestIdInput {
  requestId: string;
}

export interface AppliedRepaymentResult {
  request: LedgerRequest;
  event: LoanEvent;
}

function validation(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    validation(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeRequestIdInput(input: unknown): RequestIdInput {
  const raw = requireObject(input, 'request payload');
  if (typeof raw.requestId !== 'string' || raw.requestId.trim().length === 0) {
    validation('requestId must be a non-empty string');
  }
  return { requestId: raw.requestId.trim() };
}

function normalizeRepaymentRequestInput(input: unknown): RepaymentRequestInput {
  const raw = requireObject(input, 'createRepaymentRequest payload');
  if (typeof raw.loanId !== 'string' || raw.loanId.trim().length === 0) {
    validation('loanId must be a non-empty string');
  }
  if (!Number.isSafeInteger(raw.amountFen) || Number(raw.amountFen) <= 0) {
    validation('amountFen must be a positive safe integer Fen value');
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== 'string') validation('note must be a string or null');
    const trimmed = raw.note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) {
      validation(`note must be at most ${MAX_NOTE_LENGTH} characters`);
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  if (typeof raw.idempotencyKey !== 'string') {
    validation('idempotencyKey must be a string');
  }
  const idempotencyKey = raw.idempotencyKey.trim();
  if (
    idempotencyKey.length === 0 ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    validation(
      `idempotencyKey must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }

  return {
    loanId: raw.loanId.trim(),
    amountFen: raw.amountFen as number,
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note,
    idempotencyKey,
  };
}

function assertRepaymentRequest(
  request: LedgerRequest,
): asserts request is LedgerRequest & { payload: PrincipalRepayPayload; loanId: string } {
  if (request.type !== LedgerRequestType.PRINCIPAL_REPAY) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'This R7 action only supports PRINCIPAL_REPAY requests',
    );
  }
  if (request.requiresInitiatorVerify) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Repayment request must use the known-counterparty workflow',
    );
  }
  if (request.loanId == null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Repayment request has no Loan');
  }
  const payload = request.payload as PrincipalRepayPayload;
  if (!Number.isSafeInteger(payload.amountFen) || payload.amountFen <= 0) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Repayment request has invalid amountFen');
  }
  assertIsoDate(payload.proposedEffectiveDate);
}

async function readAllTransactionEvents(
  tx: LedgerTransaction,
  loanId: string,
): Promise<LoanEvent[]> {
  const events: LoanEvent[] = [];
  let cursor: string | null = null;
  do {
    const page = await tx.listLoanEvents({
      loanId,
      page: { limit: TX_EVENT_PAGE_SIZE, cursor },
    });
    events.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor != null);
  return events;
}

function findAppliedRepaymentEvent(
  events: LoanEvent[],
  requestId: string,
): LoanEvent | null {
  const key = eventIdempotencyKey(requestId, 'principal-repay');
  return events.find((event) => event.idempotencyKey === key) ?? null;
}

/** Any participant may propose that principal has been repaid; the other side confirms. */
export async function createRepaymentRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const actor = await requireCurrentUser(ctx);
  const normalized = normalizeRepaymentRequestInput(input);
  const loan = await ctx.repo.getLoan(normalized.loanId);
  if (!loan) throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
  assertLoanParticipant(loan, actor._id);
  if (loan.status !== LoanStatus.ACTIVE) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan is not active');
  }

  const counterpartyUserId = getLoanCounterpartyUserId(loan, actor._id);
  const payload: PrincipalRepayPayload = {
    amountFen: normalized.amountFen,
    proposedEffectiveDate: normalized.proposedEffectiveDate,
    note: normalized.note,
  };
  const requestFingerprint = computeRequestFingerprint({
    type: LedgerRequestType.PRINCIPAL_REPAY,
    loanId: loan._id,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    requiresInitiatorVerify: false,
  });

  const request: NewLedgerRequest = {
    type: LedgerRequestType.PRINCIPAL_REPAY,
    loanId: loan._id,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: false,
    idempotencyKey: normalized.idempotencyKey,
    requestFingerprint,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    expiresAt: null,
  };
  return (await ctx.repo.createRequestIdempotent(request)).item;
}

/**
 * Confirm a repayment inside one transaction snapshot. The current principal is
 * rebuilt from the formal event stream before append, so stale/concurrent
 * proposals cannot drive principal below zero.
 */
export async function acceptRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<AppliedRepaymentResult> {
  const actor = await requireCurrentUser(ctx);
  const { requestId } = normalizeRequestIdInput(input);

  return ctx.repo.runTransaction(async (tx) => {
    const request = await tx.getRequest(requestId);
    if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    assertRepaymentRequest(request);

    if (request.status === LedgerRequestStatus.APPLIED) {
      if (actor._id !== request.counterpartyUserId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Only the counterparty may accept this request');
      }
      const events = await readAllTransactionEvents(tx, request.loanId);
      const event = findAppliedRepaymentEvent(events, request._id);
      if (!event) {
        throw new AppError(
          ErrorCode.INVALID_STATE,
          'Applied repayment request is missing its formal event',
        );
      }
      return { request, event };
    }

    assertCanRespondToKnownCounterpartyRequest(request, actor._id);
    const loan = await tx.getLoan(request.loanId);
    if (!loan) throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
    if (loan.status !== LoanStatus.ACTIVE) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Loan is not active');
    }
    assertLoanParticipant(loan, request.proposerUserId);
    assertLoanParticipant(loan, request.counterpartyUserId!);
    if (
      getLoanCounterpartyUserId(loan, request.proposerUserId) !==
      request.counterpartyUserId
    ) {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        'Request parties no longer match the Loan participants',
      );
    }

    const events = await readAllTransactionEvents(tx, loan._id);
    const principalFen = computeBalance(
      toInterestInput(events, request.payload.proposedEffectiveDate),
    ).principalFen;
    if (request.payload.amountFen > principalFen) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Repayment ${request.payload.amountFen} exceeds current principal ${principalFen}`,
      );
    }

    const [sequence] = await tx.allocateEventSequences(loan._id, 1);
    if (sequence == null) throw new AppError(ErrorCode.INTERNAL, 'No event sequence allocated');
    const event = (
      await tx.appendEventIdempotent({
        loanId: loan._id,
        eventType: LoanEventType.PRINCIPAL_REPAY,
        amountFen: request.payload.amountFen,
        effectiveDate: request.payload.proposedEffectiveDate,
        sourceRequestId: request._id,
        createdBy: request.proposerUserId,
        confirmedBy: actor._id,
        sequence,
        idempotencyKey: eventIdempotencyKey(request._id, 'principal-repay'),
        createdAt: ctx.now,
        schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
      })
    ).item;

    assertLedgerRequestTransition(request, LedgerRequestStatus.APPLIED);
    const applied: LedgerRequest = {
      ...request,
      status: LedgerRequestStatus.APPLIED,
      updatedAt: ctx.now,
      resolvedAt: ctx.now,
    };
    await tx.putRequest(applied);
    return { request: applied, event };
  });
}

export async function rejectRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const actor = await requireCurrentUser(ctx);
  const { requestId } = normalizeRequestIdInput(input);
  return ctx.repo.runTransaction(async (tx) => {
    const request = await tx.getRequest(requestId);
    if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    assertRepaymentRequest(request);
    if (request.status === LedgerRequestStatus.REJECTED) {
      if (actor._id !== request.counterpartyUserId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Only the counterparty may reject this request');
      }
      return request;
    }
    assertCanRespondToKnownCounterpartyRequest(request, actor._id);
    assertLedgerRequestTransition(request, LedgerRequestStatus.REJECTED);
    const rejected: LedgerRequest = {
      ...request,
      status: LedgerRequestStatus.REJECTED,
      updatedAt: ctx.now,
      resolvedAt: ctx.now,
    };
    await tx.putRequest(rejected);
    return rejected;
  });
}

export async function cancelRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const actor = await requireCurrentUser(ctx);
  const { requestId } = normalizeRequestIdInput(input);
  return ctx.repo.runTransaction(async (tx) => {
    const request = await tx.getRequest(requestId);
    if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    assertRepaymentRequest(request);
    if (request.status === LedgerRequestStatus.CANCELLED) {
      if (actor._id !== request.proposerUserId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Only the proposer may cancel this request');
      }
      return request;
    }
    assertCanCancelRequest(request, actor._id);
    const cancelled: LedgerRequest = {
      ...request,
      status: LedgerRequestStatus.CANCELLED,
      updatedAt: ctx.now,
      resolvedAt: ctx.now,
    };
    await tx.putRequest(cancelled);
    return cancelled;
  });
}
