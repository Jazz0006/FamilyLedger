import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LoanEventType,
  LoanStatus,
  RateSource,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import type { LedgerRepo, LedgerTransaction } from '../data/repo.js';
import { ErrorCode } from '../errors.js';
import type { ActionContext } from './action-context.js';
import { createCloseLoanRequest } from './closeLoanActions.js';
import { createLoanRequest } from './createLoanRequest.js';
import { ensureUser } from './ensureUser.js';
import { acceptInviteRequest, createLoanInvite } from './loanInvites.js';
import {
  createPrincipalAddRequest,
  createRateChangeRequest,
} from './loanChangeRequests.js';
import { deriveLoanSummary } from './read-model.js';
import {
  acceptRequest,
  createRepaymentRequest,
  rejectRequest,
  cancelRequest,
} from './repaymentActions.js';
import {
  getHomeSummary,
  getLoan,
  listLoanEvents,
  listLoans,
} from './readActions.js';
import { verifyFirstCounterparty } from './verifyFirstCounterparty.js';

const CLOSE_DATE = '2027-01-01';
const CLOSE_NOW = Date.parse('2027-01-01T05:00:00.000Z');

function ctx(repo: LedgerRepo, openid: string, now = CLOSE_NOW): ActionContext {
  return { repo, openid, now };
}

async function createLoan(
  repo: MemoryRepo,
  suffix: string,
  rate = '0.05',
  principalFen = 100_000,
) {
  await ensureUser(ctx(repo, 'alice'), { displayName: 'Alice' });
  const request = await createLoanRequest(ctx(repo, 'alice'), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: principalFen,
    rate: { annualEffectiveRate: rate, rateSource: RateSource.MANUAL },
    proposedEffectiveDate: '2026-01-01',
    idempotencyKey: `r11-create-${suffix}`,
  });
  const rawToken = suffix.repeat(43);
  await createLoanInvite(ctx(repo, 'alice'), { requestId: request._id, rawToken });
  await acceptInviteRequest(ctx(repo, 'bob'), { rawToken, displayName: 'Bob' });
  return (
    await verifyFirstCounterparty(ctx(repo, 'alice'), {
      requestId: request._id,
    })
  ).loan;
}

async function repayAll(
  repo: LedgerRepo,
  loanId: string,
  principalFen = 100_000,
  key = 'r11-repay-all',
) {
  const request = await createRepaymentRequest(ctx(repo, 'alice'), {
    loanId,
    amountFen: principalFen,
    proposedEffectiveDate: CLOSE_DATE,
    idempotencyKey: key,
  });
  return acceptRequest(ctx(repo, 'bob'), { requestId: request._id });
}

async function allEvents(repo: LedgerRepo, loanId: string) {
  return (
    await listLoanEvents(ctx(repo, 'alice'), {
      loanId,
      limit: 100,
    })
  ).items;
}

function closeInput(loanId: string, key: string, note?: string) {
  return {
    loanId,
    proposedEffectiveDate: CLOSE_DATE,
    note,
    idempotencyKey: key,
  };
}

