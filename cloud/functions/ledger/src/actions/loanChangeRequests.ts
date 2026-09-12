import {
  LedgerRequestType,
  type LedgerRequest,
  type PrincipalAddPayload,
  type RateChangePayload,
} from '@family-ledger/shared';
import type { ActionContext } from './action-context.js';
import {
  createKnownLoanChangeRequest,
  normalizeIdempotencyKey,
  normalizeLoanId,
  normalizeNote,
  normalizePositiveFen,
  requireObject,
} from './known-change-common.js';
import {
  assertIsoDate,
  normalizeRateSnapshot,
} from './create-loan-common.js';

export async function createPrincipalAddRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createPrincipalAddRequest payload');
  const payload: PrincipalAddPayload = {
    amountFen: normalizePositiveFen(raw.amountFen),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
  };
  return createKnownLoanChangeRequest(ctx, {
    loanId: normalizeLoanId(raw.loanId),
    type: LedgerRequestType.PRINCIPAL_ADD,
    payload,
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  });
}

export async function createRateChangeRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createRateChangeRequest payload');
  const payload: RateChangePayload = {
    rate: normalizeRateSnapshot(raw.rate),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
  };
  return createKnownLoanChangeRequest(ctx, {
    loanId: normalizeLoanId(raw.loanId),
    type: LedgerRequestType.RATE_CHANGE,
    payload,
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  });
}
