import type { User } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { LedgerRepo } from '../data/repo.js';

/**
 * Trusted application context for v2 actions.
 *
 * Identity is resolved by the CloudBase runtime before an action is invoked.
 * There is deliberately no family/admin/global-role state here.
 */
export interface ActionContext {
  repo: LedgerRepo;
  openid: string;
  now: number;
}

export function makeActionContext(params: ActionContext): ActionContext {
  return params;
}

/** Resolve an already-created v2 User from trusted runtime OPENID. */
export async function requireCurrentUser(ctx: ActionContext): Promise<User> {
  const user = await ctx.repo.getUserByOpenid(ctx.openid);
  if (!user) {
    throw new AppError(
      ErrorCode.UNAUTHENTICATED,
      'No v2 User exists for the authenticated WeChat identity',
    );
  }
  return user;
}
