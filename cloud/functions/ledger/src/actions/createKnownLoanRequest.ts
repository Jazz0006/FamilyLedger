import {
  LedgerRequestStatus,
  LedgerRequestType,
  type CreateLoanPayload,
  type LedgerRequest,
  type Loan,
} from '@family-ledger/shared';
import { computeRequestFingerprint } from '../domain/request-fingerprint.js';
import {
  assertCanRespondToKnownCounterpartyRequest,
} from '../domain/permissions.js';
import { assertLedgerRequestTransition } from '../domain/request-state.js';
import { assertCreateLoanRequestStructure } from '../domain/validation.js';
import { AppError, ErrorCode } from '../errors.js';
import type { NewLedgerRequest } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import {
  createLoanWithGenesis,
  type BoundCreateLoanRequest,
} from './apply-create-loan.js';
import {
  normalizeIdempotencyKey,
  normalizeNote,
  normalizePositiveFen,
  requireObject,
  validation,
} from './known-change-common.js';
import { assertIsoDate, normalizeRateSnapshot } from './create-loan-common.js';
import { assertKnownCounterparty } from './knownCounterparties.js';

function normalizeCounterpartyUserId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    validation('counterpartyUserId must be a non-empty string');
  }
  return value.trim();
}

function normalizeRequestId(input: unknown): string {
  const raw = requireObject(input, 'acceptKnownLoanRequest payload');
  if (typeof raw.requestId !== 'string' || raw.requestId.trim().length === 0) {
    validation('requestId must be a non-empty string');
  }
  return raw.requestId.trim();
}

export function assertKnownCreateLoanRequest(
  request: LedgerRequest,
): asserts request is BoundCreateLoanRequest {
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

  // Structure validation expects the pre-application CREATE_LOAN shape; loanId is
  // therefore normalized only for validation of the immutable proposal fields.
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

export async function createKnownLoanRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createKnownLoanRequest payload');
  if (raw.counterpartyRole !== 'BORROWER' && raw.counterpartyRole !== 'LENDER') {
    validation('counterpartyRole must be BORROWER or LENDER');
  }

  const actor = await requireCurrentUser(ctx);
  const counterpartyUserId = normalizeCounterpartyUserId(raw.counterpartyUserId);
  await assertKnownCounterparty(ctx.repo, actor._id, counterpartyUserId);

  const payload: CreateLoanPayload = {
    borrowerUserId:
      raw.counterpartyRole === 'BORROWER' ? counterpartyUserId : actor._id,
    lenderUserId:
      raw.counterpartyRole === 'LENDER' ? counterpartyUserId : actor._id,
    unknownPartyRole: null,
    initialPrincipalFen: normalizePositiveFen(
      raw.initialPrincipalFen,
      'initialPrincipalFen',
    ),
    rate: normalizeRateSnapshot(raw.rate),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
  };
  const idempotencyKey = normalizeIdempotencyKey(raw.idempotencyKey);
  const requestFingerprint = computeRequestFingerprint({
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    requiresInitiatorVerify: false,
  });

  const request: NewLedgerRequest = {
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: false,
    idempotencyKey,
    requestFingerprint,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    expiresAt: null,
  };
  return (await ctx.repo.createRequestIdempotent(request)).item;
}

export interface AcceptKnownLoanResult {
  request: LedgerRequest;
  loan: Loan;
}

async function resolveAppliedRetry(
  ctx: ActionContext,
  requestId: string,
  actorUserId: string,
): Promise<AcceptKnownLoanResult | null> {
  const request = await ctx.repo.getRequest(requestId);
  if (
    !request ||
    request.type !== LedgerRequestType.CREATE_LOAN ||
    request.requiresInitiatorVerify ||
    request.status !== LedgerRequestStatus.APPLIED ||
    request.counterpartyUserId !== actorUserId ||
    request.loanId == null
  ) {
    return null;
  }
  const loan = await ctx.repo.getLoan(request.loanId);
  return loan ? { request, loan } : null;
}

export async function acceptKnownLoanRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<AcceptKnownLoanResult> {
  const requestId = normalizeRequestId(input);
  const actor = await requireCurrentUser(ctx);

  try {
    return await ctx.repo.runTransaction(async (tx) => {
      const request = await tx.getRequest(requestId);
      if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
      assertKnownCreateLoanRequest(request);

      if (request.status === LedgerRequestStatus.APPLIED) {
        if (request.counterpartyUserId !== actor._id) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            'Only the counterparty may accept this request',
          );
        }
        if (request.loanId == null) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN has no Loan');
        }
        const loan = await tx.getLoan(request.loanId);
        if (!loan) {
          throw new AppError(ErrorCode.INVALID_STATE, 'Applied CREATE_LOAN Loan is missing');
        }
        return { request, loan };
      }

      assertCanRespondToKnownCounterpartyRequest(request, actor._id);
      const loan = await createLoanWithGenesis({
        tx,
        request,
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
    });
  } catch (error) {
    const committed = await resolveAppliedRetry(ctx, requestId, actor._id);
    if (committed) return committed;
    throw error;
  }
}
