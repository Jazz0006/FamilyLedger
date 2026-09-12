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
  createPrincipalAddRequest,
  createRateChangeRequest,
} from './loanChangeRequests.js';
import {
  acceptRequest,
  cancelRequest,
  rejectRequest,
} from './repaymentActions.js';
import { getLoan, listLoanEvents } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T05:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function createLoan(repo: MemoryRepo, principalFen = 100_000) {
  await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: principalFen,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-09-12',
    idempotencyKey: `r8-create-${principalFen}`,
  });
  const rawToken = 'H'.repeat(43);
  await createLoanInvite(ctx(repo, 'alice'), { requestId: request._id, rawToken });
  const accepted = await acceptInviteRequest(ctx(repo, 'bob', NOW + 1), {
    rawToken,
    displayName: 'Bob',
  });
  const applied = await verifyFirstCounterparty(ctx(repo, 'alice', NOW + 2), {
    requestId: request._id,
  });
  return { loan: applied.loan, bob: accepted.claimant };
}

describe('R8 PRINCIPAL_ADD and RATE_CHANGE workflows', () => {
  it('lets either participant propose principal additions with idempotent semantics', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);

    const lenderRequest = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 20_000,
      proposedEffectiveDate: '2026-09-12',
      note: 'extra advance',
      idempotencyKey: 'add-lender',
    });
    const retry = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 20_000,
      proposedEffectiveDate: '2026-09-12',
      note: 'extra advance',
      idempotencyKey: 'add-lender',
    });
    expect(retry._id).toBe(lenderRequest._id);
    expect(lenderRequest.counterpartyUserId).toBe(loan.borrowerUserId);

    const borrowerRequest = await createPrincipalAddRequest(ctx(repo, 'bob'), {
      loanId: loan._id,
      amountFen: 10_000,
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'add-borrower',
    });
    expect(borrowerRequest.counterpartyUserId).toBe(loan.lenderUserId);

    await expect(
      createPrincipalAddRequest(ctx(repo, 'alice'), {
        loanId: loan._id,
        amountFen: 20_001,
        proposedEffectiveDate: '2026-09-12',
        note: 'extra advance',
        idempotencyKey: 'add-lender',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('applies principal addition once and both parties see the same new principal', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const request = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 25_000,
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'add-confirmed',
    });

    const first = await acceptRequest(ctx(repo, 'bob', NOW + 10), {
      requestId: request._id,
    });
    const retry = await acceptRequest(ctx(repo, 'bob', NOW + 11), {
      requestId: request._id,
    });
    expect(first.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect(first.event.eventType).toBe(LoanEventType.PRINCIPAL_ADD);
    expect(first.event.amountFen).toBe(25_000);
    expect(retry.event._id).toBe(first.event._id);

    const lenderView = await getLoan(ctx(repo, 'alice'), { loanId: loan._id });
    const borrowerView = await getLoan(ctx(repo, 'bob'), { loanId: loan._id });
    expect(lenderView.summary.principalFen).toBe(125_000);
    expect(borrowerView.summary.principalFen).toBe(125_000);
    expect(lenderView.summary).toEqual(borrowerView.summary);
  });

  it('applies a rate change and preserves the agreed RateSnapshot metadata', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const request = await createRateChangeRequest(ctx(repo, 'bob'), {
      loanId: loan._id,
      rate: {
        annualEffectiveRate: '0.10',
        rateSource: RateSource.MANUAL,
        rateReferenceLabel: 'agreed ten percent',
      },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'rate-confirmed',
    });

    const applied = await acceptRequest(ctx(repo, 'alice', NOW + 10), {
      requestId: request._id,
    });
    expect(applied.event.eventType).toBe(LoanEventType.RATE_CHANGE);
    expect(applied.event.rate?.annualEffectiveRate).toBe('0.10');
    expect(applied.event.rate?.rateReferenceLabel).toBe('agreed ten percent');

    const oneYearLater = Date.parse('2027-09-12T05:00:00.000Z');
    const view = await getLoan(ctx(repo, 'alice', oneYearLater), {
      loanId: loan._id,
    });
    expect(view.summary.currentRate.annualEffectiveRate).toBe('0.10');
    expect(view.summary.currentRate.rateReferenceLabel).toBe('agreed ten percent');
    expect(view.summary.totalFen).toBe(110_000);
  });

  it('uses later event sequence when multiple confirmed rates share one effective date', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const first = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.05', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'rate-same-day-1',
    });
    await acceptRequest(ctx(repo, 'bob', NOW + 10), { requestId: first._id });

    const second = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.10', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'rate-same-day-2',
    });
    await acceptRequest(ctx(repo, 'bob', NOW + 11), { requestId: second._id });

    const oneYearLater = Date.parse('2027-09-12T05:00:00.000Z');
    const view = await getLoan(ctx(repo, 'alice', oneYearLater), {
      loanId: loan._id,
    });
    expect(view.summary.currentRate.annualEffectiveRate).toBe('0.10');
    expect(view.summary.totalFen).toBe(110_000);

    const history = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    const rateEvents = history.items.filter(
      (event) => event.eventType === LoanEventType.RATE_CHANGE,
    );
    expect(rateEvents.map((event) => event.rate?.annualEffectiveRate)).toEqual([
      '0',
      '0.05',
      '0.10',
    ]);
    expect(rateEvents[2]!.sequence).toBeGreaterThan(rateEvents[1]!.sequence);
  });

  it('rejects or cancels R8 requests without appending formal events', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);

    const add = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 12_000,
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'add-cancel',
    });
    expect(
      (await cancelRequest(ctx(repo, 'alice'), { requestId: add._id })).status,
    ).toBe(LedgerRequestStatus.CANCELLED);

    const rate = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.08', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'rate-reject',
    });
    expect(
      (await rejectRequest(ctx(repo, 'bob'), { requestId: rate._id })).status,
    ).toBe(LedgerRequestStatus.REJECTED);

    const history = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    expect(
      history.items.filter(
        (event) =>
          event.sourceRequestId === add._id || event.sourceRequestId === rate._id,
      ),
    ).toHaveLength(0);
  });

  it('serializes concurrent principal additions with distinct event sequences', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const a = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 20_000,
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'add-concurrent-a',
    });
    const b = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 30_000,
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'add-concurrent-b',
    });

    const [resultA, resultB] = await Promise.all([
      acceptRequest(ctx(repo, 'bob', NOW + 20), { requestId: a._id }),
      acceptRequest(ctx(repo, 'bob', NOW + 20), { requestId: b._id }),
    ]);
    expect(resultA.event.sequence).not.toBe(resultB.event.sequence);
    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      150_000,
    );
  });

  it('keeps counterparty-only confirmation for new R8 request types', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    await ensureUser(ctx(repo, 'mallory'), { displayName: 'Mallory' });
    const request = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.04', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'rate-auth',
    });

    await expect(
      acceptRequest(ctx(repo, 'alice'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      acceptRequest(ctx(repo, 'mallory'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});
