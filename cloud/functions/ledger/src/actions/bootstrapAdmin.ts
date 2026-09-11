import {
  DEFAULT_FAMILY_ID,
  UserRole,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';

export interface BootstrapAdminInput {
  /** Display name for the admin account, e.g. "曾骏". */
  displayName: string;
}

export interface BootstrapAdminResult {
  userId: string;
  familyId: string;
}

/**
 * One-time bootstrap: the FIRST WeChat account to call this becomes the
 * BORROWER/admin. Once any borrower exists, this action permanently refuses
 * (self-disabling), so it cannot be used to seize admin later.
 *
 * This resolves the onboarding chicken-and-egg: invites are created by the
 * admin, but the first admin has no one to invite them.
 *
 * Safety notes:
 *  - Guarded by borrowerExists(): the very first successful call closes the
 *    window. There is a brief "first caller wins" race by design (accepted).
 *  - Binds the caller's server-resolved OPENID (never client-supplied).
 *  - The user insert goes through the unique-openid path, so a double-tap does
 *    not create two admins.
 */
export async function bootstrapAdmin(
  ctx: ActionContext,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const displayName = (input?.displayName ?? '').trim();
  if (!displayName) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, 'displayName is required');
  }

  if (await ctx.repo.borrowerExists()) {
    await ctx.repo.appendAudit({
      actorOpenId: ctx.openid,
      actorUserId: null,
      action: 'bootstrapAdmin',
      targetId: null,
      requestId: null,
      result: 'DENIED',
      detail: 'admin already exists',
      serverTime: ctx.now,
    });
    throw new AppError(ErrorCode.CONFLICT, 'Admin already exists');
  }

  const { user, created } = await ctx.repo.createUserIfOpenidFree({
    openid: ctx.openid,
    displayName,
    role: UserRole.BORROWER,
    familyId: DEFAULT_FAMILY_ID,
    boundAt: ctx.now,
  });

  await ctx.repo.appendAudit({
    actorOpenId: ctx.openid,
    actorUserId: user._id,
    action: 'bootstrapAdmin',
    targetId: user._id,
    requestId: null,
    result: 'OK',
    detail: created ? 'admin created' : 'already bound (idempotent)',
    serverTime: ctx.now,
  });

  return { userId: user._id, familyId: user.familyId };
}
