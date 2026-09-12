import { describe, expect, it } from 'vitest';
import { RateSource } from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import { acceptRequest, createRepaymentRequest } from './repaymentActions.js';
import { getLoan } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-04-01T05:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string): ActionContext {
  return { repo, openid, now: NOW };
}

describe('repayment full-timeline invariant', () => {
  it('rejects a backdated repayment that would make a later interval negative', async () => {
    const repo = new MemoryRepo();
    await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
    const create = await createLoanRequest(ctx(repo, 'alice'), {
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 100_000,
      rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-01-01',
      idempotencyKey: 'repay-timeline-create',
    });
    const rawToken = 'Q'.repeat(43);
    await createLoanInvite(ctx(repo, 'alice'), { requestId: create._id, rawToken });
    await acceptInviteRequest(ctx(repo, 'bob'), { rawToken, displayName: 'Bob' });
    const { loan } = await verifyFirstCounterparty(ctx(repo, 'alice'), {
      requestId: create._id,
    });

    const later = await createRepaymentRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 80_000,
      proposedEffectiveDate: '2026-03-01',
      idempotencyKey: 'repay-later-80',
    });
    await acceptRequest(ctx(repo, 'bob'), { requestId: later._id });

    const backdated = await createRepaymentRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 50_000,
      proposedEffectiveDate: '2026-02-01',
      idempotencyKey: 'repay-backdated-50',
    });
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: backdated._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      20_000,
    );
  });
});