function failOnPutRequest(repo: MemoryRepo): LedgerRepo {
  return new Proxy(repo as LedgerRepo, {
    get(target, property, receiver) {
      if (property === 'runTransaction') {
        return async <T>(work: (tx: LedgerTransaction) => Promise<T>) =>
          repo.runTransaction((tx) =>
            work(
              new Proxy(tx, {
                get(txTarget, txProperty, txReceiver) {
                  if (txProperty === 'putRequest') {
                    return async () => {
                      throw new Error('forced putRequest failure');
                    };
                  }
                  const value = Reflect.get(txTarget, txProperty, txReceiver);
                  return typeof value === 'function' ? value.bind(txTarget) : value;
                },
              }),
            ),
          );
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('R11 CLOSE_LOAN workflow', () => {
  it('lets either participant propose close with request idempotency', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'A');
    await repayAll(repo, loan._id);

    const lender = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-lender', 'settled'),
    );
    const retry = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-lender', 'settled'),
    );
    expect(retry._id).toBe(lender._id);
    expect(lender.counterpartyUserId).toBe(loan.borrowerUserId);

    const borrower = await createCloseLoanRequest(
      ctx(repo, 'bob'),
      closeInput(loan._id, 'close-borrower'),
    );
    expect(borrower.counterpartyUserId).toBe(loan.lenderUserId);

    await expect(
      createCloseLoanRequest(
        ctx(repo, 'alice'),
        closeInput(loan._id, 'close-lender', 'changed note'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('closes zero-principal Loan, snapshots accrued interest, and retry is stable', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'B', '0.05');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-positive-interest');
    const request = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-success'),
    );

    const first = await acceptRequest(ctx(repo, 'bob', CLOSE_NOW), {
      requestId: request._id,
    });
    const closed = await repo.getLoan(loan._id);
    expect(first.request.status).toBe(LedgerRequestStatus.APPLIED);
    expect(first.event.eventType).toBe(LoanEventType.LOAN_CLOSED);
    expect(first.event.amountFen).toBeNull();
    expect(first.event.closeSettlement?.accruedInterestFen).toBe(5_000);
    expect(closed?.status).toBe(LoanStatus.CLOSED);
    expect(closed?.closedAt).toBe(CLOSE_NOW);

    const retry = await acceptRequest(ctx(repo, 'bob', CLOSE_NOW + 86_400_000), {
      requestId: request._id,
    });
    expect(retry.event._id).toBe(first.event._id);
    expect((await repo.getLoan(loan._id))?.closedAt).toBe(CLOSE_NOW);

    const view = await getLoan(ctx(repo, 'alice', CLOSE_NOW + 86_400_000), {
      loanId: loan._id,
    });
    expect(view.summary.status).toBe(LoanStatus.CLOSED);
    expect(view.summary.principalFen).toBe(0);
    expect(view.summary.interestFen).toBe(0);
    expect(view.summary.totalFen).toBe(0);
    expect(view.summary.todayInterestFen).toBe(0);
    expect(view.summary.closeEffectiveDate).toBe(CLOSE_DATE);
    expect(view.summary.settledInterestFen).toBe(5_000);

    const closedList = await listLoans(ctx(repo, 'alice', CLOSE_NOW + 1), {
      direction: 'LENDER',
      status: LoanStatus.CLOSED,
    });
    expect(closedList.items.map((item) => item.loan._id)).toContain(loan._id);

    const home = await getHomeSummary(ctx(repo, 'alice', CLOSE_NOW + 1));
    expect(home.receivable.loanCount).toBe(0);
    expect(home.receivable.totalFen).toBe(0);
  });

  it('preserves historical pre-close math while current settlement is zero', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'C', '0.05');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-history');
    const request = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-history'),
    );
    await acceptRequest(ctx(repo, 'bob'), { requestId: request._id });

    const closed = (await repo.getLoan(loan._id))!;
    const history = await allEvents(repo, loan._id);
    const historical = deriveLoanSummary(closed, history, '2026-07-01');
    expect(historical.status).toBe(LoanStatus.CLOSED);
    expect(historical.principalFen).toBe(100_000);
    expect(historical.interestFen).toBeGreaterThan(0);
    expect(historical.totalFen).toBeGreaterThan(100_000);
    expect(historical.closeEffectiveDate).toBe(CLOSE_DATE);
    expect(historical.settledInterestFen).toBe(5_000);

    const settled = deriveLoanSummary(closed, history, CLOSE_DATE);
    expect(settled.totalFen).toBe(0);
  });

  it('rejects non-zero principal, future close, and close before latest formal event', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'D', '0');

    const nonZero = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-nonzero'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: nonZero._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    await repayAll(repo, loan._id, 100_000, 'r11-repay-validation');
    const future = await createCloseLoanRequest(
      ctx(repo, 'alice', Date.parse('2027-01-02T05:00:00.000Z')),
      closeInput(loan._id, 'close-future-final'),
    );
    await expect(
      acceptRequest(ctx(repo, 'bob', Date.parse('2026-12-31T05:00:00.000Z')), {
        requestId: future._id,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    const beforeLatest = await createCloseLoanRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      proposedEffectiveDate: '2026-12-31',
      idempotencyKey: 'close-before-latest',
    });
    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: beforeLatest._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('rejects negative residual interest and allows zero-interest settlement snapshot', async () => {
    const negativeRepo = new MemoryRepo();
    const negative = await createLoan(negativeRepo, 'E', '-0.10');
    await repayAll(negativeRepo, negative._id, 100_000, 'r11-repay-negative-rate');
    const negativeClose = await createCloseLoanRequest(
      ctx(negativeRepo, 'alice'),
      closeInput(negative._id, 'close-negative-interest'),
    );
    await expect(
      acceptRequest(ctx(negativeRepo, 'bob'), { requestId: negativeClose._id }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    const zeroRepo = new MemoryRepo();
    const zero = await createLoan(zeroRepo, 'F', '0');
    await repayAll(zeroRepo, zero._id, 100_000, 'r11-repay-zero-rate');
    const zeroClose = await createCloseLoanRequest(
      ctx(zeroRepo, 'alice'),
      closeInput(zero._id, 'close-zero-interest'),
    );
    const applied = await acceptRequest(ctx(zeroRepo, 'bob'), {
      requestId: zeroClose._id,
    });
    expect(applied.event.closeSettlement?.accruedInterestFen).toBe(0);
  });

  it('enforces authority and reject/cancel do not close the Loan', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'G', '0');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-auth');
    await ensureUser(ctx(repo, 'mallory'), { displayName: 'Mallory' });

    await expect(
      createCloseLoanRequest(ctx(repo, 'mallory'), closeInput(loan._id, 'close-unrelated')),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const self = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-self'),
    );
    await expect(
      acceptRequest(ctx(repo, 'alice'), { requestId: self._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      acceptRequest(ctx(repo, 'mallory'), { requestId: self._id }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const rejected = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-reject'),
    );
    expect(
      (await rejectRequest(ctx(repo, 'bob'), { requestId: rejected._id })).status,
    ).toBe(LedgerRequestStatus.REJECTED);

    const cancelled = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-cancel'),
    );
    expect(
      (await cancelRequest(ctx(repo, 'alice'), { requestId: cancelled._id })).status,
    ).toBe(LedgerRequestStatus.CANCELLED);

    expect((await repo.getLoan(loan._id))?.status).toBe(LoanStatus.ACTIVE);
    expect(
      (await allEvents(repo, loan._id)).filter(
        (event) =>
          event.sourceRequestId === rejected._id || event.sourceRequestId === cancelled._id,
      ),
    ).toHaveLength(0);
  });

  it('rolls back close event and Loan lifecycle if final request write fails', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'H', '0');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-rollback');
    const request = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-rollback'),
    );

    await expect(
      acceptRequest(ctx(failOnPutRequest(repo), 'bob'), { requestId: request._id }),
    ).rejects.toThrow('forced putRequest failure');

    expect((await repo.getLoan(loan._id))?.status).toBe(LoanStatus.ACTIVE);
    expect((await repo.getLoan(loan._id))?.closedAt).toBeNull();
    expect((await repo.getRequest(request._id))?.status).toBe(LedgerRequestStatus.PENDING);
    expect(
      (await allEvents(repo, loan._id)).filter(
        (event) => event.eventType === LoanEventType.LOAN_CLOSED,
      ),
    ).toHaveLength(0);
  });

  it('blocks pending and new formal mutations after close', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'I', '0');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-post-close');
    const pendingRate = await createRateChangeRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      rate: { annualEffectiveRate: '0.03', rateSource: RateSource.MANUAL },
      proposedEffectiveDate: CLOSE_DATE,
      idempotencyKey: 'r11-pending-rate',
    });
    const close = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-block-mutations'),
    );
    await acceptRequest(ctx(repo, 'bob'), { requestId: close._id });

    await expect(
      acceptRequest(ctx(repo, 'bob'), { requestId: pendingRate._id }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE });
    await expect(
      createPrincipalAddRequest(ctx(repo, 'alice'), {
        loanId: loan._id,
        amountFen: 1_000,
        proposedEffectiveDate: CLOSE_DATE,
        idempotencyKey: 'r11-new-after-close',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE });
  });

  it('serializes concurrent close versus principal addition into one valid history', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, 'J', '0');
    await repayAll(repo, loan._id, 100_000, 'r11-repay-race');

    const close = await createCloseLoanRequest(
      ctx(repo, 'alice'),
      closeInput(loan._id, 'close-race'),
    );
    const add = await createPrincipalAddRequest(ctx(repo, 'alice'), {
      loanId: loan._id,
      amountFen: 1_000,
      proposedEffectiveDate: CLOSE_DATE,
      idempotencyKey: 'r11-add-race',
    });

    const results = await Promise.allSettled([
      acceptRequest(ctx(repo, 'bob'), { requestId: close._id }),
      acceptRequest(ctx(repo, 'bob'), { requestId: add._id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const persisted = (await repo.getLoan(loan._id))!;
    const history = await allEvents(repo, loan._id);
    const sequences = history.map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);

    if (persisted.status === LoanStatus.CLOSED) {
      expect(
        history.filter((event) => event.eventType === LoanEventType.LOAN_CLOSED),
      ).toHaveLength(1);
      expect(
        history.filter(
          (event) =>
            event.sourceRequestId === add._id &&
            event.eventType === LoanEventType.PRINCIPAL_ADD,
        ),
      ).toHaveLength(0);
    } else {
      expect(persisted.status).toBe(LoanStatus.ACTIVE);
      expect((await getLoan(ctx(repo, 'alice'), { loanId: loan._id })).summary.principalFen).toBe(
        1_000,
      );
      expect(
        history.filter((event) => event.eventType === LoanEventType.LOAN_CLOSED),
      ).toHaveLength(0);
    }
  });
});
