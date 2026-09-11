import {
  LOAN_EVENT_SCHEMA_VERSION,
  LoanAccountStatus,
  LoanEventType,
  type Fen,
} from '@family-ledger/shared';
import { isoDateInTimezone } from '@family-ledger/calc';
import { AppError, ErrorCode } from '../errors.js';
import { requireAdmin, type ActionContext } from './action-context.js';

export interface RecordLodgmentInput {
  loanId: string;
  amountFen: Fen;
  /** Client-generated UUID for idempotency (spec §15). Required. */
  idempotencyKey: string;
}

export interface RecordLodgmentResult {
  loanEventId: string;
  /** false when a retry hit the existing event (idempotent replay). */
  created: boolean;
  effectiveDate: string;
}

/**
 * Admin records a new lodgment (PRINCIPAL_ADD). Increases 曾骏's debt, so per
 * Rule B (v1.1) it is admin-only and applies immediately — no lender
 * confirmation, no change_request. Effective date is today in the ledger
 * timezone (Rule F). Idempotent on idempotencyKey (spec §15).
 */
export async function recordLodgment(
  ctx: ActionContext,
  input: RecordLodgmentInput,
): Promise<RecordLodgmentResult> {
  const admin = await requireAdmin(ctx);

  validateAmount(input.amountFen);
  validateKey(input.idempotencyKey);

  const account = await ctx.repo.getLoanAccount(input.loanId);
  if (!account) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Loan account not found');
  }
  // The loan must belong to the admin's family and be active.
  if (account.familyId !== admin.familyId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Loan is outside your family');
  }
  if (account.status !== LoanAccountStatus.ACTIVE) {
    throw new AppError(ErrorCode.CONFLICT, 'Loan account is not active');
  }

  const effectiveDate = isoDateInTimezone(ctx.now, ctx.timeZone);

  const { event, created } = await ctx.repo.appendEventIdempotent({
    loanId: input.loanId,
    eventType: LoanEventType.PRINCIPAL_ADD,
    amountFen: input.amountFen,
    effectiveDate,
    sourceRequestId: null,
    createdBy: admin._id,
    confirmedBy: admin._id, // self-confirmed: admin-only op
    createdAt: ctx.now,
    idempotencyKey: input.idempotencyKey,
    schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
  });

  await ctx.repo.appendAudit({
    actorOpenId: ctx.openid,
    actorUserId: admin._id,
    action: 'recordLodgment',
    targetId: event._id,
    requestId: input.idempotencyKey,
    result: 'OK',
    detail: `PRINCIPAL_ADD ${input.amountFen}分 on ${effectiveDate}${
      created ? '' : ' (idempotent replay)'
    }`,
    serverTime: ctx.now,
  });

  return { loanEventId: event._id, created, effectiveDate };
}

function validateAmount(amountFen: unknown): asserts amountFen is number {
  if (
    typeof amountFen !== 'number' ||
    !Number.isInteger(amountFen) ||
    amountFen <= 0
  ) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      'amountFen must be a positive integer (分)',
    );
  }
}

function validateKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length < 8) {
    throw new AppError(
      ErrorCode.INVALID_ARGUMENT,
      'idempotencyKey is required',
    );
  }
}
