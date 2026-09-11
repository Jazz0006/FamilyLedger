import { beforeEach, describe, expect, it } from 'vitest';
import { LoanEventType } from '@family-ledger/shared';
import { recordLodgment } from './recordLodgment.js';
import { makeFamily, type Fixture } from './test-helpers.js';

const YUAN = 100;

describe('recordLodgment', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFamily();
  });

  it('admin records a lodgment: creates one PRINCIPAL_ADD event effective today', async () => {
    const res = await recordLodgment(fx.ctxFor(fx.admin.openid), {
      loanId: fx.momLoan._id,
      amountFen: 20_000 * YUAN,
      idempotencyKey: 'key-abcdef-1',
    });

    expect(res.created).toBe(true);
    expect(res.effectiveDate).toBe('2026-01-01'); // now = 2026-01-01T04:00Z
    expect(fx.repo.events).toHaveLength(1);
    const ev = fx.repo.events[0]!;
    expect(ev.eventType).toBe(LoanEventType.PRINCIPAL_ADD);
    expect(ev.amountFen).toBe(20_000 * YUAN);
    expect(ev.loanId).toBe(fx.momLoan._id);
    // Audit trail written.
    expect(fx.repo.audits).toHaveLength(1);
    expect(fx.repo.audits[0]!.action).toBe('recordLodgment');
  });

  it('is idempotent: same key twice creates only one event', async () => {
    const input = {
      loanId: fx.momLoan._id,
      amountFen: 20_000 * YUAN,
      idempotencyKey: 'key-abcdef-2',
    };
    const first = await recordLodgment(fx.ctxFor(fx.admin.openid), input);
    const second = await recordLodgment(fx.ctxFor(fx.admin.openid), input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.loanEventId).toBe(first.loanEventId);
    expect(fx.repo.events).toHaveLength(1);
  });

  it('rejects a non-admin (lender) with FORBIDDEN', async () => {
    await expect(
      recordLodgment(fx.ctxFor(fx.mom.openid), {
        loanId: fx.momLoan._id,
        amountFen: 20_000 * YUAN,
        idempotencyKey: 'key-abcdef-3',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fx.repo.events).toHaveLength(0);
  });

  it('rejects an unbound caller with NOT_BOUND', async () => {
    await expect(
      recordLodgment(fx.ctxFor('openid_stranger'), {
        loanId: fx.momLoan._id,
        amountFen: 1000,
        idempotencyKey: 'key-abcdef-4',
      }),
    ).rejects.toMatchObject({ code: 'NOT_BOUND' });
  });

  it('rejects non-positive or non-integer amounts', async () => {
    for (const bad of [0, -100, 12.5]) {
      await expect(
        recordLodgment(fx.ctxFor(fx.admin.openid), {
          loanId: fx.momLoan._id,
          amountFen: bad,
          idempotencyKey: 'key-bad-' + bad,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('rejects a loan outside the family / not found', async () => {
    await expect(
      recordLodgment(fx.ctxFor(fx.admin.openid), {
        loanId: 'loan_nonexistent',
        amountFen: 1000,
        idempotencyKey: 'key-abcdef-5',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
