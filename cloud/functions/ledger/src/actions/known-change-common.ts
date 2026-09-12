import {
  LedgerRequestStatus,
  LoanStatus,
  type LedgerRequest,
  type LedgerRequestPayload,
  type LedgerRequestType,
} from '@family-ledger/shared';
import { computeRequestFingerprint } from '../domain/request-fingerprint.js';
import {
  assertLoanParticipant,
  getLoanCounterpartyUserId,
} from '../domain/permissions.js';
import { AppError, ErrorCode } from '../errors.js';
import type { NewLedgerRequest } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';

export const MAX_NOTE_LENGTH = 500;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function validation(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message);
}

export function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    validation(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function normalizeLoanId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    validation('loanId must be a non-empty string');
  }
  return value.trim();
}

export function normalizePositiveFen(value: unknown, field = 'amountFen'): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    validation(`${field} must be a positive safe integer Fen value`);
  }
  return value as number;
}

export function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') validation('note must be a string or null');
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    validation(`note must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') validation('idempotencyKey must be a string');
  const key = value.trim();
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    validation(
      `idempotencyKey must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  return key;
}

export async function createKnownLoanChangeRequest(
  ctx: ActionContext,
  params: {
    loanId: string;
    type: LedgerRequestType;
    payload: LedgerRequestPayload;
    idempotencyKey: string;
  },
): Promise<LedgerRequest> {
  const actor = await requireCurrentUser(ctx);
  const loan = await ctx.repo.getLoan(params.loanId);
  if (!loan) throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
  assertLoanParticipant(loan, actor._id);
  if (loan.status !== LoanStatus.ACTIVE) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan is not active');
  }

  const counterpartyUserId = getLoanCounterpartyUserId(loan, actor._id);
  const requestFingerprint = computeRequestFingerprint({
    type: params.type,
    loanId: loan._id,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload: params.payload,
    requiresInitiatorVerify: false,
  });

  const request: NewLedgerRequest = {
    type: params.type,
    loanId: loan._id,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload: params.payload,
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: false,
    idempotencyKey: params.idempotencyKey,
    requestFingerprint,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    expiresAt: null,
  };
  return (await ctx.repo.createRequestIdempotent(request)).item;
}
