import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LoanEventType,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createKnownLoanRequest } from './createKnownLoanRequest.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import {
  acceptInviteRequest,
  createLoanInvite,
  previewInvite,
} from './loanInvites.js';
import { listKnownCounterparties } from './knownCounterparties.js';
import {
  acceptRequest,
  cancelRequest,
  rejectRequest,
} from './repaymentActions.js';
import {
  getLoan,
  listLoanEvents,
  listPendingRequests,
} from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T06:45:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function establishAliceBob(repo: MemoryRepo) {
  await ensureUser(ctx(repo, 'alice-openid'), {
    displayName: 'Alice',
    avatarUrl: 'alice.png',
  });
  const request = await createLoanRequest(ctx(repo, 'alice-openid'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: 100_000,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-09-12',
    idempotencyKey: 'r12-first-contact',
  });
  const rawToken = 'R'.repeat(43);
  await createLoanInvite(ctx(repo, 'alice-openid'), {
    requestId: request._id,
    rawToken,
  });
  const preview = await previewInvite(ctx(repo, 'someone-not-yet-bound'), {
    rawToken,
  });
  const accepted = await acceptInviteRequest(ctx(repo, 'bob-openid', NOW + 1), {
    rawToken,
    displayName: 'Bob',
    avatarUrl: 'bob.png',
  });
  const verified = await verifyFirstCounterparty(
    ctx(repo, 'alice-openid', NOW + 2),
    { requestId: request._id },
  );
  return { preview, bob: accepted.claimant, firstLoan: verified.loan };
}

function expectNoOpenid(value: unknown) {
  expect(JSON.stringify(value)).not.toContain('openid');
}

