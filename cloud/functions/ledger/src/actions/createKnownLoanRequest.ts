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
import {
  normalizeIdempotencyKey,
  normalizeNote,
  normalizePositiveFen,
  requireObject,
  validation,
} from './known-change-common.js';
import { assertIsoDate, normalizeRateSnapshot } from './create-loan-common.js';
import { assertKnownCounterparty } from './knownCounterparties.js';

function normalizeCounterpartyUserId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    validation('counterpartyUserId must be a non-empty string');
  }
  return value.trim();
}

export async function createKnownLoanRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<LedgerRequest> {
  const raw = requireObject(input, 'createKnownLoanRequest payload');
  if (raw.counterpartyRole !== 'BORROWER' && raw.counterpartyRole !== 'LENDER') {
    validation('counterpartyRole must be BORROWER or LENDER');
  }

  const actor = await requireCurrentUser(ctx);
  const counterpartyUserId = normalizeCounterpartyUserId(raw.counterpartyUserId);
  await assertKnownCounterparty(ctx.repo, actor._id, counterpartyUserId);

  const payload: CreateLoanPayload = {
    borrowerUserId:
      raw.counterpartyRole === 'BORROWER' ? counterpartyUserId : actor._id,
    lenderUserId:
      raw.counterpartyRole === 'LENDER' ? counterpartyUserId : actor._id,
    unknownPartyRole: null,
    initialPrincipalFen: normalizePositiveFen(
      raw.initialPrincipalFen,
      'initialPrincipalFen',
    ),
    rate: normalizeRateSnapshot(raw.rate),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note: normalizeNote(raw.note),
  };
  const idempotencyKey = normalizeIdempotencyKey(raw.idempotencyKey);
  const requestFingerprint = computeRequestFingerprint({
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    requiresInitiatorVerify: false,
  });

  const request: NewLedgerRequest = {
    type: LedgerRequestType.CREATE_LOAN,
    loanId: null,
    proposerUserId: actor._id,
    counterpartyUserId,
    payload,
    status: LedgerRequestStatus.PENDING,
    requiresInitiatorVerify: false,
    idempotencyKey,
    requestFingerprint,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
    expiresAt: null,
  };
  return (await ctx.repo.createRequestIdempotent(request)).item;
}
