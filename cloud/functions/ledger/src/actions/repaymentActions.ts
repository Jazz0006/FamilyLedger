import {
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestStatus,
  LedgerRequestType,
  LoanEventType,
  LoanStatus,
  type LedgerRequest,
  type LoanEvent,
  type PrincipalAddPayload,
  type PrincipalRepayPayload,
  type RateChangePayload,
} from '@family-ledger/shared';
import { computeBalance, toInterestInput } from '@family-ledger/calc';
import {
  assertCanCancelRequest,
  assertCanRespondToKnownCounterpartyRequest,
  assertLoanParticipant,
  getLoanCounterpartyUserId,
} from '../domain/permissions.js';
import { assertLedgerRequestTransition } from '../domain/request-state.js';
import { AppError, ErrorCode } from '../errors.js';
import {
  eventIdempotencyKey,
  type EventPurpose,
} from '../data/event-idempotency.js';
import type {
  LedgerTransaction,
  NewLoanEvent,
} from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import {
  createKnownLoanChangeRequest,
  normalizeIdempotencyKey,
  normalizeLoanId,
  normalizeNote,
  normalizePositiveFen,
  requireObject,
} from './known-change-common.js';
import {
  assertIsoDate,
  normalizeRateSnapshot,
} from './create-loan-common.js';

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

export interface AppliedLoanChangeResult {
  request: LedgerRequest;
  event: LoanEvent;
}

function validation(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message);
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
  return {
    loanId: normalizeLoanId(raw.loanId),
    amountFen: normalizePositiveFen(raw.amountFen),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  };
}

function isSupportedKnownChangeType(type: string): boolean {
  return (
    type === LedgerRequestType.PRINCIPAL_REPAY ||
    type === LedgerRequestType.PRINCIPAL_ADD ||
    type === LedgerRequestType.RATE_CHANGE
  );
}

function assertSupportedKnownChangeRequest(
  request: LedgerRequest,
): asserts request is LedgerRequest & { loanId: string } {
  if (!isSupportedKnownChangeType(request.type)) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Request type is not implemented by the known-counterparty change workflow',
    );
  }
  if (request.requiresInitiatorVerify) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Known Loan changes must not use initiator verification',
    );
  }
  if (request.loanId == null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan change request has no Loan');
  }

  switch (request.type) {
    case LedgerRequestType.PRINCIPAL_REPAY:
    case LedgerRequestType.PRINCIPAL_ADD: {
      const payload = request.payload as PrincipalRepayPayload | PrincipalAddPayload;
      if (!Number.isSafeInteger(payload.amountFen) || payload.amountFen <= 0) {
        throw new AppError(ErrorCode.INVALID_STATE, 'Loan change has invalid amountFen');
      }
      assertIsoDate(payload.proposedEffectiveDate);
      return;
    }
    case LedgerRequestType.RATE_CHANGE: {
      const payload = request.payload as RateChangePayload;
      normalizeRateSnapshot(payload.rate);
      assertIsoDate(payload.proposedEffectiveDate);
      return;
    }
  }
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

function purposeForRequest(request: LedgerRequest): EventPurpose {
  switch (request.type) {
    case LedgerRequestType.PRINCIPAL_REPAY:
      return 'principal-repay';
    case LedgerRequestType.PRINCIPAL_ADD:
      return 'principal-add';
    case LedgerRequestType.RATE_CHANGE:
      return 'rate-change';
    default:
      throw new AppError(ErrorCode.INVALID_STATE, 'Unsupported Loan change request type');
  }
}

function findAppliedEvent(
  events: LoanEvent[],
  request: LedgerRequest,
): LoanEvent | null {
  const key = eventIdempotencyKey(request._id, purposeForRequest(request));
  return events.find((event) => event.idempotencyKey === key) ?? null;
}

