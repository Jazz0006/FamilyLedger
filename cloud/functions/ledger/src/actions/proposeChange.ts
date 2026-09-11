import {
  ChangeRequestStatus,
  ChangeRequestType,
  Collections,
  type Fen,
  type IsoDate,
} from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface ProposeChangeInput {
  loanId: string;
  type: ChangeRequestType;
  amountFen?: Fen;
  proposedRate?: string;
  /** Optional; server defaults to today in ledger tz if omitted (Rule F). */
  proposedEffectiveDate?: IsoDate;
  /** Client-generated UUID for idempotency (spec §15). Required. */
  idempotencyKey: string;
}

export interface ProposeChangeResult {
  changeRequestId: string;
  status: typeof ChangeRequestStatus.PENDING;
}

/**
 * Create a PENDING change request that the counterparty must confirm (spec
 * Rule B, §10). Does NOT write a ledger event — that happens only on confirm.
 *
 * Server responsibilities (all authoritative, never trust client):
 *  - Verify caller belongs to the loan and is allowed to propose this type.
 *    (§21 open Q: whether lenders may propose PRINCIPAL_ADD or admin-only.)
 *  - Validate amountFen is a positive integer for principal changes.
 *  - Set requiredConfirmer to the OTHER party.
 *  - Enforce idempotency via a UNIQUE index on idempotencyKey: a retry with
 *    the same key returns the existing request instead of creating a new one.
 *  - Default proposedEffectiveDate to today (Asia/Shanghai) unless backdating
 *    is enabled (§21 open Q).
 *  - Write an audit_logs entry.
 *
 * TODO(impl): implement per above once §21 open questions are decided.
 */
export async function proposeChange(
  ctx: CallContext,
  input: ProposeChangeInput,
): Promise<ProposeChangeResult> {
  void ctx;
  void input;
  void Collections;
  void ChangeRequestType;
  throw new Error('NOT_IMPLEMENTED: proposeChange');
}
