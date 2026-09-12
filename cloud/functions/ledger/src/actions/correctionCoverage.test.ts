import { describe, expect, it } from 'vitest';
import { LoanEventType, RateSource } from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import type { ActionContext } from './action-context.js';
import { createCorrectionRequest } from './correctionActions.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import { createRateChangeRequest } from './loanChangeRequests.js';
import { acceptRequest } from './repaymentActions.js';
import { getLoan, listLoanEvents } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T05:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function fixture() {
  const repo = new MemoryRepo();
  await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: 100_000,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-01-01',
    idempotencyKey: 'r10-coverage-create',
  });
  const rawToken = 'Z'.repeat(43);
  await createLoanInvite(ctx(repo, 'alice'), { requestId: request._id, rawToken });
  await acceptInviteRequest(ctx(repo, 'bob'), { rawToken, displayName: 'Bob' });
  const applied = await verifyFirstCounterparty(ctx(repo, 'alice'), {
    requestId: request._id,
  });
  const history = (
    await listLoanEvents(ctx(repo, 'alice'), {
      loanId: applied.loan._id,
      limit: 100,
    })
  ).items;
  return {
    repo,
    loan: applied.loan,
    principal: history.find((event) => event.eventType === LoanEventType.PRINCIPAL_ADD)!,
    rate: history.find((event) => event.eventType === LoanEventType.RATE_CHANGE)!,
  };
}

describe('R10 Correction additional coverage', () => {
  it('allows both lender and borrower to propose both correction dimensions', async () => {
    const { repo, loan, principal, rate } = await fixture();

    const lenderPrincipal = await createCorrectionRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      correctionKind: 'PRINCIPAL',
      targetEventId: principal._id,
      principalDeltaFen: -100,
      idempotencyKey: 'role-lender-principal',
    });
    const borrowerPrincipal = await createCorrectionRequest(ctx(repo, 'bob'), {
      loanId: loan._id,
      correctionKind: 'PRINCIPAL',
      targetEventId: principal._id,
      principalDeltaFen: -200,
      idempotencyKey: 'role-borrower-principal',
    });
    const lenderRate = await createCorrectionRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      correctionKind: 'RATE',
      targetEventId: rate._id,
      replacementRate: { annualEffectiveRate: '0.01', rateSource: RateSource.MANUAL },
      idempotencyKey: 'role-lender-rate',
    });
    const borrowerRate = await createCorrectionRequest(ctx(repo, 'bob'), {
      loanId: loan._id,
      correctionKind: 'RATE',
      targetEventId: rate._id,
      replacementRate: { annualEffectiveRate: '0.02', rateSource: RateSource.MANUAL },
      idempotencyKey: 'role-borrower-rate',
    });

    expect(lenderPrincipal.counterpartyUserId).toBe(loan.borrowerUserId);
    expect(borrowerPrincipal.counterpartyUserId).toBe(loan.lenderUserId);
    expect(lenderRate.counterpartyUserId).toBe(loan.borrowerUserId);
    expect(borrowerRate.counterpartyUserId).toBe(loan.lenderUserId);
  });

  it('changes the historical rate interval used by the calculator', async () => {
    const { repo, loan } = await fixture();
    const rateChange = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.05', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: '2026-01-01',
      idempotencyKey: 'coverage-rate-change',
    });
    const rateEvent = (
      await acceptRequest(ctx(repo, 'bob'), { requestId: rateChange._id })
    ).event;

    const correction = await createCorrectionRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      correctionKind: 'RATE',
      targetEventId: rateEvent._id,
      replacementRate: { annualEffectiveRate: '0.08', rateSource: RateSource.MANUAL },
      idempotencyKey: 'coverage-rate-correction',
    });
    await acceptRequest(ctx(repo, 'bob'), { requestId: correction._id });

    const oneYearLater = Date.parse('2027-01-01T05:00:00.000Z');
    const view = await getLoan(ctx(repo, 'alice', oneYearLater), {
      loanId: loan._id,
    });
    expect(view.summary.currentRate.annualEffectiveRate).toBe('0.08');
    expect(view.summary.principalFen).toBe(100_000);
    expect(view.summary.totalFen).toBe(108_000);
  });
});
