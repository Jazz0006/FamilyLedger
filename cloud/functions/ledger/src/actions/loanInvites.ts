import {
  INVITE_TTL_MS,
  InviteStatus,
  LedgerRequestStatus,
  LedgerRequestType,
  type CreateLoanPayload,
  type InviteToken,
  type LedgerRequest,
  type RateSnapshot,
  type User,
  type UserDisplayProfile,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { hashToken } from '../crypto.js';
import { assertCreateLoanRequestStructure } from '../domain/validation.js';
import { assertLedgerRequestTransition } from '../domain/request-state.js';
import type { ActionContext } from './action-context.js';
import { requireCurrentUser } from './action-context.js';
import { bindFirstContactCounterparty } from './create-loan-common.js';
import { requireUserDisplayProfile } from './user-display.js';

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface CreateLoanInviteResult {
  invite: InviteToken;
  rawToken: string;
  created: boolean;
}

export interface InvitePreview {
  requestId: string;
  proposerUserId: string;
  proposer: UserDisplayProfile;
  unknownPartyRole: 'BORROWER' | 'LENDER';
  initialPrincipalFen: number;
  rate: RateSnapshot;
  proposedEffectiveDate: string;
  note: string | null;
  expiresAt: number;
}

export interface AcceptInviteResult {
  request: LedgerRequest;
  claimant: User;
}

function objectInput(input: unknown, label: string): Record<string, unknown> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `${label} payload must be an object`);
  }
  return input as Record<string, unknown>;
}

function normalizeRawToken(value: unknown): string {
  if (typeof value !== 'string' || !RAW_TOKEN.test(value)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'rawToken must be a 32-byte base64url token',
    );
  }
  return value;
}

function normalizeRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'requestId must be a non-empty string');
  }
  return value.trim();
}

function assertActiveInvite(invite: InviteToken, now: number): void {
  if (invite.status === InviteStatus.EXPIRED || invite.expiresAt <= now) {
    throw new AppError(ErrorCode.INVITE_EXPIRED, 'Invite has expired');
  }
  if (invite.status !== InviteStatus.ACTIVE) {
    throw new AppError(ErrorCode.INVITE_INVALID, 'Invite is no longer active');
  }
}

function assertPendingFirstContactRequest(request: LedgerRequest): void {
  if (
    request.type !== LedgerRequestType.CREATE_LOAN ||
    !request.requiresInitiatorVerify ||
    request.status !== LedgerRequestStatus.PENDING
  ) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'CREATE_LOAN request is not awaiting first-contact invite acceptance',
    );
  }
  if (request.counterpartyUserId !== null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request already has a counterparty');
  }
  assertCreateLoanRequestStructure(request);
}

export async function createLoanInvite(
  ctx: ActionContext,
  input: unknown,
): Promise<CreateLoanInviteResult> {
  const raw = objectInput(input, 'createLoanInvite');
  const requestId = normalizeRequestId(raw.requestId);
  const rawToken = normalizeRawToken(raw.rawToken);
  const actor = await requireCurrentUser(ctx);

  const request = await ctx.repo.getRequest(requestId);
  if (!request) throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
  if (request.proposerUserId !== actor._id) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the proposer may create the invite');
  }
  assertPendingFirstContactRequest(request);

  const tokenHash = hashToken(rawToken);
  const existing = await ctx.repo.getInviteByHash(tokenHash);
  if (existing) {
    if (
      existing.requestId !== requestId ||
      existing.createdByUserId !== actor._id
    ) {
      throw new AppError(ErrorCode.CONFLICT, 'Invite token is already in use');
    }
    return { invite: existing, rawToken, created: false };
  }

  const inviteData = {
    requestId,
    tokenHash,
    status: InviteStatus.ACTIVE,
    createdByUserId: actor._id,
    claimedByUserId: null,
    createdAt: ctx.now,
    claimedAt: null,
    expiresAt: ctx.now + INVITE_TTL_MS,
    revokedAt: null,
  } as const;

  try {
    const invite = await ctx.repo.createInvite(inviteData);
    return { invite, rawToken, created: true };
  } catch (error) {
    const raced = await ctx.repo.getInviteByHash(tokenHash);
    if (
      raced &&
      raced.requestId === requestId &&
      raced.createdByUserId === actor._id
    ) {
      return { invite: raced, rawToken, created: false };
    }
    throw error;
  }
}

