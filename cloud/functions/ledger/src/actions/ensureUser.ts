import type { User } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';

const DEFAULT_DISPLAY_NAME = '微信用户';
const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_AVATAR_URL_LENGTH = 2_048;

export interface EnsureUserInput {
  displayName?: string;
  avatarUrl?: string | null;
}

function normalizeInput(input: unknown): EnsureUserInput {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'ensureUser payload must be an object',
    );
  }

  const raw = input as Record<string, unknown>;
  let displayName: string | undefined;
  if (raw.displayName !== undefined) {
    if (typeof raw.displayName !== 'string') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'displayName must be a string',
      );
    }
    const trimmed = raw.displayName.trim();
    if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
      );
    }
    if (trimmed.length > 0) displayName = trimmed;
  }

  let avatarUrl: string | null | undefined;
  if (raw.avatarUrl !== undefined) {
    if (raw.avatarUrl !== null && typeof raw.avatarUrl !== 'string') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'avatarUrl must be a string or null',
      );
    }
    if (typeof raw.avatarUrl === 'string') {
      const trimmed = raw.avatarUrl.trim();
      if (trimmed.length > MAX_AVATAR_URL_LENGTH) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `avatarUrl must be at most ${MAX_AVATAR_URL_LENGTH} characters`,
        );
      }
      avatarUrl = trimmed.length > 0 ? trimmed : null;
    } else {
      avatarUrl = null;
    }
  }

  return { displayName, avatarUrl };
}

/**
 * Resolve the authenticated OPENID to one ordinary v2 User.
 *
 * Client payload never supplies identity. Existing users are returned unchanged;
 * profile editing is a separate future use case rather than a side effect of
 * bootstrap/login.
 */
export async function ensureUser(
  ctx: ActionContext,
  input: unknown = undefined,
): Promise<User> {
  const existing = await ctx.repo.getUserByOpenid(ctx.openid);
  if (existing) return existing;

  const normalized = normalizeInput(input);
  const result = await ctx.repo.createUserIfOpenidFree({
    openid: ctx.openid,
    displayName: normalized.displayName ?? DEFAULT_DISPLAY_NAME,
    avatarUrl: normalized.avatarUrl ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  return result.item;
}
