import { Collections, LoanEventType, type Fen } from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface RecordLodgmentInput {
  loanId: string;
  amountFen: Fen;
  /** Client-generated UUID for idempotency (spec §15). Required. */
  idempotencyKey: string;
}

export interface RecordLodgmentResult {
  loanEventId: string;
}

/**
 * Admin records a new lodgment (PRINCIPAL_ADD). Increases 曾骏's debt, so per
 * Rule B (v1.1) it is admin-only and applies immediately — NO lender
 * confirmation, NO change_request. Effective date is today (Rule F).
 *
 * Server responsibilities (all authoritative):
 *  - Verify caller role == BORROWER/admin via users collection (never trust
 *    a client-supplied role, spec §15).
 *  - Validate amountFen is a positive integer (分).
 *  - Idempotency: writing loan_events must be guarded by a unique key so a
 *    double-tap / retry cannot insert two PRINCIPAL_ADD events. Use the
 *    idempotencyKey as the unique guard (e.g. store it on the event or via a
 *    dedicated dedupe key); a retry returns the already-created event id.
 *  - effectiveDate = today in Asia/Shanghai (server-computed, not client).
 *  - Append an audit_logs entry.
 *
 * TODO(impl).
 */
export async function recordLodgment(
  ctx: CallContext,
  input: RecordLodgmentInput,
): Promise<RecordLodgmentResult> {
  void ctx;
  void input;
  void Collections;
  void LoanEventType;
  throw new Error('NOT_IMPLEMENTED: recordLodgment');
}
