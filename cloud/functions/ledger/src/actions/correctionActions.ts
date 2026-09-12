import {
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestType,
  LoanEventType,
  type CorrectionPayload,
  type LedgerRequest,
  type LoanEvent,
  type PrincipalCorrectionPayload,
  type RateCorrectionPayload,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { eventIdempotencyKey } from '../data/event-idempotency.js';
import type { NewLoanEvent } from '../data/repo.js';
import {
  assertPrincipalTimelineNonNegative,
  principalDeltaForEvent,
} from '../domain/principal-timeline.js';
import type { ActionContext } from './action-context.js';
import {
  createKnownLoanChangeRequest,
  MAX_NOTE_LENGTH,
  normalizeIdempotencyKey,
  normalizeLoanId,
  requireObject,
  validation,
} from './known-change-common.js';
import { normalizeRateSnapshot } from './create-loan-common.js';

function normalizeTargetEventId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    validation('targetEventId must be a non-empty string');
  }
  return value.trim();
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') validation('reason must be a string or null');
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    validation(`reason must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSignedNonZeroFen(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) === 0) {
    validation('principalDeltaFen must be a non-zero safe integer Fen value');
  }
  return value as number;
}

function assertNoForbiddenCorrectionFields(
  raw: Record<string, unknown>,
  kind: 'PRINCIPAL' | 'RATE',
): void {
  if ('proposedEffectiveDate' in raw) {
    validation('Correction effectiveDate is derived from the target event');
  }
  if (kind === 'PRINCIPAL' && raw.replacementRate !== undefined) {
    validation('PRINCIPAL correction cannot include replacementRate');
  }
  if (kind === 'RATE' && raw.principalDeltaFen !== undefined) {
    validation('RATE correction cannot include principalDeltaFen');
  }
}

export function normalizeCorrectionPayload(input: unknown): CorrectionPayload {
  const raw = requireObject(input, 'correction payload');
  if (raw.correctionKind !== 'PRINCIPAL' && raw.correctionKind !== 'RATE') {
    validation('correctionKind must be PRINCIPAL or RATE');
  }
  assertNoForbiddenCorrectionFields(raw, raw.correctionKind);

  if (raw.correctionKind === 'PRINCIPAL') {
    return {
      correctionKind: 'PRINCIPAL',
      targetEventId: normalizeTargetEventId(raw.targetEventId),
      principalDeltaFen: normalizeSignedNonZeroFen(raw.principalDeltaFen),
      reason: normalizeReason(raw.reason),
    };
  }

  return {
    correctionKind: 'RATE',
    targetEventId: normalizeTargetEventId(raw.targetEventId),
    replacementRate: normalizeRateSnapshot(raw.replacementRate),
    reason: normalizeReason(raw.reason),
  };
}

export function assertCorrectionPayload(
  payload: unknown,
): asserts payload is CorrectionPayload {
  const normalized = normalizeCorrectionPayload(payload);
  const raw = payload as Record<string, unknown>;
  if (normalized.correctionKind === 'PRINCIPAL') {
    if (raw.correctionKind !== 'PRINCIPAL') {
      throw new AppError(ErrorCode.INVALID_STATE, 'Invalid principal Correction payload');
    }
  } else if (raw.correctionKind !== 'RATE') {
    throw new AppError(ErrorCode.INVALID_STATE, 'Invalid rate Correction payload');
  }
}

export async function createCorrectionRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createCorrectionRequest payload');
  const payload = normalizeCorrectionPayload(raw);
  return createKnownLoanChangeRequest(ctx, {
    loanId: normalizeLoanId(raw.loanId),
    type: LedgerRequestType.CORRECTION,
    payload,
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  });
}

function isRateAffecting(event: LoanEvent): boolean {
  return (
    (event.eventType === LoanEventType.RATE_CHANGE ||
      event.eventType === LoanEventType.CORRECTION) &&
    event.rate != null &&
    event.amountFen == null
  );
}

function requireTarget(
  events: LoanEvent[],
  targetEventId: string,
): LoanEvent {
  const target = events.find((event) => event._id === targetEventId);
  if (!target) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Correction target event was not found on this Loan',
    );
  }
  return target;
}

function assertPrincipalTarget(target: LoanEvent): void {
  if (principalDeltaForEvent(target) == null) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'PRINCIPAL correction must target a principal-affecting event',
    );
  }
}

function assertRateTargetIsCurrentWinner(
  events: LoanEvent[],
  target: LoanEvent,
): void {
  if (!isRateAffecting(target)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'RATE correction must target a rate-affecting event',
    );
  }
  const winner = events
    .filter(
      (event) =>
        event.effectiveDate === target.effectiveDate && isRateAffecting(event),
    )
    .reduce<LoanEvent | null>(
      (latest, event) => (!latest || event.sequence > latest.sequence ? event : latest),
      null,
    );
  if (!winner || winner._id !== target._id) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'RATE correction target is not the current same-day rate event',
    );
  }
}

export function buildCorrectionFormalEvent(params: {
  request: LedgerRequest & { loanId: string; payload: CorrectionPayload };
  actorUserId: string;
  sequence: number;
  now: number;
  currentEvents: LoanEvent[];
}): NewLoanEvent {
  const target = requireTarget(
    params.currentEvents,
    params.request.payload.targetEventId,
  );
  const base = {
    loanId: params.request.loanId,
    eventType: LoanEventType.CORRECTION,
    targetEventId: target._id,
    effectiveDate: target.effectiveDate,
    sourceRequestId: params.request._id,
    createdBy: params.request.proposerUserId,
    confirmedBy: params.actorUserId,
    sequence: params.sequence,
    idempotencyKey: eventIdempotencyKey(params.request._id, 'correction'),
    createdAt: params.now,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  } as const;

  if (params.request.payload.correctionKind === 'PRINCIPAL') {
    assertPrincipalTarget(target);
    const candidate: NewLoanEvent = {
      ...base,
      amountFen: params.request.payload.principalDeltaFen,
    };
    assertPrincipalTimelineNonNegative(params.currentEvents, candidate);
    return candidate;
  }

  assertRateTargetIsCurrentWinner(params.currentEvents, target);
  return {
    ...base,
    amountFen: null,
    rate: normalizeRateSnapshot(params.request.payload.replacementRate),
  };
}

export function correctionPayloadForStoredRequest(
  request: LedgerRequest,
): CorrectionPayload {
  if (request.type !== LedgerRequestType.CORRECTION) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request is not CORRECTION');
  }
  assertCorrectionPayload(request.payload);
  return request.payload;
}

export type { PrincipalCorrectionPayload, RateCorrectionPayload };
