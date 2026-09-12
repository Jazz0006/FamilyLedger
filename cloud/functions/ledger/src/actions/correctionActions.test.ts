import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LoanEventType,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createCorrectionRequest } from './correctionActions.js';
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
  createRepaymentRequest,
  rejectRequest,
} from './repaymentActions.js';
import { getLoan, listLoanEvents } from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const NOW = Date.parse('2026-09-12T05:00:00.000Z');

function ctx(repo: MemoryRepo, openid: string, now = NOW): ActionContext {
  return { repo, openid, now };
}

async function createLoan(
  repo: MemoryRepo,
  suffix = 'A',
  principalFen = 100_000,
  effectiveDate = '2026-01-01',
) {
  await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: principalFen,
    rate: { annualEffectiveRate: '0', rateSource: RateSource.MANUAL },
    proposedEffectiveDate: effectiveDate,
    idempotencyKey: `r10-create-${suffix}`,
  });
  const rawToken = suffix.repeat(43);
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

async function events(repo: MemoryRepo, loanId: string) {
  return (
    await listLoanEvents(ctx(repo, 'alice'), {
      loanId,
      limit: 100,
    })
  ).items;
}

function principalCorrection(
  loanId: string,
  targetEventId: string,
  delta: number,
  key: string,
) {
  return {
    loanId,
    correctionKind: 'PRINCIPAL' as const,
    targetEventId,
    principalDeltaFen: delta,
    reason: 'correct principal history',
    idempotencyKey: key,
  };
}

function rateCorrection(
  loanId: string,
  targetEventId: string,
  rate: string,
  key: string,
) {
  return {
    loanId,
    correctionKind: 'RATE' as const,
    targetEventId,
    replacementRate: {
      annualEffectiveRate: rate,
      rateSource: RateSource.MANUAL,
      rateReferenceLabel: `corrected ${rate}`,
    },
    reason: 'correct rate history',
    idempotencyKey: key,
  };
}

