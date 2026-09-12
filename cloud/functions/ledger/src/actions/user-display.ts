import type { User, UserDisplayProfile } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { LedgerRepo } from '../data/repo.js';

export function toUserDisplayProfile(user: User): UserDisplayProfile {
  return {
    userId: user._id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  };
}

/** Resolve an already-authorized participant reference without exposing OPENID. */
export async function requireUserDisplayProfile(
  repo: LedgerRepo,
  userId: string,
): Promise<UserDisplayProfile> {
  const user = await repo.getUserById(userId);
  if (!user) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'Ledger participant User record is missing',
    );
  }
  return toUserDisplayProfile(user);
}
