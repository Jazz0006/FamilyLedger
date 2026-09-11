import {
  LEDGER_TIMEZONE,
  UserRole,
  type User,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { LedgerRepo } from '../data/repo.js';

/**
 * What every action receives: the data-access repo, the authenticated caller's
 * OPENID, server time, and the ledger timezone. Actions never touch the SDK or
 * client-supplied identity directly.
 */
export interface ActionContext {
  repo: LedgerRepo;
  openid: string;
  now: number;
  timeZone: string;
}

export function makeActionContext(params: {
  repo: LedgerRepo;
  openid: string;
  now: number;
  timeZone?: string;
}): ActionContext {
  return {
    repo: params.repo,
    openid: params.openid,
    now: params.now,
    timeZone: params.timeZone ?? LEDGER_TIMEZONE,
  };
}

/** Resolve the caller to a bound user, or throw NOT_BOUND. */
export async function requireUser(ctx: ActionContext): Promise<User> {
  const user = await ctx.repo.getUserByOpenid(ctx.openid);
  if (!user || user.boundAt == null) {
    throw new AppError(ErrorCode.NOT_BOUND, 'This WeChat account is not bound');
  }
  return user;
}

/** Resolve the caller and assert they are the borrower/admin, or throw. */
export async function requireAdmin(ctx: ActionContext): Promise<User> {
  const user = await requireUser(ctx);
  if (user.role !== UserRole.BORROWER) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Admin only');
  }
  return user;
}
