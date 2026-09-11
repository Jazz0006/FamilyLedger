import { Collections } from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface SetupCollectionsResult {
  created: string[];
  existing: string[];
}

/**
 * One-time maintenance: create any of the 7 collections that don't exist yet
 * (spec §16). Safe to call repeatedly — creating an existing collection is a
 * no-op we swallow. This removes the manual "click +7 times" step.
 *
 * IMPORTANT: this does NOT create indexes. Unique indexes
 * (users.openid, loan_events.idempotencyKey, loan_events.sourceRequestId,
 * invite_tokens.tokenHash, change_requests.idempotencyKey) MUST still be
 * created in the console — the SDK cannot manage them. See docs/CLOUDBASE_SETUP.md.
 *
 * This runs before any admin exists (collections must precede bootstrapAdmin),
 * so it is intentionally unauthenticated. It can only CREATE empty collections
 * — it never reads, writes rows, or deletes — so leaving it callable is low
 * risk. Call it once right after deploy.
 *
 * Takes the raw CallContext (needs the low-level db handle for createCollection,
 * which is not part of the LedgerRepo business interface).
 */
export async function setupCollections(
  call: CallContext,
): Promise<SetupCollectionsResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const name of Object.values(Collections)) {
    try {
      // createCollection resolves for new collections and rejects (or returns
      // a non-ok result) when the collection already exists.
      await Promise.resolve(call.db.createCollection(name));
      created.push(name);
    } catch {
      existing.push(name);
    }
  }

  return { created, existing };
}
