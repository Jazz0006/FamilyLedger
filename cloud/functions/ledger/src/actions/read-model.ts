import {
  LEDGER_TIMEZONE,
  LoanEventType,
  LoanStatus,
  type LedgerRequest,
  type Loan,
  type LoanEvent,
  type LoanSummary,
  type RateSnapshot,
  type UserId,
} from '@family-ledger/shared';
import {
  computeBalance,
  interestGrowthOn,
  isoDateInTimezone,
  previousDay,
  toInterestInput,
} from '@family-ledger/calc';
import { AppError, ErrorCode } from '../errors.js';
import type { LedgerRepo, LoanDirection } from '../data/repo.js';

const INTERNAL_PAGE_SIZE = 100;

function assertCursorAdvanced(
  previous: string | null,
  next: string | null,
  label: string,
): void {
  if (next !== null && next === previous) {
    throw new AppError(
      ErrorCode.INTERNAL,
      `${label} pagination cursor did not advance`,
    );
  }
}

export async function readAllLoanEvents(
  repo: LedgerRepo,
  loanId: string,
): Promise<LoanEvent[]> {
  const events: LoanEvent[] = [];
  let cursor: string | null = null;

  do {
    const page = await repo.listLoanEvents({
      loanId,
      page: { limit: INTERNAL_PAGE_SIZE, cursor },
    });
    events.push(...page.items);
    assertCursorAdvanced(cursor, page.nextCursor, 'Loan event');
    cursor = page.nextCursor;
  } while (cursor !== null);

  return events;
}

export async function readAllLoansForDirection(
  repo: LedgerRepo,
  userId: UserId,
  direction: LoanDirection,
  status: LoanStatus = LoanStatus.ACTIVE,
): Promise<Loan[]> {
  const loans: Loan[] = [];
  let cursor: string | null = null;

  do {
    const page = await repo.listLoansForUser({
      userId,
      direction,
      status,
      page: { limit: INTERNAL_PAGE_SIZE, cursor },
    });
    loans.push(...page.items);
    assertCursorAdvanced(cursor, page.nextCursor, 'Loan');
    cursor = page.nextCursor;
  } while (cursor !== null);

  return loans;
}

export async function readAllActionableRequests(
  repo: LedgerRepo,
  userId: UserId,
): Promise<LedgerRequest[]> {
  const requests: LedgerRequest[] = [];
  let cursor: string | null = null;

  do {
    const page = await repo.listActionableRequestsForUser({
      userId,
      page: { limit: INTERNAL_PAGE_SIZE, cursor },
    });
    requests.push(...page.items);
    assertCursorAdvanced(cursor, page.nextCursor, 'Ledger request');
    cursor = page.nextCursor;
  } while (cursor !== null);

  return requests;
}

export function ledgerToday(epochMillis: number): string {
  return isoDateInTimezone(epochMillis, LEDGER_TIMEZONE);
}

function compareRateEvents(a: LoanEvent, b: LoanEvent): number {
  if (a.effectiveDate !== b.effectiveDate) {
    return a.effectiveDate < b.effectiveDate ? -1 : 1;
  }
  return a.sequence - b.sequence;
}

/** Preserve the full agreed RateSnapshot metadata for display. */
export function currentRateSnapshot(
  events: LoanEvent[],
  asOfDate: string,
): RateSnapshot {
  const rateEvents = events
    .filter(
      (event) =>
        (event.eventType === LoanEventType.RATE_CHANGE ||
          event.eventType === LoanEventType.CORRECTION) &&
        event.rate != null,
    )
    .sort(compareRateEvents);

  if (rateEvents.length === 0) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Loan has no confirmed rate event',
    );
  }

  const effective = rateEvents.filter(
    (event) => event.effectiveDate <= asOfDate,
  );
  const chosen = effective[effective.length - 1] ?? rateEvents[0];

  if (!chosen?.rate) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan rate projection failed');
  }
  return chosen.rate;
}

function closeEventForLoan(loan: Loan, events: LoanEvent[]): LoanEvent | null {
  const closeEvents = events.filter(
    (event) => event.eventType === LoanEventType.LOAN_CLOSED,
  );

  if (loan.status === LoanStatus.ACTIVE) {
    if (loan.closedAt != null || closeEvents.length > 0) {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        'ACTIVE Loan contains closed lifecycle state',
      );
    }
    return null;
  }

  if (loan.status !== LoanStatus.CLOSED) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan has unknown lifecycle status');
  }
  if (loan.closedAt == null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'CLOSED Loan is missing closedAt');
  }
  if (closeEvents.length !== 1) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'CLOSED Loan must contain exactly one LOAN_CLOSED event',
    );
  }

  const closeEvent = closeEvents[0]!;
  const settledInterestFen = closeEvent.closeSettlement?.accruedInterestFen;
  if (
    settledInterestFen == null ||
    !Number.isSafeInteger(settledInterestFen) ||
    settledInterestFen < 0
  ) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'LOAN_CLOSED event has invalid settlement snapshot',
    );
  }
  return closeEvent;
}

export function deriveLoanSummary(
  loan: Loan,
  events: LoanEvent[],
  asOfDate: string,
): LoanSummary {
  const closeEvent = closeEventForLoan(loan, events);
  const currentRate = currentRateSnapshot(events, asOfDate);

  if (closeEvent && asOfDate >= closeEvent.effectiveDate) {
    return {
      loanId: loan._id,
      lenderUserId: loan.lenderUserId,
      borrowerUserId: loan.borrowerUserId,
      status: loan.status,
      principalFen: 0,
      interestFen: 0,
      totalFen: 0,
      todayInterestFen: 0,
      currentRate,
      asOfDate,
      closeEffectiveDate: closeEvent.effectiveDate,
      settledInterestFen: closeEvent.closeSettlement!.accruedInterestFen,
    };
  }

  const input = toInterestInput(events, asOfDate);
  const balance = computeBalance(input);
  const todayInterestFen = interestGrowthOn(input, previousDay(asOfDate));

  return {
    loanId: loan._id,
    lenderUserId: loan.lenderUserId,
    borrowerUserId: loan.borrowerUserId,
    status: loan.status,
    principalFen: balance.principalFen,
    interestFen: balance.interestFen,
    totalFen: balance.totalDueFen,
    todayInterestFen,
    currentRate,
    asOfDate,
    closeEffectiveDate: closeEvent?.effectiveDate ?? null,
    settledInterestFen: closeEvent?.closeSettlement!.accruedInterestFen ?? null,
  };
}

export async function deriveLoanSummaryFromRepo(
  repo: LedgerRepo,
  loan: Loan,
  asOfDate: string,
): Promise<LoanSummary> {
  return deriveLoanSummary(
    loan,
    await readAllLoanEvents(repo, loan._id),
    asOfDate,
  );
}
