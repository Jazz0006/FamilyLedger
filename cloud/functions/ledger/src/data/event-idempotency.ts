import type { NewLoanEvent } from './repo.js';
import { AppError, ErrorCode } from '../errors.js';

export type EventPurpose =
  | 'initial-principal'
  | 'initial-rate'
  | 'principal-add'
  | 'principal-repay'
  | 'rate-change'
  | 'correction'
  | 'loan-close';

/** Deterministic server-generated key for formal events created by one request. */
export function eventIdempotencyKey(
  requestId: string,
  purpose: EventPurpose,
): string {
  if (!requestId || requestId.includes(':')) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'requestId must be non-empty and must not contain a colon',
    );
  }
  return `${requestId}:${purpose}`;
}

function normalizeEvent(event: NewLoanEvent): object {
  return {
    loanId: event.loanId,
    eventType: event.eventType,
    amountFen: event.amountFen,
    rate: event.rate
      ? {
          annualEffectiveRate: event.rate.annualEffectiveRate,
          rateSource: event.rate.rateSource,
          rateReferenceYear: event.rate.rateReferenceYear ?? null,
          rateReferenceLabel: event.rate.rateReferenceLabel ?? null,
        }
      : null,
    targetEventId: event.targetEventId ?? null,
    effectiveDate: event.effectiveDate,
    sourceRequestId: event.sourceRequestId,
    createdBy: event.createdBy,
    confirmedBy: event.confirmedBy,
    sequence: event.sequence,
    idempotencyKey: event.idempotencyKey,
    createdAt: event.createdAt,
    schemaVersion: event.schemaVersion,
  };
}

export function sameEventMutation(
  existing: NewLoanEvent,
  incoming: NewLoanEvent,
): boolean {
  return JSON.stringify(normalizeEvent(existing)) === JSON.stringify(normalizeEvent(incoming));
}

export function assertSameEventMutation(
  existing: NewLoanEvent,
  incoming: NewLoanEvent,
): void {
  if (!sameEventMutation(existing, incoming)) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Event idempotency key was reused with different event content',
    );
  }
}