function buildFormalEvent(params: {
  request: LedgerRequest & { loanId: string };
  actorUserId: string;
  sequence: number;
  now: number;
  currentEvents: LoanEvent[];
}): NewLoanEvent {
  const base = {
    loanId: params.request.loanId,
    sourceRequestId: params.request._id,
    createdBy: params.request.proposerUserId,
    confirmedBy: params.actorUserId,
    sequence: params.sequence,
    createdAt: params.now,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  } as const;

  switch (params.request.type) {
    case LedgerRequestType.PRINCIPAL_REPAY: {
      const payload = params.request.payload as PrincipalRepayPayload;
      const principalFen = computeBalance(
        toInterestInput(params.currentEvents, payload.proposedEffectiveDate),
      ).principalFen;
      if (payload.amountFen > principalFen) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Repayment ${payload.amountFen} exceeds current principal ${principalFen}`,
        );
      }
      return {
        ...base,
        eventType: LoanEventType.PRINCIPAL_REPAY,
        amountFen: payload.amountFen,
        effectiveDate: payload.proposedEffectiveDate,
        idempotencyKey: eventIdempotencyKey(
          params.request._id,
          'principal-repay',
        ),
      };
    }
    case LedgerRequestType.PRINCIPAL_ADD: {
      const payload = params.request.payload as PrincipalAddPayload;
      return {
        ...base,
        eventType: LoanEventType.PRINCIPAL_ADD,
        amountFen: payload.amountFen,
        effectiveDate: payload.proposedEffectiveDate,
        idempotencyKey: eventIdempotencyKey(
          params.request._id,
          'principal-add',
        ),
      };
    }
    case LedgerRequestType.RATE_CHANGE: {
      const payload = params.request.payload as RateChangePayload;
      return {
        ...base,
        eventType: LoanEventType.RATE_CHANGE,
        amountFen: null,
        rate: normalizeRateSnapshot(payload.rate),
        effectiveDate: payload.proposedEffectiveDate,
        idempotencyKey: eventIdempotencyKey(
          params.request._id,
          'rate-change',
        ),
      };
    }
    default:
      throw new AppError(ErrorCode.INVALID_STATE, 'Unsupported Loan change request type');
  }
}

/** Any participant may propose that principal has been repaid; the other side confirms. */
export async function createRepaymentRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const normalized = normalizeRepaymentRequestInput(input);
  const payload: PrincipalRepayPayload = {
    amountFen: normalized.amountFen,
    proposedEffectiveDate: normalized.proposedEffectiveDate,
    note: normalized.note,
  };
  return createKnownLoanChangeRequest(ctx, {
    loanId: normalized.loanId,
    type: LedgerRequestType.PRINCIPAL_REPAY,
    payload,
    idempotencyKey: normalized.idempotencyKey,
  });
}

/**
 * Confirm an implemented known-counterparty Loan change in one transaction.
 * Repayment additionally rebuilds principal from the same transaction snapshot.
 */
export async function acceptRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<AppliedLoanChangeResult> {
  const actor = await requireCurrentUser(ctx);
  const { requestId } = normalizeRequestIdInput(input);

  return ctx.repo.runTransaction(async (tx) => {
    const request = await tx.getRequest(requestId);
    if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    assertSupportedKnownChangeRequest(request);

    if (request.status === LedgerRequestStatus.APPLIED) {
      if (actor._id !== request.counterpartyUserId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Only the counterparty may accept this request');
      }
      const event = findAppliedEvent(
        await readAllTransactionEvents(tx, request.loanId),
        request,
      );
      if (!event) {
        throw new AppError(
          ErrorCode.INVALID_STATE,
          'Applied Loan change request is missing its formal event',
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

    const currentEvents =
      request.type === LedgerRequestType.PRINCIPAL_REPAY
        ? await readAllTransactionEvents(tx, loan._id)
        : [];
    const [sequence] = await tx.allocateEventSequences(loan._id, 1);
    if (sequence == null) {
      throw new AppError(ErrorCode.INTERNAL, 'No event sequence allocated');
    }
    const event = (
      await tx.appendEventIdempotent(
        buildFormalEvent({
          request,
          actorUserId: actor._id,
          sequence,
          now: ctx.now,
          currentEvents,
        }),
      )
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
    assertSupportedKnownChangeRequest(request);
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
    assertSupportedKnownChangeRequest(request);
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
