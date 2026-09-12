import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { cancelRequest } from './repaymentActions.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import { getHomeSummary } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T07:30:00.000Z');
const TOKEN = 'C'.repeat(43);

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

describe('first-contact cancellation', () => {
  it('lets the proposer cancel after invite claim and prevents later verification', async () => {
    const repo = new MemoryRepo();
    await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });

    const request = await createLoanRequest(ctx(repo, 'alice'), {
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 50_000,
      rate: {
        annualEffectiveRate: '0.03',
        rateSource: RateSource.MANUAL,
      },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'first-contact-cancel',
    });
    await createLoanInvite(ctx(repo, 'alice'), {
      requestId: request._id,
      rawToken: TOKEN,
    });
    await acceptInviteRequest(ctx(repo, 'bob', NOW + 1), {
      rawToken: TOKEN,
      displayName: 'Bob',
    });

    expect((await getHomeSummary(ctx(repo, 'alice'))).pendingRequestCount).toBe(1);

    await expect(
      cancelRequest(ctx(repo, 'bob'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const cancelled = await cancelRequest(ctx(repo, 'alice', NOW + 2), {
      requestId: request._id,
    });
    expect(cancelled.status).toBe(LedgerRequestStatus.CANCELLED);
    expect(cancelled.loanId).toBeNull();
    expect((await getHomeSummary(ctx(repo, 'alice'))).pendingRequestCount).toBe(0);

    await expect(
      verifyFirstCounterparty(ctx(repo, 'alice', NOW + 3), {
        requestId: request._id,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE });
  });
});
