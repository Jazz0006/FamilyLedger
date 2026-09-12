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

/**
 * Preserve full agreed RateSnapshot metadata for display. The calc engine only
 * needs the numeric annual rate, so current-rate metadata is projected directly
 * from formal RATE_CHANGE/CORRECTION events.
 */
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
  const chosen =
    effective[effective.length - 1] ?? rateEvents[0];

  if (!chosen?.rate) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Loan rate projection failed');
  }
  return chosen.rate;
}

export function deriveLoanSummary(
  loan: Loan,
  events: LoanEvent[],
  asOfDate: string,
): LoanSummary {
  const input = toInterestInput(events, asOfDate);
  const balance = computeBalance(input);
  const todayInterestFen = interestGrowthOn(input, previousDay(asOfDate));

  return {
    loanId: loan._id,
    lenderUserId: loan.lenderUserId,
    borrowerUserId: loan.borrowerUserId,
    principalFen: balance.principalFen,
    interestFen: balance.interestFen,
    totalFen: balance.totalDueFen,
    todayInterestFen,
    currentRate: currentRateSnapshot(events, asOfDate),
    asOfDate,
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
