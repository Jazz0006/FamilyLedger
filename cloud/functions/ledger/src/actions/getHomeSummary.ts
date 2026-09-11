import {
  DEFAULT_ANNUAL_EFFECTIVE_RATE,
  LoanEventType,
  UserRole,
  type IsoDate,
} from '@family-ledger/shared';
import {
  computeBalance,
  interestGrowthOn,
  isoDateInTimezone,
  previousDay,
  toInterestInput,
} from '@family-ledger/calc';
import { requireUser, type ActionContext } from './action-context.js';

export interface HomeSummary {
  /** The current user's own loan summary (null if caller has no loan). */
  mine: {
    displayName: string;
    principalFen: number;
    interestFen: number;
    totalDueFen: number;
    todayInterestFen: number;
    annualEffectiveRate: string;
  } | null;
  /** Family roll-up: every member's current totals only (spec §6). */
  family: Array<{
    displayName: string;
    principalFen: number;
    totalDueFen: number;
  }>;
  familyTotalDueFen: number;
  asOf: IsoDate;
}

/**
 * Read-only home screen data (spec §8). Returns the caller's own summary plus
 * the family roll-up (summary figures only — never other members' line items,
 * spec §6). All money is computed via @family-ledger/calc from the immutable
 * event stream; nothing is read from a stored balance.
 */
export async function getHomeSummary(ctx: ActionContext): Promise<HomeSummary> {
  const user = await requireUser(ctx);
  const asOf = isoDateInTimezone(ctx.now, ctx.timeZone);
  const yesterday = previousDay(asOf);

  const accounts = await ctx.repo.listLoanAccountsInFamily(user.familyId);
  const users = await ctx.repo.listUsersInFamily(user.familyId);
  const nameByUserId = new Map(users.map((u) => [u._id, u.displayName]));

  // Compute each account's current balance from its events.
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const events = await ctx.repo.listEvents(account._id);
      const input = toInterestInput(events, asOf);
      const balance = computeBalance(input);
      const lenderName =
        nameByUserId.get(account.lenderUserId) ?? account.lenderUserId;
      return { account, events, input, balance, lenderName };
    }),
  );

  const family = perAccount.map((a) => ({
    displayName: a.lenderName,
    principalFen: a.balance.principalFen,
    totalDueFen: a.balance.totalDueFen,
  }));
  const familyTotalDueFen = family.reduce((s, m) => s + m.totalDueFen, 0);

  // "Mine": for a lender it's their own account; the borrower/admin sees the
  // family roll-up but has no personal lender account.
  let mine: HomeSummary['mine'] = null;
  if (user.role === UserRole.LENDER) {
    const own = perAccount.find((a) => a.account.lenderUserId === user._id);
    if (own) {
      const todayInterestFen = interestGrowthOn(own.input, yesterday);
      mine = {
        displayName: user.displayName,
        principalFen: own.balance.principalFen,
        interestFen: own.balance.interestFen,
        totalDueFen: own.balance.totalDueFen,
        todayInterestFen,
        annualEffectiveRate: currentRate(own.events),
      };
    }
  }

  return { mine, family, familyTotalDueFen, asOf };
}

/** The most recent rate in effect, or the default if none set. */
function currentRate(
  events: { eventType: string; rate?: string; effectiveDate: IsoDate }[],
): string {
  const rateEvents = events
    .filter((e) => e.eventType === LoanEventType.RATE_CHANGE && e.rate)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  return rateEvents.length > 0
    ? rateEvents[rateEvents.length - 1]!.rate!
    : DEFAULT_ANNUAL_EFFECTIVE_RATE;
}
