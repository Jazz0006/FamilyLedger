import { Collections, type IsoDate } from '@family-ledger/shared';
import { computeBalance, interestGrowthOn, previousDay } from '@family-ledger/calc';
import type { CallContext } from '../context.js';

export interface HomeSummary {
  /** The current user's own loan summary. */
  mine: {
    displayName: string;
    principalFen: number;
    interestFen: number;
    totalDueFen: number;
    todayInterestFen: number;
    annualEffectiveRate: string;
  } | null;
  /** Family roll-up: every member's current totals (spec §6). */
  family: Array<{
    displayName: string;
    principalFen: number;
    totalDueFen: number;
  }>;
  familyTotalDueFen: number;
  asOf: IsoDate;
}

/**
 * Read-only home screen data (spec §8). Shows the caller's own detailed
 * summary plus the family roll-up. Detailed per-transaction history is NOT
 * included here — that is private and lives in the "my detail" action.
 *
 * TODO(impl): resolve caller via users collection, load their loan account +
 * events, compute via @family-ledger/calc, then load sibling accounts within
 * the same familyId for the roll-up (summary figures only, no line items).
 */
export async function getHomeSummary(ctx: CallContext): Promise<HomeSummary> {
  void ctx;
  void Collections;
  void computeBalance;
  void interestGrowthOn;
  void previousDay;
  throw new Error('NOT_IMPLEMENTED: getHomeSummary');
}
