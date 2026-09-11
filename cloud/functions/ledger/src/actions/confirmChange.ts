import {
  ChangeRequestStatus,
  Collections,
  LoanEventType,
} from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface ConfirmChangeInput {
  changeRequestId: string;
  /** true = confirm/apply, false = reject (spec §10). */
  approve: boolean;
}

export interface ConfirmChangeResult {
  status:
    | typeof ChangeRequestStatus.APPLIED
    | typeof ChangeRequestStatus.REJECTED;
  /** The new immutable event id when approved. */
  loanEventId?: string;
}

/**
 * The counterparty confirms (or rejects) a PENDING change request (spec §10,
 * §13). This is the single most safety-critical operation.
 *
 * Atomicity & idempotency (spec §13, §15):
 *  - Only the designated requiredConfirmer may confirm; caller verified server
 *    side, never trusting the client.
 *  - The PENDING -> APPLIED transition MUST be a conditional/compare-and-set
 *    update (update where status == PENDING). If it matches zero docs, another
 *    confirm already won — return the existing outcome, do NOT create a second
 *    event. This makes double-tap / network retry safe.
 *  - Creating the loan_event and flipping status to APPLIED must be atomic (or
 *    an idempotent recovery path must exist), so we never end up "confirmed but
 *    no event written". CloudBase transaction support must be verified; if
 *    unavailable, key the event by sourceRequestId with a unique index so a
 *    retried apply cannot duplicate.
 *  - PRINCIPAL_REPAY must be guarded against exceeding current principal
 *    (REPAY_EXCEEDS_PRINCIPAL) — decision pending §21.
 *  - Reject sets status REJECTED, writes no ledger event, keeps audit trail.
 *  - Always write audit_logs (actor, server time, request id, result).
 *
 * TODO(impl): implement the compare-and-set state machine described above.
 */
export async function confirmChange(
  ctx: CallContext,
  input: ConfirmChangeInput,
): Promise<ConfirmChangeResult> {
  void ctx;
  void input;
  void Collections;
  void LoanEventType;
  throw new Error('NOT_IMPLEMENTED: confirmChange');
}
