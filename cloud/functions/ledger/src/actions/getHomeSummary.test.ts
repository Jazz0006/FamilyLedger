import { beforeEach, describe, expect, it } from 'vitest';
import { recordLodgment } from './recordLodgment.js';
import { getHomeSummary } from './getHomeSummary.js';
import { makeFamily, type Fixture } from './test-helpers.js';

const YUAN = 100;
// One year after the lodgments so interest is observable (365 days).
const ONE_YEAR_LATER = Date.UTC(2027, 0, 1, 4, 0, 0);

describe('getHomeSummary', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = makeFamily();
    // Admin lends 100k to mom and 50k to dad, both on 2026-01-01.
    await recordLodgment(fx.ctxFor(fx.admin.openid), {
      loanId: fx.momLoan._id,
      amountFen: 100_000 * YUAN,
      idempotencyKey: 'seed-mom',
    });
    await recordLodgment(fx.ctxFor(fx.admin.openid), {
      loanId: fx.dadLoan._id,
      amountFen: 50_000 * YUAN,
      idempotencyKey: 'seed-dad',
    });
  });

  it("shows a lender their own summary with interest after a year", async () => {
    const summary = await getHomeSummary(fx.ctxFor(fx.mom.openid, ONE_YEAR_LATER));
    expect(summary.mine).not.toBeNull();
    expect(summary.mine!.displayName).toBe('妈妈');
    expect(summary.mine!.principalFen).toBe(100_000 * YUAN);
    // 5% effective over a full year -> 105,000.
    expect(summary.mine!.totalDueFen).toBe(105_000 * YUAN);
    expect(summary.mine!.interestFen).toBe(5_000 * YUAN);
    expect(summary.mine!.annualEffectiveRate).toBe('0.05');
    // Today's interest is positive but tiny relative to principal.
    expect(summary.mine!.todayInterestFen).toBeGreaterThan(0);
  });

  it('includes the whole-family roll-up and total for every member', async () => {
    const summary = await getHomeSummary(fx.ctxFor(fx.mom.openid, ONE_YEAR_LATER));
    const names = summary.family.map((f) => f.displayName).sort();
    expect(names).toEqual(['妈妈', '爸爸'].sort());
    // Family total = 105,000 (mom) + 52,500 (dad) = 157,500.
    expect(summary.familyTotalDueFen).toBe(157_500 * YUAN);
  });

  it('gives the admin the family roll-up but no personal "mine"', async () => {
    const summary = await getHomeSummary(fx.ctxFor(fx.admin.openid, ONE_YEAR_LATER));
    expect(summary.mine).toBeNull();
    expect(summary.family).toHaveLength(2);
  });

  it('does not leak other members\' line items (roll-up is summary only)', async () => {
    const summary = await getHomeSummary(fx.ctxFor(fx.mom.openid, ONE_YEAR_LATER));
    // Family entries expose only display name + summary figures.
    for (const entry of summary.family) {
      expect(Object.keys(entry).sort()).toEqual(
        ['displayName', 'principalFen', 'totalDueFen'].sort(),
      );
    }
  });

  it('reflects a fresh lodgment immediately (derived from events)', async () => {
    // Same-day view before the year passes: principal shows, interest ~0.
    const summary = await getHomeSummary(fx.ctxFor(fx.mom.openid));
    expect(summary.mine!.principalFen).toBe(100_000 * YUAN);
    expect(summary.mine!.totalDueFen).toBe(100_000 * YUAN);
    expect(summary.mine!.interestFen).toBe(0);
  });
});