export async function previewInvite(
  ctx: ActionContext,
  input: unknown,
): Promise<InvitePreview> {
  const raw = objectInput(input, 'previewInvite');
  const rawToken = normalizeRawToken(raw.rawToken);
  const invite = await ctx.repo.getInviteByHash(hashToken(rawToken));
  if (!invite) throw new AppError(ErrorCode.INVITE_INVALID, 'Invite not found');
  assertActiveInvite(invite, ctx.now);

  const request = await ctx.repo.getRequest(invite.requestId);
  if (!request) throw new AppError(ErrorCode.INVITE_INVALID, 'Invite request not found');
  assertPendingFirstContactRequest(request);
  if (request.proposerUserId !== invite.createdByUserId) {
    throw new AppError(ErrorCode.INVITE_INVALID, 'Invite proposer mismatch');
  }

  const payload = request.payload as CreateLoanPayload;
  return {
    requestId: request._id,
    proposerUserId: request.proposerUserId,
    proposer: await requireUserDisplayProfile(ctx.repo, request.proposerUserId),
    unknownPartyRole: payload.unknownPartyRole as 'BORROWER' | 'LENDER',
    initialPrincipalFen: payload.initialPrincipalFen,
    rate: payload.rate,
    proposedEffectiveDate: payload.proposedEffectiveDate,
    note: payload.note ?? null,
    expiresAt: invite.expiresAt,
  };
}

export async function acceptInviteRequest(
  ctx: ActionContext,
  input: unknown,
): Promise<AcceptInviteResult> {
  const raw = objectInput(input, 'acceptInviteRequest');
  const rawToken = normalizeRawToken(raw.rawToken);
  const tokenHash = hashToken(rawToken);

  const candidate = await ctx.repo.getInviteByHash(tokenHash);
  if (!candidate) throw new AppError(ErrorCode.INVITE_INVALID, 'Invite not found');
  if (candidate.expiresAt <= ctx.now || candidate.status === InviteStatus.EXPIRED) {
    throw new AppError(ErrorCode.INVITE_EXPIRED, 'Invite has expired');
  }

  const claimant = await ensureUser(ctx, {
    displayName: raw.displayName,
    avatarUrl: raw.avatarUrl,
  });

  const request = await ctx.repo.runTransaction(async (tx) => {
    const invite = await tx.getInvite(candidate._id);
    if (!invite || invite.tokenHash !== tokenHash) {
      throw new AppError(ErrorCode.INVITE_INVALID, 'Invite changed or disappeared');
    }

    const current = await tx.getRequest(invite.requestId);
    if (!current) throw new AppError(ErrorCode.INVITE_INVALID, 'Invite request not found');

    if (invite.status === InviteStatus.CLAIMED) {
      if (
        invite.claimedByUserId === claimant._id &&
        current.counterpartyUserId === claimant._id &&
        (current.status === LedgerRequestStatus.PENDING_INITIATOR_VERIFY ||
          current.status === LedgerRequestStatus.APPLIED)
      ) {
        return current;
      }
      throw new AppError(ErrorCode.INVITE_INVALID, 'Invite was already claimed');
    }

    assertActiveInvite(invite, ctx.now);
    assertPendingFirstContactRequest(current);
    if (current.proposerUserId !== invite.createdByUserId) {
      throw new AppError(ErrorCode.INVITE_INVALID, 'Invite proposer mismatch');
    }
    if (claimant._id === current.proposerUserId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Proposer cannot claim their own invite');
    }

    assertLedgerRequestTransition(
      current,
      LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
    );
    const bound = bindFirstContactCounterparty(current, claimant._id, ctx.now);
    bound.status = LedgerRequestStatus.PENDING_INITIATOR_VERIFY;
    await tx.putRequest(bound);

    await tx.putInvite({
      ...invite,
      status: InviteStatus.CLAIMED,
      claimedByUserId: claimant._id,
      claimedAt: ctx.now,
    });
    return bound;
  });

  return { request, claimant };
}