describe('R10 CORRECTION workflow', () => {
  it('lets either participant propose principal and rate corrections idempotently', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const history = await events(repo, loan._id);
    const principal = history.find((event) => event.eventType === LoanEventType.PRINCIPAL_ADD)!;
    const rate = history.find((event) => event.eventType === LoanEventType.RATE_CHANGE)!;

    const p = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, principal._id, -1_000, 'corr-principal'),
    );
    const pRetry = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, principal._id, -1_000, 'corr-principal'),
    );
    expect(pRetry._id).toBe(p._id);
    expect(p.counterpartyUserId).toBe(loan.borrowerUserId);

    const r = await createCorrectionRequest(
      ctx(repo, 'bob'),
      rateCorrection(loan._id, rate._id, '0.04', 'corr-rate'),
    );
    expect(r.counterpartyUserId).toBe(loan.lenderUserId);

    await expect(
      createCorrectionRequest(
        ctx(repo, 'alice'),
        principalCorrection(loan._id, principal._id, -1_001, 'corr-principal'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('rejects client-supplied effectiveDate and cross-dimension payload fields', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const principal = (await events(repo, loan._id)).find(
      (event) => event.eventType === LoanEventType.PRINCIPAL_ADD,
    )!;

    await expect(
      createCorrectionRequest(ctx(repo, 'alice'), {
        ...principalCorrection(loan._id, principal._id, -1_000, 'corr-date'),
        proposedEffectiveDate: '2099-01-01',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    await expect(
      createCorrectionRequest(ctx(repo, 'alice'), {
        ...principalCorrection(loan._id, principal._id, -1_000, 'corr-cross'),
        replacementRate: { annualEffectiveRate: '0.1', rateSource: RateSource.MANUAL },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('applies a principal correction once, inherits target date, and never mutates target bytes', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const before = await events(repo, loan._id);
    const target = before.find((event) => event.eventType === LoanEventType.PRINCIPAL_ADD)!;
    const targetSnapshot = JSON.stringify(target);
    const request = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, target._id, -20_000, 'corr-apply-principal'),
    );

    const first = await acceptRequest(ctx(repo, 'bob', NOW + 10), {
      requestId: request._id,
    });
    const retry = await acceptRequest(ctx(repo, 'bob', NOW + 11), {
      requestId: request._id,
    });

    expect(first.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect(first.event.eventType).toBe(LoanEventType.CORRECTION);
    expect(first.event.amountFen).toBe(-20_000);
    expect(first.event.rate).toBeUndefined();
    expect(first.event.targetEventId).toBe(target._id);
    expect(first.event.effectiveDate).toBe(target.effectiveDate);
    expect(retry.event._id).toBe(first.event._id);
    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      80_000,
    );

    const after = await events(repo, loan._id);
    expect(JSON.stringify(after.find((event) => event._id === target._id))).toBe(
      targetSnapshot,
    );
  });

  it('allows same-dimension correction-of-correction and rejects cross-dimension targets', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const history = await events(repo, loan._id);
    const principal = history.find((event) => event.eventType === LoanEventType.PRINCIPAL_ADD)!;
    const rate = history.find((event) => event.eventType === LoanEventType.RATE_CHANGE)!;

    const first = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, principal._id, -10_000, 'corr-chain-1'),
    );
    const firstApplied = await acceptRequest(ctx(repo, 'bob'), { requestId: first._id });
    const second = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, firstApplied.event._id, 5_000, 'corr-chain-2'),
    );
    await acceptRequest(ctx(repo, 'bob'), { requestId: second._id });
    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      95_000,
    );

    const wrongPrincipal = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, rate._id, -1_000, 'corr-wrong-principal'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: wrongPrincipal._id }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    const wrongRate = await createCorrectionRequest(
      ctx(repo, 'alice'),
      rateCorrection(loan._id, principal._id, '0.03', 'corr-wrong-rate'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: wrongRate._id }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('rejects a target event from another Loan', async () => {
    const repo = new MemoryRepo();
    const first = await createLoan(repo, 'A');
    const second = await createLoan(repo, 'B');
    const foreignTarget = (await events(repo, second.loan._id)).find(
      (event) => event.eventType === LoanEventType.PRINCIPAL_ADD,
    )!;
    const request = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(first.loan._id, foreignTarget._id, -1_000, 'corr-foreign'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: request._id }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('rejects a backdated principal correction that creates a negative historical interval', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo, 'A', 100_000, '2026-01-01');
    const initial = (await events(repo, loan._id)).find(
      (event) => event.eventType === LoanEventType.PRINCIPAL_ADD,
    )!;

    const repay = await createRepaymentRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 60_000,
      proposedEffectiveDate: '2026-02-01',
      idempotencyKey: 'r10-repay',
    });
    await acceptRequest(ctx(repo, 'bob'), { requestId: repay._id });

    const laterAdd = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 100_000,
      proposedEffectiveDate: '2026-03-01',
      idempotencyKey: 'r10-later-add',
    });
    await acceptRequest(ctx(repo, 'bob'), { requestId: laterAdd._id });
    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      140_000,
    );

    const correction = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, initial._id, -50_000, 'corr-negative-gap'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: correction._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
      140_000,
    );
  });

  it('applies rate correction to current same-day winner and rejects an obsolete same-day target', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    const initialRate = (await events(repo, loan._id)).find(
      (event) => event.eventType === LoanEventType.RATE_CHANGE,
    )!;

    const changed = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.05', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: initialRate.effectiveDate,
      idempotencyKey: 'r10-rate-change',
    });
    const changedApplied = await acceptRequest(ctx(repo, 'bob'), {
      requestId: changed._id,
    });

    const obsolete = await createCorrectionRequest(
      ctx(repo, 'alice'),
      rateCorrection(loan._id, initialRate._id, '0.03', 'corr-obsolete-rate'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: obsolete._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    const correction = await createCorrectionRequest(
      ctx(repo, 'alice'),
      rateCorrection(loan._id, changedApplied.event._id, '0.08', 'corr-current-rate'),
    );
    const applied = await acceptRequest(ctx(repo, 'bob'), {
      requestId: correction._id,
    });
    expect(applied.event.rate?.annualEffectiveRate).toBe('0.08');
    expect(applied.event.targetEventId).toBe(changedApplied.event._id);

    const view = await getLoan(ctx(repo, 'alice'), { loanId: loan._id });
    expect(view.summary.currentRate.annualEffectiveRate).toBe('0.08');

    const correctionOfCorrection = await createCorrectionRequest(
      ctx(repo, 'alice'),
      rateCorrection(loan._id, applied.event._id, '0.09', 'corr-rate-chain'),
    );
    await acceptRequest(ctx(repo, 'bob'), { requestId: correctionOfCorrection._id });
    expect(
      (await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.currentRate
        .annualEffectiveRate,
    ).toBe('0.09');
  });

  it('enforces participant authority and reject/cancel produce no Correction event', async () => {
    const repo = new MemoryRepo();
    const { loan } = await createLoan(repo);
    await ensureUser(ctx(repo, 'mallory'), { displayName: 'Mallory' });
    const target = (await events(repo, loan._id)).find(
      (event) => event.eventType === LoanEventType.PRINCIPAL_ADD,
    )!;

    await expect(
      createCorrectionRequest(
        ctx(repo, 'mallory'),
        principalCorrection(loan._id, target._id, -1_000, 'corr-unrelated'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const selfConfirm = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, target._id, -1_000, 'corr-self'),
    );
    await expect(
      acceptRequest(ctx(repo, 'alice'), { requestId: selfConfirm._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      acceptRequest(ctx(repo, 'mallory'), { requestId: selfConfirm._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const rejected = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, target._id, -1_000, 'corr-reject'),
    );
    expect(
      (await rejectRequest(ctx(repo, 'bob'), { requestId: rejected._id })).status,
    ).toBe(LedgerRequestStatus.REJECTED);

    const cancelled = await createCorrectionRequest(
      ctx(repo, 'alice'),
      principalCorrection(loan._id, target._id, -2_000, 'corr-cancel'),
    );
    expect(
      (await cancelRequest(ctx(repo, 'alice'), { requestId: cancelled._id })).status,
    ).toBe(LedgerRequestStatus.CANCELLED);

    const formal = await events(repo, loan._id);
    expect(
      formal.filter(
        (event) =>
          event.sourceRequestId === rejected._id ||
          event.sourceRequestId === cancelled._id,
      ),
    ).toHaveLength(0);
  });
});
