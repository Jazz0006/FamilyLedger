import { describe, expect, it } from 'vitest';
import { Collections } from '@family-ledger/shared';
import {
  V2_REQUIRED_COLLECTIONS,
  V2_REQUIRED_INDEXES,
  buildCreateIndexesCommands,
} from './schema-contract.js';

describe('v2 persistence index contract', () => {
  it('declares every core runtime collection exactly once', () => {
    expect(V2_REQUIRED_COLLECTIONS).toEqual([
      Collections.USERS,
      Collections.LOANS,
      Collections.LEDGER_REQUESTS,
      Collections.LOAN_EVENTS,
      Collections.INVITE_TOKENS,
      Collections.AUDIT_LOGS,
    ]);
    expect(new Set(V2_REQUIRED_COLLECTIONS).size).toBe(
      V2_REQUIRED_COLLECTIONS.length,
    );
    expect(V2_REQUIRED_COLLECTIONS).not.toContain(Collections.RATE_REFERENCES);
  });

  it('keeps request and event idempotency keys unique', () => {
    expect(
      V2_REQUIRED_INDEXES.find(
        (index) =>
          index.collection === Collections.LEDGER_REQUESTS &&
          index.fields[0]?.field === 'idempotencyKey',
      )?.unique,
    ).toBe(true);
    expect(
      V2_REQUIRED_INDEXES.find(
        (index) =>
          index.collection === Collections.LOAN_EVENTS &&
          index.fields[0]?.field === 'idempotencyKey',
      )?.unique,
    ).toBe(true);
  });

  it('keeps (loanId, sequence) unique', () => {
    const index = V2_REQUIRED_INDEXES.find(
      (candidate) => candidate.name === 'uniq_loan_sequence',
    );
    expect(index?.unique).toBe(true);
    expect(index?.fields.map((field) => field.field)).toEqual([
      'loanId',
      'sequence',
    ]);
  });

  it('does NOT make sourceRequestId unique because CREATE_LOAN creates two genesis events', () => {
    const index = V2_REQUIRED_INDEXES.find(
      (candidate) => candidate.name === 'source_request_lookup',
    );
    expect(index?.unique).toBe(false);
    expect(index?.fields.map((field) => field.field)).toEqual([
      'sourceRequestId',
    ]);
  });

  it('includes _id as createdAt cursor tie-breaker for growing lists', () => {
    const cursorIndexes = V2_REQUIRED_INDEXES.filter((index) =>
      index.name.endsWith('_created_cursor'),
    );
    expect(cursorIndexes.length).toBeGreaterThan(0);
    for (const index of cursorIndexes) {
      expect(index.fields.slice(-2).map((field) => field.field)).toEqual([
        'createdAt',
        '_id',
      ]);
    }
  });

  it('builds Mongo createIndexes commands directly from the authoritative contract', () => {
    const commands = buildCreateIndexesCommands();
    const loanCommand = commands.find(
      (command) => command.createIndexes === Collections.LOANS,
    );
    expect(loanCommand?.indexes).toContainEqual({
      name: 'lender_status_created_cursor',
      unique: false,
      key: {
        lenderUserId: 1,
        status: 1,
        createdAt: -1,
        _id: -1,
      },
    });

    const allGeneratedNames = commands.flatMap((command) =>
      command.indexes.map((index) => index.name),
    );
    expect(allGeneratedNames).toEqual(
      V2_REQUIRED_INDEXES.map((index) => index.name),
    );
  });
});
