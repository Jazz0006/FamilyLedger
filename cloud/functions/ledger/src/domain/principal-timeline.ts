import {
  LoanEventType,
  type LoanEvent,
} from '@family-ledger/shared';
import type { NewLoanEvent } from '../data/repo.js';
import { AppError, ErrorCode } from '../errors.js';

type PrincipalEventShape = Pick<
  LoanEvent,
  'eventType' | 'amountFen' | 'rate' | 'effectiveDate' | 'sequence'
>;

/** Return the signed principal effect of one formal event, or null for non-principal events. */
export function principalDeltaForEvent(event: PrincipalEventShape): number | null {
  switch (event.eventType) {
    case LoanEventType.PRINCIPAL_ADD:
      if (event.amountFen == null) {
        throw new AppError(
          ErrorCode.INVALID_STATE,
          'PRINCIPAL_ADD event is missing amountFen',
        );
      }
      return event.amountFen;
    case LoanEventType.PRINCIPAL_REPAY:
      if (event.amountFen == null) {
        throw new AppError(
          ErrorCode.INVALID_STATE,
          'PRINCIPAL_REPAY event is missing amountFen',
        );
      }
      return -Math.abs(event.amountFen);
    case LoanEventType.CORRECTION:
      if (event.amountFen != null && event.rate != null) {
        throw new AppError(
          ErrorCode.INVALID_STATE,
          'CORRECTION event cannot affect principal and rate simultaneously',
        );
      }
      return event.amountFen != null ? event.amountFen : null;
    case LoanEventType.RATE_CHANGE:
    case LoanEventType.LOAN_CLOSED:
      return null;
  }
}

/**
 * Insert a candidate formal mutation into the existing timeline and require
 * outstanding principal to remain non-negative after every ledger-date boundary.
 * Events on one effective date are grouped before checking the boundary.
 */
export function assertPrincipalTimelineNonNegative(
  currentEvents: LoanEvent[],
  candidate: NewLoanEvent,
): void {
  const rows = [...currentEvents, candidate]
    .map((event) => ({
      effectiveDate: event.effectiveDate,
      sequence: event.sequence,
      delta: principalDeltaForEvent(event),
    }))
    .filter((row): row is { effectiveDate: string; sequence: number; delta: number } =>
      row.delta != null,
    )
    .sort((a, b) => {
      if (a.effectiveDate !== b.effectiveDate) {
        return a.effectiveDate < b.effectiveDate ? -1 : 1;
      }
      return a.sequence - b.sequence;
    });

  let principalFen = 0;
  let index = 0;
  while (index < rows.length) {
    const date = rows[index]!.effectiveDate;
    while (index < rows.length && rows[index]!.effectiveDate === date) {
      principalFen += rows[index]!.delta;
      index += 1;
    }
    if (principalFen < 0) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Formal mutation would make principal negative after ${date}`,
      );
    }
  }
}
