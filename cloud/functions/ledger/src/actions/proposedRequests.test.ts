import { describe, expect, it } from 'vitest';
import { LedgerRequestStatus, RateSource } from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import type { ActionContext } from './action-context.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import {
  acceptInviteRequest,
  createLoanInvite,
} from './loanInvites.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';
import {
  cancelRequest,
  createRepaymentRequest,
} from './repaymentActions.js';
import { listProposedRequests } from './readActions.js';

const NOW = Date.parse('2026-09-12T09:30:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function establishLoan(repo: MemoryRepo) {
  await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: 100_000,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-09-12',
    idempotencyKey: 'proposed-list-first-contact',
  });
  const rawToken = 'P'.repeat(43);
  await createLoanInvite(ctx(repo, 'alice'), {
    requestId: request._id,
    rawToken,
  });
  await acceptInviteRequest(ctx(repo, 'bob', NOW + 1), {
    rawToken,
    displayName: 'Bob',
  });
  const applied = await verifyFirstCounterparty(ctx(repo, 'alice', NOW + 2), {
    requestId: request._id,
  });
  return applied.loan;
}

describe('R12C proposer pending requests', () => {
  it('lists a first-contact proposal before the invite is claimed', async () => {
    const repo = new MemoryRepo();
    await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
    const request = await createLoanRequest(ctx(repo, 'alice'), {
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 25_000,
      rate: { annualEffectiveRate: '0.02', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'unclaimed-first-contact',
    });

    const page = await listProposedRequests(ctx(repo, 'alice'), { limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.request._id).toBe(request._id);
    expect(page.items[0]?.request.status).toBe(LedgerRequestStatus.PENDING);
    expect(page.items[0]?.otherParty).toBeNull();
  });

  it('shows a known-counterparty proposal to its proposer and removes it after cancellation', async () => {
    const repo = new MemoryRepo();
    const loan = await establishLoan(repo);
    const request = await createRepaymentRequest(ctx(repo, 'alice', NOW + 10), {
      loanId: loan._id,
      amountFen: 10_000,
      proposedEffectiveDate: '2026-09-12',
      note: 'partial repayment',
      idempotencyKey: 'proposer-pending-repay',
    });

    const before = await listProposedRequests(ctx(repo, 'alice'), { limit: 10 });
    expect(before.items).toHaveLength(1);
    expect(before.items[0]?.request._id).toBe(request._id);
    expect(before.items[0]?.otherParty?.displayName).toBe('Bob');

    await cancelRequest(ctx(repo, 'alice', NOW + 11), { requestId: request._id });
    const after = await listProposedRequests(ctx(repo, 'alice'), { limit: 10 });
    expect(after.items).toHaveLength(0);
  });
});
