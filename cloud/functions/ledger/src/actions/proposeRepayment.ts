import {
  ChangeRequestStatus,
  Collections,
  type Fen,
} from '@family-ledger/shared';
import type { CallContext } from '../context.js';

export interface ProposeRepaymentInput {
  loanId: string;
  amountFen: Fen;
  /** Client-generated UUID for idempotency (spec §15). Required. */
  idempotencyKey: string;
}

export interface ProposeRepaymentResult {
  changeRequestId: string;
  status: typeof ChangeRequestStatus.PENDING;
}

/**
 * Admin proposes a repayment (PRINCIPAL_REPAY). Decreases 曾骏's debt, so per
 * Rule B (v1.1) it needs the LENDER to confirm. This creates a PENDING
 * change_request only — NO ledger event yet (that happens on confirm).
 *
 * Server responsibilities (all authoritative):
 *  - Verify caller role == BORROWER/admin (spec §15).
 *  - Validate amountFen is a positive integer and does NOT exceed the loan's
 *    current principal (else REPAY_EXCEEDS_PRINCIPAL). Guards a negative debt.
 *  - Set requiredConfirmer = the lender of this loan.
 *  - Idempotency: UNIQUE index on change_requests.idempotencyKey; a retry with
 *    the same key returns the existing request instead of creating a new one.
 *  - effectiveDate is NOT set here — it is fixed to the confirmation day when
 *    the lender confirms (Rule F).
 *  - Append an audit_logs entry.
 *
 * TODO(impl).
 */
export async function proposeRepayment(
  ctx: CallContext,
  input: ProposeRepaymentInput,
): Promise<ProposeRepaymentResult> {
  void ctx;
  void input;
  void Collections;
  throw new Error('NOT_IMPLEMENTED: proposeRepayment');
}
