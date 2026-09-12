import { describe, expect, it } from 'vitest';
import { LoanEventType, type LoanEvent } from '@family-ledger/shared';
import { CloudBaseRepo } from './cloudbase-repo.js';

type DbParam = ConstructorParameters<typeof CloudBaseRepo>[0];

function event(sequence: number): LoanEvent {
  return {
    _id: `event-${sequence}`,
    loanId: 'loan-1',
    eventType: LoanEventType.PRINCIPAL_ADD,
    amountFen: 100,
    effectiveDate: '2026-09-12',
    sourceRequestId: `request-${sequence}`,
    createdBy: 'u1',
    confirmedBy: 'u2',
    sequence,
    idempotencyKey: `event-key-${sequence}`,
    createdAt: sequence,
    schemaVersion: 2,
  };
}

function fakeDb(events: LoanEvent[]) {
  let requestedLimit = 0;

  const query = {
    where: () => query,
    orderBy: () => query,
    limit: (limit: number) => {
      requestedLimit = limit;
      return query;
    },
    get: async () => ({ data: events.slice(0, requestedLimit || events.length) }),
    add: async () => ({ id: 'created-id' }),
    doc: () => ({
      get: async () => ({ data: null }),
      update: async () => ({ updated: 1 }),
    }),
  };

  const transaction = { collection: () => query };
  const db = {
    command: {
      gt: (value: unknown) => ({ op: 'gt', value }),
      lt: (value: unknown) => ({ op: 'lt', value }),
      or: (...values: unknown[]) => ({ op: 'or', values }),
      and: (...values: unknown[]) => ({ op: 'and', values }),
    },
    collection: () => query,
    runTransaction: async <T>(work: (tx: typeof transaction) => Promise<T>) =>
      work(transaction),
  };

  return {
    db: db as unknown as DbParam,
    requestedLimit: () => requestedLimit,
  };
}

describe('CloudBaseRepo adapter contract', () => {
  it('never asks node-sdk for more than the requested 100-row page', async () => {
    const fixture = fakeDb(Array.from({ length: 100 }, (_, index) => event(index + 1)));
    const repo = new CloudBaseRepo(fixture.db);

    const page = await repo.listLoanEvents({
      loanId: 'loan-1',
      page: { limit: 100 },
    });

    expect(fixture.requestedLimit()).toBe(100);
    expect(page.items).toHaveLength(100);
    // A full bounded page advertises another cursor. If this is the exact last
    // 100 rows, the following read is simply empty rather than truncating data.
    expect(page.nextCursor).not.toBeNull();
  });

  it('supports the same bounded event pagination inside a transaction snapshot', async () => {
    const fixture = fakeDb(Array.from({ length: 100 }, (_, index) => event(index + 1)));
    const repo = new CloudBaseRepo(fixture.db);

    const page = await repo.runTransaction((tx) =>
      tx.listLoanEvents({
        loanId: 'loan-1',
        page: { limit: 100 },
      }),
    );

    expect(fixture.requestedLimit()).toBe(100);
    expect(page.items).toHaveLength(100);
    expect(page.items[0]?.sequence).toBe(1);
    expect(page.items[99]?.sequence).toBe(100);
    expect(page.nextCursor).not.toBeNull();
  });

  it('returns the node-sdk 3.x runTransaction callback value directly', async () => {
    const fixture = fakeDb([]);
    const repo = new CloudBaseRepo(fixture.db);

    await expect(repo.runTransaction(async () => 'transaction-result')).resolves.toBe(
      'transaction-result',
    );
  });
});
