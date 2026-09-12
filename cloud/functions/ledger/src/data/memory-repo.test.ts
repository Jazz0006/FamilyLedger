import { describe, expect, it } from 'vitest';
import {
  LedgerRequestStatus,
  LedgerRequestType,
  LoanEventType,
  LoanStatus,
  RateSource,
  type LedgerRequestPayload,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { computeRequestFingerprint } from '../domain/request-fingerprint.js';
import { eventIdempotencyKey } from './event-idempotency.js';
import { MemoryRepo } from './memory-repo.js';
import type { NewLedgerRequest, NewLoanEvent } from './repo.js';

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

function request(params?: {
  idempotencyKey?: string;
  amountFen?: number;
  proposerUserId?: string;
  counterpartyUserId?: string;
}): NewLedgerRequest {
  const proposerUserId = params?.proposerUserId ?? 'u1';
  const counterpartyUserId = params?.counterpartyUserId ?? 'u2';
  const payload: LedgerRequestPayload = {
    amountFen: params?.amountFen ?? 1_000,
    proposedEffectiveDate: '2026-09-12',
    note: null,
  };
  const semantic = {
    type: LedgerRequestType.PRINCIPAL_REPAY,
    loanId: 'loan-existing',
    proposerUserId,
    counterpartyUserId,
    requiresInitiatorVerify: false,
    payload,
  } as const;
  return {
    ...semantic,
    status: LedgerRequestStatus.PENDING,
    idempotencyKey: params?.idempotencyKey ?? 'idem-1',
    requestFingerprint: computeRequestFingerprint(semantic),
    createdAt: 100,
    updatedAt: 100,
    resolvedAt: null,
    expiresAt: 1_000,
  };
}

async function createLoan(
  repo: MemoryRepo,
  params?: { lender?: string; borrower?: string; createdAt?: number; requestId?: string },
) {
  return repo.runTransaction((tx) =>
    tx.createLoan({
      lenderUserId: params?.lender ?? 'u1',
      borrowerUserId: params?.borrower ?? 'u2',
      currency: 'CNY',
      ledgerTimezone: 'Asia/Shanghai',
      createdFromRequestId: params?.requestId ?? `create-${Math.random()}`,
      status: LoanStatus.ACTIVE,
      createdAt: params?.createdAt ?? 100,
      closedAt: null,
    }),
  );
}

function event(params: {
  loanId: string;
  sequence: number;
  key: string;
  sourceRequestId?: string;
  amountFen?: number | null;
  eventType?: typeof LoanEventType.PRINCIPAL_ADD | typeof LoanEventType.RATE_CHANGE;
}): NewLoanEvent {
  const eventType = params.eventType ?? LoanEventType.PRINCIPAL_ADD;
  return {
    loanId: params.loanId,
    eventType,
    amountFen:
      eventType === LoanEventType.PRINCIPAL_ADD ? (params.amountFen ?? 1_000) : null,
    rate:
      eventType === LoanEventType.RATE_CHANGE
        ? {
            annualEffectiveRate: '0.03',
            rateSource: RateSource.MANUAL,
          }
        : undefined,
    effectiveDate: '2026-09-12',
    sourceRequestId: params.sourceRequestId ?? 'req-1',
    createdBy: 'u1',
    confirmedBy: 'u2',
    sequence: params.sequence,
    idempotencyKey: params.key,
    createdAt: 100 + params.sequence,
    schemaVersion: 2,
  };
}

describe('MemoryRepo users and requests', () => {
  it('createUserIfOpenidFree behaves like a unique OPENID index under concurrent calls', async () => {
    const repo = new MemoryRepo();
    const value = {
      openid: 'openid-1',
      displayName: 'User',
      createdAt: 1,
      updatedAt: 1,
    };

    const [a, b] = await Promise.all([
      repo.createUserIfOpenidFree(value),
      repo.createUserIfOpenidFree(value),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.item._id).toBe(b.item._id);
  });

  it('same request idempotency key + same fingerprint returns the original request', async () => {
    const repo = new MemoryRepo();
    const first = await repo.createRequestIdempotent(request());
    const retry = await repo.createRequestIdempotent(request());

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.item._id).toBe(first.item._id);
  });

  it('same request idempotency key + different fingerprint conflicts', async () => {
    const repo = new MemoryRepo();
    await repo.createRequestIdempotent(request());

    try {
      await repo.createRequestIdempotent(request({ amountFen: 2_000 }));
      throw new Error('expected conflict');
    } catch (error) {
      expectCode(error, ErrorCode.CONFLICT);
    }
  });
});

describe('MemoryRepo Loan/event persistence', () => {
  it('lists the same user independently in lender and borrower directions', async () => {
    const repo = new MemoryRepo();
    const lent = await createLoan(repo, {
      lender: 'u1',
      borrower: 'u2',
      createdAt: 200,
      requestId: 'create-lent',
    });
    const borrowed = await createLoan(repo, {
      lender: 'u3',
      borrower: 'u1',
      createdAt: 100,
      requestId: 'create-borrowed',
    });

    const receivable = await repo.listLoansForUser({
      userId: 'u1',
      direction: 'LENDER',
      status: LoanStatus.ACTIVE,
      page: { limit: 10 },
    });
    const payable = await repo.listLoansForUser({
      userId: 'u1',
      direction: 'BORROWER',
      status: LoanStatus.ACTIVE,
      page: { limit: 10 },
    });

    expect(receivable.items.map((loan) => loan._id)).toEqual([lent._id]);
    expect(payable.items.map((loan) => loan._id)).toEqual([borrowed._id]);
  });

  it('allocates contiguous unique sequences and paginates events without gaps', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, { requestId: 'create-seq' });

    await repo.runTransaction(async (tx) => {
      const sequences = await tx.allocateEventSequences(loan._id, 5);
      expect(sequences).toEqual([1, 2, 3, 4, 5]);
      for (const sequence of sequences) {
        await tx.appendEventIdempotent(
          event({
            loanId: loan._id,
            sequence,
            key: `event-${sequence}`,
            sourceRequestId: `req-${sequence}`,
          }),
        );
      }
    });

    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await repo.listLoanEvents({
        loanId: loan._id,
        page: { limit: 2, cursor },
      });
      seen.push(...page.items.map((item) => item.sequence));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(seen).size).toBe(5);
  });

  it('allows multiple genesis events to share sourceRequestId', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, { requestId: 'create-genesis' });

    await repo.runTransaction(async (tx) => {
      const [principalSequence, rateSequence] = await tx.allocateEventSequences(
        loan._id,
        2,
      );
      await tx.appendEventIdempotent(
        event({
          loanId: loan._id,
          sequence: principalSequence!,
          key: eventIdempotencyKey('request-genesis', 'initial-principal'),
          sourceRequestId: 'request-genesis',
        }),
      );
      await tx.appendEventIdempotent(
        event({
          loanId: loan._id,
          sequence: rateSequence!,
          key: eventIdempotencyKey('request-genesis', 'initial-rate'),
          sourceRequestId: 'request-genesis',
          eventType: LoanEventType.RATE_CHANGE,
        }),
      );
    });

    const page = await repo.listLoanEvents({
      loanId: loan._id,
      page: { limit: 10 },
    });
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.sourceRequestId)).toEqual([
      'request-genesis',
      'request-genesis',
    ]);
  });

  it('same event idempotency key does not append twice', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, { requestId: 'create-event-idem' });

    await repo.runTransaction(async (tx) => {
      const [sequence] = await tx.allocateEventSequences(loan._id, 1);
      const value = event({
        loanId: loan._id,
        sequence: sequence!,
        key: 'event-idem',
      });
      const first = await tx.appendEventIdempotent(value);
      const second = await tx.appendEventIdempotent(value);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.item._id).toBe(first.item._id);
    });

    const page = await repo.listLoanEvents({
      loanId: loan._id,
      page: { limit: 10 },
    });
    expect(page.items).toHaveLength(1);
  });

  it('same event idempotency key with different content conflicts', async () => {
    const repo = new MemoryRepo();
    const loan = await createLoan(repo, { requestId: 'create-event-conflict' });

    try {
      await repo.runTransaction(async (tx) => {
        const [sequence] = await tx.allocateEventSequences(loan._id, 1);
        const first = event({
          loanId: loan._id,
          sequence: sequence!,
          key: 'event-conflict',
          amountFen: 1_000,
        });
        await tx.appendEventIdempotent(first);
        await tx.appendEventIdempotent({ ...first, amountFen: 2_000 });
      });
      throw new Error('expected conflict');
    } catch (error) {
      expectCode(error, ErrorCode.CONFLICT);
    }

    const page = await repo.listLoanEvents({
      loanId: loan._id,
      page: { limit: 10 },
    });
    expect(page.items).toHaveLength(0);
  });

  it('rolls back every write when a transaction fails', async () => {
    const repo = new MemoryRepo();
    let createdLoanId = '';

    try {
      await repo.runTransaction(async (tx) => {
        const created = await tx.createLoan({
          lenderUserId: 'u1',
          borrowerUserId: 'u2',
          currency: 'CNY',
          ledgerTimezone: 'Asia/Shanghai',
          createdFromRequestId: 'create-rollback',
          status: LoanStatus.ACTIVE,
          createdAt: 1,
          closedAt: null,
        });
        createdLoanId = created._id;
        const [sequence] = await tx.allocateEventSequences(created._id, 1);
        await tx.appendEventIdempotent(
          event({
            loanId: created._id,
            sequence: sequence!,
            key: 'rollback-event',
          }),
        );
        throw new Error('forced failure');
      });
      throw new Error('expected forced failure');
    } catch (error) {
      expect((error as Error).message).toBe('forced failure');
    }

    expect(await repo.getLoan(createdLoanId)).toBeNull();
    const page = await repo.listLoanEvents({
      loanId: createdLoanId,
      page: { limit: 10 },
    });
    expect(page.items).toHaveLength(0);
  });
});
