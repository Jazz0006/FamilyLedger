import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LoanEventType,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import {
  acceptRequest,
  cancelRequest,
  createRepaymentRequest,
  rejectRequest,
} from './repaymentActions.js';
import { getLoan, listLoanEvents } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T05:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function createLoan(repo: MemoryRepo, principalFen = 100_000) {
  const alice = await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: principalFen,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-09-12',
    idempotencyKey: `create-${principalFen}`,
  });
  const rawToken = 'R'.repeat(43);
  await createLoanInvite(ctx(repo, 'alice'), { requestId: request._id, rawToken });
  const accepted = await acceptInviteRequest(ctx(repo, 'bob', NOW + 1), {
    rawToken,
    displayName: 'Bob',
  });
  const applied = await verifyFirstCounterparty(ctx(repo, 'alice', NOW + 2), {
    requestId: request._id,
  });
  return { alice, bob: accepted.claimant, loan: applied.loan };
}

function repaymentInput(loanId: string, amountFen: number, key: string) {
  return {
    loanId,
    amountFen,
    proposedEffectiveDate: '2026-09-12',
    note: 'repayment',
    idempotencyKey: key,
  };
}

describe('R7 PRINCIPAL_REPAY workflow', () => {
  it('creates an idempotent repayment proposal from either Loan participant', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);

    const first = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 25_000, 'repay-a'),
    );
    const retry = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 25_000, 'repay-a'),
    );
    expect(retry._id).toBe(first._id);
    expect(first.proposerUserId).toBe(loan.lenderUserId);
    expect(first.counterpartyUserId).toBe(loan.borrowerUserId);

    const reverse = await createRepaymentRequest(
      ctx(repo, 'bob'),
      repaymentInput(loan._id, 10_000, 'repay-b'),
    );
    expect(reverse.proposerUserId).toBe(loan.borrowerUserId);
    expect(reverse.counterpartyUserId).toBe(loan.lenderUserId);

    await expect(
      createRepaymentRequest(
        ctx(repo, 'alice'),
        repaymentInput(loan._id, 25_001, 'repay-a'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('applies one confirmed repayment and retry returns the same formal event', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const request = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 30_000, 'repay-confirmed'),
    );

    const first = await acceptRequest(ctx(repo, 'bob', NOW + 10), {
      requestId: request._id,
    });
    const retry = await acceptRequest(ctx(repo, 'bob', NOW + 11), {
      requestId: request._id,
    });

    expect(first.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect(first.event.eventType).toBe(LoanEventType.PRINCIPAL_REPAY);
    expect(first.event.amountFen).toBe(30_000);
    expect(first.event.confirmedBy).toBe(loan.borrowerUserId);
    expect(retry.event._id).toBe(first.event._id);

    const view = await getLoan(ctx(repo, 'alice'), { loanId: loan._id });
    expect(view.summary.principalFen).toBe(70_000);
    const events = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    expect(events.items.filter((event) => event.eventType === LoanEventType.PRINCIPAL_REPAY)).toHaveLength(1);
  });

  it('rejects and cancels idempotently without creating formal events', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);

    const toReject = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 5_000, 'repay-reject'),
    );
    const rejected = await rejectRequest(ctx(repo, 'bob'), {
      requestId: toReject._id,
    });
    const rejectRetry = await rejectRequest(ctx(repo, 'bob'), {
      requestId: toReject._id,
    });
    expect(rejected.status).toBe(LedgerRequestStatus.REJECTED);
    expect(rejectRetry.status).toBe(LedgerRequestStatus.REJECTED);

    const toCancel = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 6_000, 'repay-cancel'),
    );
    const cancelled = await cancelRequest(ctx(repo, 'alice'), {
      requestId: toCancel._id,
    });
    const cancelRetry = await cancelRequest(ctx(repo, 'alice'), {
      requestId: toCancel._id,
    });
    expect(cancelled.status).toBe(LedgerRequestStatus.CANCELLED);
    expect(cancelRetry.status).toBe(LedgerRequestStatus.CANCELLED);

    const events = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    expect(events.items.filter((event) => event.eventType === LoanEventType.PRINCIPAL_REPAY)).toHaveLength(0);
  });

  it('does not let proposer self-confirm or an unrelated User respond', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    await ensureUser(ctx(repo, 'mallory'), { displayName: 'Mallory' });
    const request = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 5_000, 'repay-auth'),
    );

    await expect(
      acceptRequest(ctx(repo, 'alice'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      rejectRequest(ctx(repo, 'mallory'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      cancelRequest(ctx(repo, 'bob'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('serializes concurrent stale repayments so principal cannot go negative', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo, 100_000);
    const requestA = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 70_000, 'repay-concurrent-a'),
    );
    const requestB = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 70_000, 'repay-concurrent-b'),
    );

    const results = await Promise.allSettled([
      acceptRequest(ctx(repo, 'bob', NOW + 20), { requestId: requestA._id }),
      acceptRequest(ctx(repo, 'bob', NOW + 20), { requestId: requestB._id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toMatchObject({ code: ErrorCode.CONFLICT });
    }

    const view = await getLoan(ctx(repo, 'alice'), { loanId: loan._id });
    expect(view.summary.principalFen).toBe(30_000);
    const events = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    expect(events.items.filter((event) => event.eventType === LoanEventType.PRINCIPAL_REPAY)).toHaveLength(1);
  });

  it('rechecks principal at acceptance rather than trusting proposal-time balance', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo, 100_000);
    const stale = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 80_000, 'repay-stale'),
    );
    const earlier = await createRepaymentRequest(
      ctx(repo, 'alice'),
      repaymentInput(loan._id, 30_000, 'repay-earlier'),
    );
    await acceptRequest(ctx(repo, 'bob', NOW + 30), { requestId: earlier._id });

    await expect(
      acceptRequest(ctx(repo, 'bob', NOW + 31), { requestId: stale._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(70_000);
  });
});
