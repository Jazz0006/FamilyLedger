import {
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestStatus,
  LedgerRequestType,
  LoanEventType,
  LoanStatus,
  type CloseLoanPayload,
  type CorrectionPayload,
  type CreateLoanPayload,
  type LedgerRequest,
  type Loan,
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
import { assertPrincipalTimelineNonNegative } from '../domain/principal-timeline.js';
import { assertCreateLoanRequestStructure } from '../domain/validation.js';
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
import {
  buildCorrectionFormalEvent,
  correctionPayloadForStoredRequest,
} from './correctionActions.js';
import {
  buildCloseFormalEvent,
  closePayloadForStoredRequest,
} from './closeLoanActions.js';
import {
  createLoanWithGenesis,
  type BoundCreateLoanRequest,
} from './apply-create-loan.js';

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

export interface AppliedCreateLoanResult {
  request: LedgerRequest;
  loan: Loan;
}

export type AppliedRequestResult = AppliedLoanChangeResult | AppliedCreateLoanResult;

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

function isSupportedKnownRequestType(type: string): boolean {
  return (
    type === LedgerRequestType.CREATE_LOAN ||
    type === LedgerRequestType.PRINCIPAL_REPAY ||
    type === LedgerRequestType.PRINCIPAL_ADD ||
    type === LedgerRequestType.RATE_CHANGE ||
    type === LedgerRequestType.CORRECTION ||
    type === LedgerRequestType.CLOSE_LOAN
  );
}

function assertKnownCreateLoanShape(request: LedgerRequest): asserts request is
  LedgerRequest & {
    counterpartyUserId: string;
    payload: CreateLoanPayload & {
      borrowerUserId: string;
      lenderUserId: string;
      unknownPartyRole: null;
    };
  } {
  if (request.type !== LedgerRequestType.CREATE_LOAN) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request is not CREATE_LOAN');
  }
  if (request.requiresInitiatorVerify) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'First-contact CREATE_LOAN must use initiator verification',
    );
  }
  if (request.status === LedgerRequestStatus.PENDING && request.loanId !== null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Pending CREATE_LOAN already has a Loan');
  }
  if (request.status === LedgerRequestStatus.APPLIED && request.loanId == null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN has no Loan');
  }
  assertCreateLoanRequestStructure({ ...request, loanId: null });
  const payload = request.payload as CreateLoanPayload;
  if (
    request.counterpartyUserId == null ||
    payload.borrowerUserId == null ||
    payload.lenderUserId == null ||
    payload.unknownPartyRole !== null
  ) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Known CREATE_LOAN parties are incomplete');
  }
  normalizeRateSnapshot(payload.rate);
  assertIsoDate(payload.proposedEffectiveDate);
}

function assertSupportedKnownRequest(request: LedgerRequest): void {
  if (!isSupportedKnownRequestType(request.type)) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Request type is not implemented by the known-counterparty workflow',
    );
  }
  if (request.requiresInitiatorVerify) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'First-contact requests use invite acceptance and initiator verification',
    );
  }

  if (request.type === LedgerRequestType.CREATE_LOAN) {
    assertKnownCreateLoanShape(request);
    return;
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
    case LedgerRequestType.CORRECTION:
      correctionPayloadForStoredRequest(request);
      return;
    case LedgerRequestType.CLOSE_LOAN:
      closePayloadForStoredRequest(request);
      return;
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
    case LedgerRequestType.CORRECTION:
      return 'correction';
    case LedgerRequestType.CLOSE_LOAN:
      return 'loan-close';
    default:
      throw new AppError(ErrorCode.INVALID_STATE, 'Request has no single formal event');
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
  loan: Loan;
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
      const candidate: NewLoanEvent = {
        ...base,
        eventType: LoanEventType.PRINCIPAL_REPAY,
        amountFen: payload.amountFen,
        effectiveDate: payload.proposedEffectiveDate,
        idempotencyKey: eventIdempotencyKey(
          params.request._id,
          'principal-repay',
        ),
      };
      assertPrincipalTimelineNonNegative(params.currentEvents, candidate);
      return candidate;
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
    case LedgerRequestType.CORRECTION:
      return buildCorrectionFormalEvent({
        request: params.request as LedgerRequest & {
          loanId: string;
          payload: CorrectionPayload;
        },
        actorUserId: params.actorUserId,
        sequence: params.sequence,
        now: params.now,
        currentEvents: params.currentEvents,
      });
    case LedgerRequestType.CLOSE_LOAN:
      return buildCloseFormalEvent({
        request: params.request as LedgerRequest & {
          loanId: string;
          payload: CloseLoanPayload;
        },
        loan: params.loan,
        actorUserId: params.actorUserId,
        sequence: params.sequence,
        now: params.now,
        currentEvents: params.currentEvents,
      });
    default:
      throw new AppError(ErrorCode.INVALID_STATE, 'Unsupported Loan change request type');
  }
}

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

export async function acceptRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<AppliedRequestResult> {
  const actor = await requireCurrentUser(ctx);
  const { requestId } = normalizeRequestIdInput(input);

  return ctx.repo.runTransaction(async (tx) => {
    const request = await tx.getRequest(requestId);
    if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    assertSupportedKnownRequest(request);

    if (request.status === LedgerRequestStatus.APPLIED) {
      if (actor._id !== request.counterpartyUserId) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Only the counterparty may accept this request');
      }
      if (request.type === LedgerRequestType.CREATE_LOAN) {
        if (request.loanId == null) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN has no Loan');
        }
        const loan = await tx.getLoan(request.loanId);
        if (!loan) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN Loan is missing');
        }
        return { request, loan };
      }
      if (request.loanId == null) {
        throw new AppError(ErrorCode.INVALID_STATE, 'Applied Loan change has no Loan');
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

    if (request.type === LedgerRequestType.CREATE_LOAN) {
      assertKnownCreateLoanShape(request);
      const loan = await createLoanWithGenesis({
        tx,
        request: request as BoundCreateLoanRequest,
        confirmedByUserId: actor._id,
        now: ctx.now,
      });
      assertLedgerRequestTransition(request, LedgerRequestStatus.APPLIED);
      const applied: LedgerRequest = {
        ...request,
        loanId: loan._id,
        status: LedgerRequestStatus.APPLIED,
        updatedAt: ctx.now,
        resolvedAt: ctx.now,
      };
      await tx.putRequest(applied);
      return { request: applied, loan };
    }

    if (request.loanId == null) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Loan change request has no Loan');
    }
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

    const needsFullHistory =
      request.type === LedgerRequestType.PRINCIPAL_REPAY ||
      request.type === LedgerRequestType.CORRECTION ||
      request.type === LedgerRequestType.CLOSE_LOAN;
    const currentEvents = needsFullHistory
      ? await readAllTransactionEvents(tx, loan._id)
      : [];
    const [sequence] = await tx.allocateEventSequences(loan._id, 1);
    if (sequence == null) {
      throw new AppError(ErrorCode.INTERNAL, 'No event sequence allocated');
    }
    const event = (
      await tx.appendEventIdempotent(
        buildFormalEvent({
          request: request as LedgerRequest & { loanId: string },
          loan,
          actorUserId: actor._id,
          sequence,
          now: ctx.now,
          currentEvents,
        }),
      )
    ).item;

    if (request.type === LedgerRequestType.CLOSE_LOAN) {
      await tx.putLoan({
        ...loan,
        status: LoanStatus.CLOSED,
        closedAt: ctx.now,
      });
    }

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
    assertSupportedKnownRequest(request);
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
    assertSupportedKnownRequest(request);
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
