import { LoanAccountStatus, CURRENCY } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { hashToken } from '../crypto.js';
import type { ActionContext } from './action-context.js';

export interface BindInviteInput {
  /** The raw one-time token from the invite link. Server hashes to compare. */
  token: string;
}

export interface BindInviteResult {
  userId: string;
  displayName: string;
  loanId: string;
}

/**
 * First-bind: associate the caller's WeChat OPENID with a family member account
 * (spec §7). Auto-create-on-bind: the user + their loan account are created
 * here (not at invite time). One-time, hashed token.
 *
 * Ordering matters for safety:
 *  1. Look up the invite by token hash; reject unknown / expired / used.
 *  2. If this OPENID is already a bound user -> ALREADY_BOUND (can't hold two).
 *  3. Compare-and-set consume the invite (usedAt == null). If we lose the race,
 *     the token was already used -> INVITE_USED. This is the single-use gate.
 *  4. Only after winning the consume do we create the user + loan account, so a
 *     double-tap can create at most one account per invite. createUser is also
 *     openid-idempotent as a second layer.
 */
export async function bindInvite(
  ctx: ActionContext,
  input: BindInviteInput,
): Promise<BindInviteResult> {
  const token = input?.token ?? '';
  if (!token) {
    throw new AppError(ErrorCode.INVITE_INVALID, 'Missing invite token');
  }

  const invite = await ctx.repo.getInviteByHash(hashToken(token));
  if (!invite) {
    throw new AppError(ErrorCode.INVITE_INVALID, 'Invite not found');
  }
  if (invite.usedAt != null) {
    throw new AppError(ErrorCode.INVITE_USED, 'Invite already used');
  }
  if (invite.expiresAt <= ctx.now) {
    throw new AppError(ErrorCode.INVITE_EXPIRED, 'Invite expired');
  }

  // One WeChat identity binds to at most one account (spec §4).
  const existing = await ctx.repo.getUserByOpenid(ctx.openid);
  if (existing && existing.boundAt != null) {
    throw new AppError(
      ErrorCode.ALREADY_BOUND,
      'This WeChat account is already bound',
    );
  }

  // Create the user first (openid-idempotent), so we have an id to record on
  // the invite when we consume it.
  const { user } = await ctx.repo.createUserIfOpenidFree({
    openid: ctx.openid,
    displayName: invite.displayName,
    role: invite.role,
    familyId: invite.familyId,
    boundAt: ctx.now,
  });

  // Single-use gate: only the caller who flips usedAt null->now proceeds to
  // create the loan account. A concurrent second tap loses here.
  const won = await ctx.repo.consumeInvite(invite._id, ctx.now, user._id);
  if (!won) {
    throw new AppError(ErrorCode.INVITE_USED, 'Invite already used');
  }

  // Auto-create the lender's loan account (曾骏 is the borrower).
  const borrower = await requireBorrower(ctx, invite.familyId);
  const account = await ctx.repo.createLoanAccount({
    familyId: invite.familyId,
    lenderUserId: user._id,
    borrowerUserId: borrower._id,
    currency: CURRENCY,
    status: LoanAccountStatus.ACTIVE,
  });

  await ctx.repo.appendAudit({
    actorOpenId: ctx.openid,
    actorUserId: user._id,
    action: 'bindInvite',
    targetId: account._id,
    requestId: invite._id,
    result: 'OK',
    detail: `bound ${invite.displayName}, created loan ${account._id}`,
    serverTime: ctx.now,
  });

  return { userId: user._id, displayName: user.displayName, loanId: account._id };
}

async function requireBorrower(ctx: ActionContext, familyId: string) {
  const users = await ctx.repo.listUsersInFamily(familyId);
  const borrower = users.find((u) => u.role === 'BORROWER');
  if (!borrower) {
    // Should be impossible if bootstrap ran, but never create a loan without
    // a borrower to owe it.
    throw new AppError(ErrorCode.CONFLICT, 'No admin/borrower in family yet');
  }
  return borrower;
}