describe('R12A UI-facing contract', () => {
  it('returns safe human-readable profiles for invite, loan and pending request reads', async () => {
    const repo = new MemoryRepo();
    const { preview, bob, firstLoan } = await establishAliceBob(repo);

    expect(preview.proposer).toMatchObject({
      displayName: 'Alice',
      avatarUrl: 'alice.png',
    });
    expectNoOpenid(preview.proposer);

    const bobView = await getLoan(ctx(repo, 'bob-openid'), {
      loanId: firstLoan._id,
    });
    expect(bobView.counterparty).toMatchObject({ displayName: 'Alice' });
    expectNoOpenid(bobView.counterparty);

    const request = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'BORROWER',
      initialPrincipalFen: 50_000,
      rate: { annualEffectiveRate: '0.03', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'r12-known-profile',
    });
    const pending = await listPendingRequests(ctx(repo, 'bob-openid'), {});
    const item = pending.items.find((entry) => entry.request._id === request._id)!;
    expect(item.otherParty).toMatchObject({ displayName: 'Alice' });
    expectNoOpenid(item.otherParty);
  });

  it('discovers only established counterparties and never exposes OPENID', async () => {
    const repo = new MemoryRepo();
    const { bob } = await establishAliceBob(repo);
    await ensureUser(ctx(repo, 'mallory-openid'), { displayName: 'Mallory' });

    const known = await listKnownCounterparties(ctx(repo, 'alice-openid'), {});
    expect(known.items).toHaveLength(1);
    expect(known.items[0]!.user.userId).toBe(bob._id);
    expect(known.items[0]!.user.displayName).toBe('Bob');
    expectNoOpenid(known);
  });

  it('blocks an arbitrary existing User from the known-counterparty create path', async () => {
    const repo = new MemoryRepo();
    await establishAliceBob(repo);
    const mallory = await ensureUser(ctx(repo, 'mallory-openid'), {
      displayName: 'Mallory',
    });

    await expect(
      createKnownLoanRequest(ctx(repo, 'alice-openid'), {
        counterpartyUserId: mallory._id,
        counterpartyRole: 'BORROWER',
        initialPrincipalFen: 50_000,
        rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
        proposedEffectiveDate: '2026-09-12',
        idempotencyKey: 'r12-unrelated',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('creates a second Loan for a known counterparty without an invite', async () => {
    const repo = new MemoryRepo();
    const { bob } = await establishAliceBob(repo);

    const request = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'BORROWER',
      initialPrincipalFen: 75_000,
      rate: {
        annualEffectiveRate: '0.04',
        rateSource: RateSource.MANUAL,
        rateReferenceLabel: 'known relationship rate',
      },
      proposedEffectiveDate: '2026-09-12',
      note: 'second loan',
      idempotencyKey: 'r12-known-create',
    });
    expect(request.requiresInitiatorVerify).toBe(false);
    expect(request.counterpartyUserId).toBe(bob._id);
    expect(request.loanId).toBeNull();

    const retry = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'BORROWER',
      initialPrincipalFen: 75_000,
      rate: {
        annualEffectiveRate: '0.04',
        rateSource: RateSource.MANUAL,
        rateReferenceLabel: 'known relationship rate',
      },
      proposedEffectiveDate: '2026-09-12',
      note: 'second loan',
      idempotencyKey: 'r12-known-create',
    });
    expect(retry._id).toBe(request._id);

    const result = await acceptRequest(ctx(repo, 'bob-openid', NOW + 10), {
      requestId: request._id,
    });
    expect(result.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect('loan' in result).toBe(true);
    if (!('loan' in result)) throw new Error('expected create-loan result');

    const history = await listLoanEvents(ctx(repo, 'alice-openid'), {
      loanId: result.loan._id,
      limit: 100,
    });
    expect(history.items).toHaveLength(2);
    expect(history.items.map((event) => event.eventType)).toEqual([
      LoanEventType.PRINCIPAL_ADD,
      LoanEventType.RATE_CHANGE,
    ]);
    expect(history.items[0]!.amountFen).toBe(75_000);
    expect(history.items[1]!.rate?.annualEffectiveRate).toBe('0.04');

    const acceptRetry = await acceptRequest(ctx(repo, 'bob-openid', NOW + 11), {
      requestId: request._id,
    });
    expect('loan' in acceptRetry).toBe(true);
    if (!('loan' in acceptRetry)) throw new Error('expected create-loan retry result');
    expect(acceptRetry.loan._id).toBe(result.loan._id);
  });

  it('supports either debt direction and keeps counterparty-only acceptance', async () => {
    const repo = new MemoryRepo();
    const { bob } = await establishAliceBob(repo);

    const request = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'LENDER',
      initialPrincipalFen: 40_000,
      rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'r12-known-reverse',
    });

    await expect(
      acceptRequest(ctx(repo, 'alice-openid'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const result = await acceptRequest(ctx(repo, 'bob-openid'), {
      requestId: request._id,
    });
    if (!('loan' in result)) throw new Error('expected create-loan result');
    expect(result.loan.borrowerUserId).not.toBe(bob._id);
    expect(result.loan.lenderUserId).toBe(bob._id);
  });

  it('reject/cancel of known CREATE_LOAN creates no Loan', async () => {
    const repo = new MemoryRepo();
    const { bob } = await establishAliceBob(repo);

    const rejected = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'BORROWER',
      initialPrincipalFen: 10_000,
      rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'r12-known-reject',
    });
    const rejectedFinal = await rejectRequest(ctx(repo, 'bob-openid'), {
      requestId: rejected._id,
    });
    expect(rejectedFinal.status).toBe(LedgerRequestStatus.REJECTED);
    expect(rejectedFinal.loanId).toBeNull();

    const cancelled = await createKnownLoanRequest(ctx(repo, 'alice-openid'), {
      counterpartyUserId: bob._id,
      counterpartyRole: 'BORROWER',
      initialPrincipalFen: 11_000,
      rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'r12-known-cancel',
    });
    const cancelledFinal = await cancelRequest(ctx(repo, 'alice-openid'), {
      requestId: cancelled._id,
    });
    expect(cancelledFinal.status).toBe(LedgerRequestStatus.CANCELLED);
    expect(cancelledFinal.loanId).toBeNull();
  });
});
