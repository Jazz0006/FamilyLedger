import { describe, expect, it } from 'vitest';
import {
  CURRENCY,
  LEDGER_TIMEZONE,
  LOAN_EVENT_SCHEMA_VERSION,
  LedgerRequestStatus,
  LoanEventType,
  LoanStatus,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import {
  getHomeSummary,
  getLoan,
  listLoanEvents,
  listLoans,
  listPendingRequests,
} from './readActions.js';
import { deriveLoanSummaryFromRepo } from './read-model.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T04:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function createUser(repo: MemoryRepo, openid: string, name: string) {
  return ensureUser(ctx(repo, openid), { displayName: name });
}

async function createFirstContactLoan(params: {
  repo: MemoryRepo;
  proposerOpenid: string;
  claimantOpenid: string;
  unknownPartyRole: 'BORROWER' | 'LENDER';
  principalFen: number;
  key: string;
  tokenChar: string;
  rate?: string;
}) {
  const proposer = await createUser(
    params.repo,
    params.proposerOpenid,
    params.proposerOpenid,
  );
  const request = await createLoanRequest(ctx(params.repo, params.proposerOpenid), {
    unknownPartyRole: params.unknownPartyRole,
    initialPrincipalFen: params.principalFen,
    rate: {
      annualEffectiveRate: params.rate ?? '0',
      rateSource: RateSource.MANUAL,
    },
    proposedEffectiveDate: '2026-09-12',
    idempotencyKey: params.key,
  });
  await createLoanInvite(ctx(params.repo, params.proposerOpenid), {
    requestId: request._id,
    rawToken: params.tokenChar.repeat(43),
  });
  const accepted = await acceptInviteRequest(
    ctx(params.repo, params.claimantOpenid, NOW + 1),
    {
      rawToken: params.tokenChar.repeat(43),
      displayName: params.claimantOpenid,
    },
  );
  const applied = await verifyFirstCounterparty(
    ctx(params.repo, params.proposerOpenid, NOW + 2),
    { requestId: request._id },
  );
  return { proposer, claimant: accepted.claimant, request, applied };
}

