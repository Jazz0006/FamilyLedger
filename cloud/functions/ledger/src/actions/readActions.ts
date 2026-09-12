import {
  LoanStatus,
  type LedgerRequest,
  type Loan,
  type LoanEvent,
  type LoanSummary,
  type UserHomeSummary,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { isLoanParticipant } from '../domain/permissions.js';
import type { LoanDirection, Page } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import {
  deriveLoanSummaryFromRepo,
  ledgerToday,
  readAllActionableRequests,
  readAllLoansForDirection,
} from './read-model.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface LoanView {
  loan: Loan;
  direction: LoanDirection;
  counterpartyUserId: string;
  summary: LoanSummary;
}

export interface LoanListPage {
  items: LoanView[];
  nextCursor: string | null;
}

function requireObjectOrEmpty(input: unknown, label: string): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${label} payload must be an object`);
  }
  return input as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function pageInput(raw: Record<string, unknown>): {
  limit: number;
  cursor: string | null;
} {
  const limit = raw.limit === undefined ? DEFAULT_PAGE_SIZE : raw.limit;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `limit must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  if (
    raw.cursor !== undefined &&
    raw.cursor !== null &&
    typeof raw.cursor !== 'string'
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'cursor must be a string or null');
  }
  return { limit, cursor: (raw.cursor as string | null | undefined) ?? null };
}

function loanDirection(loan: Loan, userId: string): LoanDirection {
  if (loan.lenderUserId === userId) return 'LENDER';
  if (loan.borrowerUserId === userId) return 'BORROWER';
  throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
}

async function participantLoan(
  ctx: ActionContext,
  loanId: string,
  userId: string,
): Promise<Loan> {
  const loan = await ctx.repo.getLoan(loanId);
  // Deliberately collapse missing and unauthorized into the same response so an
  // unrelated caller cannot use Loan IDs to enumerate private relationships.
  if (!loan || !isLoanParticipant(loan, userId)) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
  }
  return loan;
}

function toLoanView(
  loan: Loan,
  userId: string,
  summary: LoanSummary,
): LoanView {
  const direction = loanDirection(loan, userId);
  return {
    loan,
    direction,
    counterpartyUserId:
      direction === 'LENDER' ? loan.borrowerUserId : loan.lenderUserId,
    summary,
  };
}

export async function getLoan(
  ctx: ActionContext,
  input: unknown,
): Promise<LoanView> {
  const raw = requireObjectOrEmpty(input, 'getLoan');
  const loanId = requiredString(raw.loanId, 'loanId');
  const actor = await requireCurrentUser(ctx);
  const loan = await participantLoan(ctx, loanId, actor._id);
  const summary = await deriveLoanSummaryFromRepo(
    ctx.repo,
    loan,
    ledgerToday(ctx.now),
  );
  return toLoanView(loan, actor._id, summary);
}

export async function listLoans(
  ctx: ActionContext,
  input: unknown,
): Promise<LoanListPage> {
  const raw = requireObjectOrEmpty(input, 'listLoans');
  const actor = await requireCurrentUser(ctx);
  if (raw.direction !== 'LENDER' && raw.direction !== 'BORROWER') {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'direction must be LENDER or BORROWER',
    );
  }
  const status = raw.status ?? LoanStatus.ACTIVE;
  if (status !== LoanStatus.ACTIVE && status !== LoanStatus.CLOSED) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'status must be ACTIVE or CLOSED',
    );
  }
  const page = pageInput(raw);
  const loans = await ctx.repo.listLoansForUser({
    userId: actor._id,
    direction: raw.direction,
    status,
    page,
  });
  const asOfDate = ledgerToday(ctx.now);
  const items = await Promise.all(
    loans.items.map(async (loan) =>
      toLoanView(
        loan,
        actor._id,
        await deriveLoanSummaryFromRepo(ctx.repo, loan, asOfDate),
      ),
    ),
  );
  return { items, nextCursor: loans.nextCursor };
}

export async function listLoanEvents(
  ctx: ActionContext,
  input: unknown,
): Promise<Page<LoanEvent>> {
  const raw = requireObjectOrEmpty(input, 'listLoanEvents');
  const loanId = requiredString(raw.loanId, 'loanId');
  const actor = await requireCurrentUser(ctx);
  await participantLoan(ctx, loanId, actor._id);
  return ctx.repo.listLoanEvents({ loanId, page: pageInput(raw) });
}

export async function listPendingRequests(
  ctx: ActionContext,
  input: unknown,
): Promise<Page<LedgerRequest>> {
  const raw = requireObjectOrEmpty(input, 'listPendingRequests');
  const actor = await requireCurrentUser(ctx);
  return ctx.repo.listActionableRequestsForUser({
    userId: actor._id,
    page: pageInput(raw),
  });
}

function emptySide() {
  return {
    principalFen: 0,
    interestFen: 0,
    totalFen: 0,
    loanCount: 0,
  };
}

async function aggregateDirection(
  ctx: ActionContext,
  userId: string,
  direction: LoanDirection,
  asOfDate: string,
) {
  const side = emptySide();
  const loans = await readAllLoansForDirection(
    ctx.repo,
    userId,
    direction,
    LoanStatus.ACTIVE,
  );
  for (const loan of loans) {
    const summary = await deriveLoanSummaryFromRepo(ctx.repo, loan, asOfDate);
    side.principalFen += summary.principalFen;
    side.interestFen += summary.interestFen;
    side.totalFen += summary.totalFen;
    side.loanCount += 1;
  }
  return side;
}

export async function getHomeSummary(
  ctx: ActionContext,
  _input: unknown = undefined,
): Promise<UserHomeSummary> {
  const actor = await requireCurrentUser(ctx);
  const asOfDate = ledgerToday(ctx.now);
  const [receivable, payable, actionable] = await Promise.all([
    aggregateDirection(ctx, actor._id, 'LENDER', asOfDate),
    aggregateDirection(ctx, actor._id, 'BORROWER', asOfDate),
    readAllActionableRequests(ctx.repo, actor._id),
  ]);

  return {
    receivable,
    payable,
    pendingRequestCount: actionable.length,
  };
}
