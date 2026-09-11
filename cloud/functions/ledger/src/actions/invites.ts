import {
  INVITE_TTL_MS,
  UserRole,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { generateRawToken, hashToken } from '../crypto.js';
import { requireAdmin, type ActionContext } from './action-context.js';

export interface CreateInviteInput {
  /** Display name for the invited member, e.g. "妈妈". */
  displayName: string;
}

export interface CreateInviteResult {
  /** The RAW one-time token. Returned ONCE, never stored server-side. Share
   *  this with the family member (embed in the invite link/QR). */
  rawToken: string;
  expiresAt: number;
}

/**
 * Admin creates a one-time invite for a new lender (spec §7). With
 * auto-create-on-bind, we do NOT create the user or loan account yet — the
 * invite carries the name/role/family, and binding creates them. Only the
 * token HASH is stored (spec §15); the raw token is returned once.
 */
export async function createInvite(
  ctx: ActionContext,
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  const admin = await requireAdmin(ctx);
  const displayName = (input?.displayName ?? '').trim();
  if (!displayName) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, 'displayName is required');
  }

  const rawToken = generateRawToken();
  const expiresAt = ctx.now + INVITE_TTL_MS;

  const invite = await ctx.repo.createInvite({
    familyId: admin.familyId,
    displayName,
    role: UserRole.LENDER,
    tokenHash: hashToken(rawToken),
    expiresAt,
    usedAt: null,
    consumedUserId: null,
    createdBy: admin._id,
    createdAt: ctx.now,
  });

  await ctx.repo.appendAudit({
    actorOpenId: ctx.openid,
    actorUserId: admin._id,
    action: 'createInvite',
    targetId: invite._id,
    requestId: null,
    result: 'OK',
    detail: `invite for ${displayName}`,
    serverTime: ctx.now,
  });

  return { rawToken, expiresAt };
}

export interface PreviewInviteInput {
  token: string;
}

export interface PreviewInviteResult {
  /** Name the invitee will confirm ("这是你的家庭借款账户：妈妈"). */
  displayName: string;
  valid: boolean;
}

/**
 * Read-only: resolve an invite by its raw token so the bind screen can show
 * "这是你的家庭借款账户：妈妈" before the user taps confirm (spec §7). Does not
 * mutate anything. Returns valid=false for unknown/expired/used tokens without
 * leaking why (the bind call returns the precise error).
 */
export async function previewInvite(
  ctx: ActionContext,
  input: PreviewInviteInput,
): Promise<PreviewInviteResult> {
  const token = input?.token ?? '';
  if (!token) return { displayName: '', valid: false };

  const invite = await ctx.repo.getInviteByHash(hashToken(token));
  const valid =
    !!invite && invite.usedAt == null && invite.expiresAt > ctx.now;
  return { displayName: valid ? invite!.displayName : '', valid };
}
