import { Collections } from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface BindInviteInput {
  /** The raw one-time token from the invite link. Server hashes to compare. */
  token: string;
}

export interface BindInviteResult {
  userId: string;
  displayName: string;
}

/**
 * First-bind: associate the caller's WeChat OPENID with the invited family
 * member account (spec §7). One-time, hashed token.
 *
 * Server responsibilities:
 *  - Hash the raw token and look up invite_tokens by tokenHash (we never store
 *    the raw token — spec §15).
 *  - Reject if not found (INVITE_INVALID), expired (INVITE_EXPIRED), or already
 *    used (INVITE_USED).
 *  - If this OPENID is already bound to a different account -> ALREADY_BOUND.
 *  - Bind targetUserId.openid = caller openid, set boundAt, mark token usedAt
 *    atomically (compare-and-set usedAt == null) so a double click can't bind
 *    twice or bind two accounts.
 *  - Audit the bind.
 *
 * TODO(impl): implement hashing + atomic single-use per above.
 */
export async function bindInvite(
  ctx: CallContext,
  input: BindInviteInput,
): Promise<BindInviteResult> {
  void ctx;
  void input;
  void Collections;
  throw new Error('NOT_IMPLEMENTED: bindInvite');
}
