import { createHash, randomBytes } from 'node:crypto';

/**
 * Invite-token helpers. We generate a high-entropy raw token to embed in the
 * invite link, but persist ONLY its SHA-256 hash (spec §15). The raw token is
 * shown to the admin once and never stored server-side.
 */

/** Generate a URL-safe raw invite token (never stored; shared with the family member). */
export function generateRawToken(): string {
  // 32 bytes -> ~43 char base64url. Ample entropy against guessing.
  return randomBytes(32).toString('base64url');
}

/** One-way hash used as the stored/lookup key for a token. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
