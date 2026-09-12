import { createHash, randomBytes } from 'node:crypto';

/**
 * Invite-token helpers. A high-entropy raw token is the bearer credential shared
 * through the invite link; persistence stores ONLY its SHA-256 hash.
 */

/** Generate a URL-safe 32-byte raw invite token. */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

/** One-way hash used as the stored/lookup key for a token. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
