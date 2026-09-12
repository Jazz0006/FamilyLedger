import { describe, expect, it } from 'vitest';
import { LedgerRequestStatus, RateSource } from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import { ensureUser } from './ensureUser.js';
import { createLoanRequest } from './createLoanRequest.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';

const TOKEN = 'Z'.repeat(43);
const NOW = 1_789_100_000_000;

describe('R5 invite credential idempotency', () => {
  it('reuses the same token and claimant without duplicating state', async () => {
    const repo = new MemoryRepo();
    const proposerCtx = { repo, openid: 'openid-proposer', now: NOW };
    await ensureUser(proposerCtx, { displayName: 'Proposer' });

    const request = await createLoanRequest(proposerCtx, {
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 50_000,
      rate: {
        annualEffectiveRate: '0.025',
        rateSource: RateSource.MANUAL,
      },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'invite-idempotency-request',
    });

    const firstInvite = await createLoanInvite(proposerCtx, {
      requestId: request._id,
      rawToken: TOKEN,
    });
    const retryInvite = await createLoanInvite(proposerCtx, {
      requestId: request._id,
      rawToken: TOKEN,
    });

    expect(firstInvite.created).toBe(true);
    expect(retryInvite.created).toBe(false);
    expect(retryInvite.invite._id).toBe(firstInvite.invite._id);

    const claimantCtx = { repo, openid: 'openid-claimant', now: NOW + 10 };
    const firstClaim = await acceptInviteRequest(claimantCtx, {
      rawToken: TOKEN,
      displayName: 'Claimant',
    });
    const retryClaim = await acceptInviteRequest(
      { ...claimantCtx, now: NOW + 20 },
      { rawToken: TOKEN },
    );

    expect(retryClaim.request._id).toBe(firstClaim.request._id);
    expect(retryClaim.claimant._id).toBe(firstClaim.claimant._id);
    expect(retryClaim.request.status).toBe(
      LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
    );

    await expect(
      acceptInviteRequest(
        { repo, openid: 'openid-other', now: NOW + 30 },
        { rawToken: TOKEN, displayName: 'Other' },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVITE_INVALID });
  });
});
