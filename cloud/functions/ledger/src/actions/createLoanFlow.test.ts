import { describe, expect, it } from 'vitest';
import {
  INVITE_TTL_MS,
  LedgerRequestStatus,
  LoanEventType,
  LoanStatus,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import type { LedgerRepo, LedgerTransaction } from '../data/repo.js';
import { AppError, ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { ensureUser } from './ensureUser.js';
import { createLoanRequest } from './createLoanRequest.js';
import {
  acceptInviteRequest,
  createLoanInvite,
  previewInvite,
} from './loanInvites.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = 1_789_000_000_000;
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);

function ctx(
  repo: LedgerRepo,
  openid: string,
  now = NOW,
): ActionContext {
  return { repo, openid, now };
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: 100_000,
    rate: {
      annualEffectiveRate: '0.03',
      rateSource: RateSource.MANUAL,
    },
    proposedEffectiveDate: '2026-09-12',
    note: 'first loan',
    idempotencyKey: 'create-loan-key-1',
    ...overrides,
  };
}

async function bootstrap(
  repo: LedgerRepo,
  openid: string,
  displayName: string,
  now = NOW,
) {
  return ensureUser(ctx(repo, openid, now), { displayName });
}

function expectAppError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe('R5 CREATE_LOAN first-contact flow', () => {
  it('creates an idempotent first-contact request and rejects changed reuse', async () => {
    const repo = new MemoryRepo();
    const proposer = await bootstrap(repo, 'openid-a', 'Alice');
    const actionCtx = ctx(repo, 'openid-a');

    const first = await createLoanRequest(actionCtx, requestInput());
    const retry = await createLoanRequest(actionCtx, requestInput());

    expect(retry._id).toBe(first._id);
    expect(first.proposerUserId).toBe(proposer._id);
    expect(first.counterpartyUserId).toBeNull();
    expect(first.status).toBe(LedgerRequestStatus.PENDING);
    expect(first.requiresInitiatorVerify).toBe(true);
    expect((first.payload as { lenderUserId: string | null }).lenderUserId).toBe(
      proposer._id,
    );
    expect((first.payload as { borrowerUserId: string | null }).borrowerUserId).toBeNull();

    await expect(
      createLoanRequest(
        actionCtx,
        requestInput({ initialPrincipalFen: 100_001 }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('supports proposer as borrower with an unknown lender', async () => {
    const repo = new MemoryRepo();
    const proposer = await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(
      ctx(repo, 'openid-a'),
      requestInput({
        unknownPartyRole: 'LENDER',
        idempotencyKey: 'reverse-direction',
      }),
    );

    expect((request.payload as { borrowerUserId: string | null }).borrowerUserId).toBe(
      proposer._id,
    );
    expect((request.payload as { lenderUserId: string | null }).lenderUserId).toBeNull();
  });

  it('preview is read-only and acceptance binds identity without creating a Loan', async () => {
    const repo = new MemoryRepo();
    const proposer = await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });

    const before = await repo.getRequest(request._id);
    const preview = await previewInvite(ctx(repo, 'anonymous-preview'), {
      rawToken: TOKEN_A,
    });
    const after = await repo.getRequest(request._id);

    expect(preview.requestId).toBe(request._id);
    expect(preview.initialPrincipalFen).toBe(100_000);
    expect(after).toEqual(before);

    const accepted = await acceptInviteRequest(ctx(repo, 'openid-b', NOW + 100), {
      rawToken: TOKEN_A,
      displayName: 'Bob',
    });

    expect(accepted.request.status).toBe(
      LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
    );
    expect(accepted.request.counterpartyUserId).toBe(accepted.claimant._id);
    expect(
      (accepted.request.payload as { borrowerUserId: string | null }).borrowerUserId,
    ).toBe(accepted.claimant._id);
    expect(
      (accepted.request.payload as { lenderUserId: string | null }).lenderUserId,
    ).toBe(proposer._id);

    const loans = await repo.listLoansForUser({
      userId: proposer._id,
      direction: 'LENDER',
      status: LoanStatus.ACTIVE,
      page: { limit: 10 },
    });
    expect(loans.items).toHaveLength(0);
  });

  it('prevents the proposer from claiming their own invite', async () => {
    const repo = new MemoryRepo();
    await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });

    try {
      await acceptInviteRequest(ctx(repo, 'openid-a', NOW + 1), {
        rawToken: TOKEN_A,
      });
      throw new Error('expected self-claim to fail');
    } catch (error) {
      expectAppError(error, ErrorCode.FORBIDDEN);
    }

    expect((await repo.getRequest(request._id))?.status).toBe(
      LedgerRequestStatus.PENDING,
    );
  });

  it('expires invite credentials without mutating the request', async () => {
    const repo = new MemoryRepo();
    await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });

    await expect(
      previewInvite(ctx(repo, 'preview', NOW + INVITE_TTL_MS + 1), {
        rawToken: TOKEN_A,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVITE_EXPIRED });
    expect((await repo.getRequest(request._id))?.status).toBe(
      LedgerRequestStatus.PENDING,
    );
  });

  it('allows only one claimant to win a concurrent invite claim', async () => {
    const repo = new MemoryRepo();
    await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });

    const results = await Promise.allSettled([
      acceptInviteRequest(ctx(repo, 'openid-b', NOW + 10), {
        rawToken: TOKEN_A,
        displayName: 'Bob',
      }),
      acceptInviteRequest(ctx(repo, 'openid-c', NOW + 10), {
        rawToken: TOKEN_A,
        displayName: 'Carol',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await repo.getRequest(request._id))?.status).toBe(
      LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
    );
  });

  it('atomically creates one Loan and exactly two genesis events', async () => {
    const repo = new MemoryRepo();
    const proposer = await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });
    const accepted = await acceptInviteRequest(ctx(repo, 'openid-b', NOW + 10), {
      rawToken: TOKEN_A,
      displayName: 'Bob',
    });

    await expect(
      verifyFirstCounterparty(ctx(repo, 'openid-b', NOW + 20), {
        requestId: request._id,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const applied = await verifyFirstCounterparty(
      ctx(repo, 'openid-a', NOW + 30),
      { requestId: request._id },
    );

    expect(applied.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect(applied.request.loanId).toBe(applied.loan._id);
    expect(applied.loan.lenderUserId).toBe(proposer._id);
    expect(applied.loan.borrowerUserId).toBe(accepted.claimant._id);

    const events = await repo.listLoanEvents({
      loanId: applied.loan._id,
      page: { limit: 10 },
    });
    expect(events.items).toHaveLength(2);
    expect(events.items.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.items.map((event) => event.eventType)).toEqual([
      LoanEventType.PRINCIPAL_ADD,
      LoanEventType.RATE_CHANGE,
    ]);
    expect(events.items[0]?.amountFen).toBe(100_000);
    expect(events.items[1]?.rate?.annualEffectiveRate).toBe('0.03');
    expect(new Set(events.items.map((event) => event.sourceRequestId))).toEqual(
      new Set([request._id]),
    );
    expect(new Set(events.items.map((event) => event.idempotencyKey)).size).toBe(2);

    const retry = await verifyFirstCounterparty(
      ctx(repo, 'openid-a', NOW + 40),
      { requestId: request._id },
    );
    expect(retry.loan._id).toBe(applied.loan._id);
    expect(
      (await repo.listLoanEvents({
        loanId: applied.loan._id,
        page: { limit: 10 },
      })).items,
    ).toHaveLength(2);
  });

  it('concurrent verification converges on one formal Loan/event set', async () => {
    const repo = new MemoryRepo();
    await bootstrap(repo, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'openid-a'), requestInput());
    await createLoanInvite(ctx(repo, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_A,
    });
    await acceptInviteRequest(ctx(repo, 'openid-b', NOW + 10), {
      rawToken: TOKEN_A,
      displayName: 'Bob',
    });

    const [a, b] = await Promise.all([
      verifyFirstCounterparty(ctx(repo, 'openid-a', NOW + 20), {
        requestId: request._id,
      }),
      verifyFirstCounterparty(ctx(repo, 'openid-a', NOW + 20), {
        requestId: request._id,
      }),
    ]);

    expect(a.loan._id).toBe(b.loan._id);
    expect(
      (await repo.listLoanEvents({ loanId: a.loan._id, page: { limit: 10 } }))
        .items,
    ).toHaveLength(2);
  });

  it('rolls back Loan and genesis events if the transaction fails mid-apply', async () => {
    const base = new MemoryRepo();
    const proposer = await bootstrap(base, 'openid-a', 'Alice');
    const request = await createLoanRequest(ctx(base, 'openid-a'), requestInput());
    await createLoanInvite(ctx(base, 'openid-a'), {
      requestId: request._id,
      rawToken: TOKEN_B,
    });
    await acceptInviteRequest(ctx(base, 'openid-b', NOW + 10), {
      rawToken: TOKEN_B,
      displayName: 'Bob',
    });

    const failingRepo = new Proxy(base as LedgerRepo, {
      get(target, property, receiver) {
        if (property === 'runTransaction') {
          return async <T>(work: (tx: LedgerTransaction) => Promise<T>) =>
            base.runTransaction(async (tx) => {
              let appends = 0;
              const failingTx = new Proxy(tx, {
                get(txTarget, txProperty, txReceiver) {
                  if (txProperty === 'appendEventIdempotent') {
                    return async (...args: Parameters<LedgerTransaction['appendEventIdempotent']>) => {
                      appends += 1;
                      if (appends === 2) throw new Error('forced second-event failure');
                      return txTarget.appendEventIdempotent(...args);
                    };
                  }
                  const value = Reflect.get(txTarget, txProperty, txReceiver);
                  return typeof value === 'function' ? value.bind(txTarget) : value;
                },
              });
              return work(failingTx);
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await expect(
      verifyFirstCounterparty(ctx(failingRepo, 'openid-a', NOW + 20), {
        requestId: request._id,
      }),
    ).rejects.toThrow('forced second-event failure');

    const after = await base.getRequest(request._id);
    expect(after?.status).toBe(LedgerRequestStatus.PENDING_INITIATOR_VERIFY);
    expect(after?.loanId).toBeNull();
    const loans = await base.listLoansForUser({
      userId: proposer._id,
      direction: 'LENDER',
      status: LoanStatus.ACTIVE,
      page: { limit: 10 },
    });
    expect(loans.items).toHaveLength(0);
  });
});