describe('R6 v2 read model', () => {
  it('projects the same Loan as receivable for lender and payable for borrower', async () => {
    const repo = new MemoryRepo();
    const created = await createFirstContactLoan({
      repo,
      proposerOpenid: 'alice',
      claimantOpenid: 'bob',
      unknownPartyRole: 'BORROWER',
      principalFen: 100_000,
      key: 'loan-ab',
      tokenChar: 'A',
    });

    const lenderView = await getLoan(ctx(repo, 'alice'), {
      loanId: created.applied.loan._id,
    });
    const borrowerView = await getLoan(ctx(repo, 'bob'), {
      loanId: created.applied.loan._id,
    });

    expect(lenderView.direction).toBe('LENDER');
    expect(borrowerView.direction).toBe('BORROWER');
    expect(lenderView.summary).toEqual(borrowerView.summary);
    expect(lenderView.summary.principalFen).toBe(100_000);
    expect(lenderView.summary.interestFen).toBe(0);
    expect(lenderView.summary.currentRate.annualEffectiveRate).toBe('0');

    const lenderList = await listLoans(ctx(repo, 'alice'), {
      direction: 'LENDER',
      status: LoanStatus.ACTIVE,
      limit: 10,
    });
    const borrowerList = await listLoans(ctx(repo, 'bob'), {
      direction: 'BORROWER',
      status: LoanStatus.ACTIVE,
      limit: 10,
    });
    expect(lenderList.items[0]?.loan._id).toBe(created.applied.loan._id);
    expect(borrowerList.items[0]?.loan._id).toBe(created.applied.loan._id);
  });

  it('lets one User be lender in one Loan and borrower in another home projection', async () => {
    const repo = new MemoryRepo();
    await createFirstContactLoan({
      repo,
      proposerOpenid: 'alice',
      claimantOpenid: 'bob',
      unknownPartyRole: 'BORROWER',
      principalFen: 100_000,
      key: 'alice-lends',
      tokenChar: 'B',
    });
    await createFirstContactLoan({
      repo,
      proposerOpenid: 'alice',
      claimantOpenid: 'carol',
      unknownPartyRole: 'LENDER',
      principalFen: 50_000,
      key: 'alice-borrows',
      tokenChar: 'C',
    });

    const home = await getHomeSummary(ctx(repo, 'alice'));
    expect(home.receivable).toEqual({
      principalFen: 100_000,
      interestFen: 0,
      totalFen: 100_000,
      loanCount: 1,
    });
    expect(home.payable).toEqual({
      principalFen: 50_000,
      interestFen: 0,
      totalFen: 50_000,
      loanCount: 1,
    });
  });

  it('hides Loan existence and event history from unrelated Users', async () => {
    const repo = new MemoryRepo();
    const created = await createFirstContactLoan({
      repo,
      proposerOpenid: 'alice',
      claimantOpenid: 'bob',
      unknownPartyRole: 'BORROWER',
      principalFen: 100_000,
      key: 'private-loan',
      tokenChar: 'D',
    });
    await createUser(repo, 'mallory', 'Mallory');

    await expect(
      getLoan(ctx(repo, 'mallory'), { loanId: created.applied.loan._id }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    await expect(
      listLoanEvents(ctx(repo, 'mallory'), {
        loanId: created.applied.loan._id,
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('reconstructs a complete balance across more than one event page', async () => {
    const repo = new MemoryRepo();
    const created = await createFirstContactLoan({
      repo,
      proposerOpenid: 'alice',
      claimantOpenid: 'bob',
      unknownPartyRole: 'BORROWER',
      principalFen: 100_000,
      key: 'many-events',
      tokenChar: 'E',
      rate: '0',
    });
    const loan = created.applied.loan;

    await repo.runTransaction(async (tx) => {
      const sequences = await tx.allocateEventSequences(loan._id, 101);
      for (let index = 0; index < sequences.length; index += 1) {
        const sequence = sequences[index];
        if (sequence == null) throw new Error('missing sequence');
        await tx.appendEventIdempotent({
          loanId: loan._id,
          eventType: LoanEventType.PRINCIPAL_ADD,
          amountFen: 1,
          effectiveDate: '2026-09-12',
          sourceRequestId: created.request._id,
          createdBy: loan.lenderUserId,
          confirmedBy: loan.borrowerUserId,
          sequence,
          idempotencyKey: `many-events-${index}`,
          createdAt: NOW + 10 + index,
          schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
        });
      }
    });

    const firstPage = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
    });
    expect(firstPage.items).toHaveLength(100);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await listLoanEvents(ctx(repo, 'alice'), {
      loanId: loan._id,
      limit: 100,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items).toHaveLength(3);
    expect(secondPage.items[0]?.sequence).toBe(101);
    expect(secondPage.items[2]?.sequence).toBe(103);

    const summary = await deriveLoanSummaryFromRepo(
      repo,
      loan,
      '2026-09-12',
    );
    expect(summary.principalFen).toBe(100_101);
    expect(summary.totalFen).toBe(100_101);
  });

  it('counts first-contact initiator verification as pending for the proposer', async () => {
    const repo = new MemoryRepo();
    await createUser(repo, 'alice', 'Alice');
    const request = await createLoanRequest(ctx(repo, 'alice'), {
      unknownPartyRole: 'BORROWER',
      initialPrincipalFen: 25_000,
      rate: {
        annualEffectiveRate: '0.02',
        rateSource: RateSource.MANUAL,
      },
      proposedEffectiveDate: '2026-09-12',
      idempotencyKey: 'pending-verification',
    });
    await createLoanInvite(ctx(repo, 'alice'), {
      requestId: request._id,
      rawToken: 'F'.repeat(43),
    });
    await acceptInviteRequest(ctx(repo, 'bob', NOW + 1), {
      rawToken: 'F'.repeat(43),
      displayName: 'Bob',
    });

    const pending = await listPendingRequests(ctx(repo, 'alice'), { limit: 10 });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]?.request.status).toBe(
      LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
    );
    expect(pending.items[0]?.otherParty.displayName).toBe('Bob');
    expect((await getHomeSummary(ctx(repo, 'alice'))).pendingRequestCount).toBe(1);
  });

  it('does not include CLOSED Loans in active home totals', async () => {
    const repo = new MemoryRepo();
    const lender = await createUser(repo, 'alice', 'Alice');
    const borrower = await createUser(repo, 'bob', 'Bob');

    await repo.runTransaction(async (tx) => {
      await tx.createLoan({
        lenderUserId: lender._id,
        borrowerUserId: borrower._id,
        currency: CURRENCY,
        ledgerTimezone: LEDGER_TIMEZONE,
        createdFromRequestId: 'closed-seed-request',
        status: LoanStatus.CLOSED,
        createdAt: NOW - 10_000,
        closedAt: NOW - 1_000,
      });
    });

    const lenderHome = await getHomeSummary(ctx(repo, 'alice'));
    const borrowerHome = await getHomeSummary(ctx(repo, 'bob'));
    expect(lenderHome.receivable.loanCount).toBe(0);
    expect(lenderHome.receivable.totalFen).toBe(0);
    expect(borrowerHome.payable.loanCount).toBe(0);
    expect(borrowerHome.payable.totalFen).toBe(0);
  });
});
