import {
  LedgerRequestStatus,
  LedgerRequestType,
  type CreateLoanPayload,
  type LedgerRequest,
} from '@family-ledger/shared';
import { computeRequestFingerprint } from '../domain/request-fingerprint.js';
import type { NewLedgerRequest } from '../data/repo.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import { normalizeFirstContactCreateLoanInput } from './create-loan-common.js';

/** Create an idempotent first-contact CREATE_LOAN proposal. */
export async function createLoanRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const actor = await requireCurrentUser(ctx);
  const normalized = normalizeFirstContactCreateLoanInput(input);

  const payload: CreateLoanPayload = {
    borrowerUserId:
      normalized.unknownPartyRole === 'BORROWER' ? null : actor._id,
    lenderUserId:
      normalized.unknownPartyRole === 'LENDER' ? null : actor._id,
    unknownPartyRole: normalized.unknownPartyRole,
    initialPrincipalFen: normalized.initialPrincipalFen,
    rate: normalized.rate,
    proposedEffectiveDate: normalized.proposedEffectiveDate,
    note: normalized.note,
  };

  const fingerprint = computeRequestFingerprint({
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId: null,
    payload,
    requiresInitiatorVerify: true,
  });

  const request: NewLedgerRequest = {
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId: null,
    payload,
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: true,
    idempotencyKey: normalized.idempotencyKey,
    requestFingerprint: fingerprint,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    expiresAt: null,
  };

  const result = await ctx.repo.createRequestIdempotent(request);
  return result.item;
}
