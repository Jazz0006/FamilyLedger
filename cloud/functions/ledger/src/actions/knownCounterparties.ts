import {
  LoanStatus,
  type UserDisplayProfile,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { LedgerRepo } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import { readAllLoansForDirection } from './read-model.js';
import { requireUserDisplayProfile } from './user-display.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface KnownCounterpartyView {
  user: UserDisplayProfile;
  lastLoanAt: number;
}

async function knownCounterpartyTimestamps(
  repo: LedgerRepo,
  userId: string,
): Promise<Map<string, number>> {
  const [activeLender, activeBorrower, closedLender, closedBorrower] =
    await Promise.all([
      readAllLoansForDirection(repo, userId, 'LENDER', LoanStatus.ACTIVE),
      readAllLoansForDirection(repo, userId, 'BORROWER', LoanStatus.ACTIVE),
      readAllLoansForDirection(repo, userId, 'LENDER', LoanStatus.CLOSED),
      readAllLoansForDirection(repo, userId, 'BORROWER', LoanStatus.CLOSED),
    ]);

  const latest = new Map<string, number>();
  for (const loan of [
    ...activeLender,
    ...activeBorrower,
    ...closedLender,
    ...closedBorrower,
  ]) {
    const otherUserId =
      loan.lenderUserId === userId ? loan.borrowerUserId : loan.lenderUserId;
    if (otherUserId === userId) continue;
    latest.set(
      otherUserId,
      Math.max(latest.get(otherUserId) ?? Number.MIN_SAFE_INTEGER, loan.createdAt),
    );
  }
  return latest;
}

export async function assertKnownCounterparty(
  repo: LedgerRepo,
  userId: string,
  counterpartyUserId: string,
): Promise<void> {
  if (counterpartyUserId === userId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Counterparty cannot be the current User');
  }
  const known = await knownCounterpartyTimestamps(repo, userId);
  if (!known.has(counterpartyUserId)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Selected User is not an established counterparty',
    );
  }
}

function normalizeLimit(input: unknown): number {
  if (input == null) return DEFAULT_LIMIT;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'listKnownCounterparties payload must be an object',
    );
  }
  const value = (input as Record<string, unknown>).limit;
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
    );
  }
  return value as number;
}

export async function listKnownCounterparties(
  ctx: ActionContext,
  input: unknown,
): Promise<{ items: KnownCounterpartyView[] }> {
  const actor = await requireCurrentUser(ctx);
  const limit = normalizeLimit(input);
  const timestamps = await knownCounterpartyTimestamps(ctx.repo, actor._id);
  const selected = [...timestamps.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);

  const items = await Promise.all(
    selected.map(async ([userId, lastLoanAt]) => ({
      user: await requireUserDisplayProfile(ctx.repo, userId),
      lastLoanAt,
    })),
  );
  return { items };
}
