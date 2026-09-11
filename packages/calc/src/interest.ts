import {
  DAYS_PER_YEAR,
  DEFAULT_ANNUAL_EFFECTIVE_RATE,
  type IsoDate,
} from '@family-ledger/shared';
import { Decimal, toFen } from './decimal-config.js';
import { daysBetween, isOnOrBefore } from './dates.js';

/**
 * Derive the daily compounding rate from an annual effective rate.
 * r = (1 + annual)^(1/365) - 1  (spec Rule D).
 * Held at full Decimal precision — never pre-rounded.
 */
export function dailyRate(annualEffectiveRate: string): Decimal {
  const annual = new Decimal(annualEffectiveRate);
  return annual.plus(1).pow(new Decimal(1).div(DAYS_PER_YEAR)).minus(1);
}

/**
 * The inputs the interest engine needs, expressed purely as confirmed ledger
 * facts. The engine is deterministic and side-effect free: given the same
 * segments and asOf date it always returns the same 分 amounts.
 *
 * DAY-BOUNDARY CONVENTION (pinned):
 *   A principal that becomes effective on date D accrues its FIRST day of
 *   interest for the transition D -> D+1. Therefore on date == effectiveDate
 *   the elapsed day count is 0 and the balance equals the bare principal
 *   (spec §11: "新本金只从其生效日起参与计息" — interpreted as: present from
 *   the effective date, first growth realised the following day). Repayments
 *   effective on date D stop accruing from D onward (same convention).
 */
export interface PrincipalSegment {
  /** Signed principal delta in 分: positive add, negative repayment. */
  deltaFen: number;
  effectiveDate: IsoDate;
}

export interface RatePeriod {
  annualEffectiveRate: string;
  effectiveFrom: IsoDate;
}

export interface InterestInput {
  principalSegments: PrincipalSegment[];
  /** Ordered rate periods. If empty, DEFAULT_ANNUAL_EFFECTIVE_RATE is used. */
  ratePeriods?: RatePeriod[];
  /** The date to value the balance at (inclusive). */
  asOf: IsoDate;
}

export interface BalanceBreakdown {
  /** Sum of signed principal deltas effective on/before asOf, in 分. */
  principalFen: number;
  /** Accrued interest in 分 = totalDue - principal. */
  interestFen: number;
  /** Current amount 曾骏 owes, in 分 (principal + interest). */
  totalDueFen: number;
}

/**
 * Compute the amount due at `asOf` by compounding each principal segment
 * forward day-by-day at the applicable daily rate, at FULL precision, and
 * quantising to 分 exactly once at the end (spec §18 determinism).
 *
 * V1 assumes a single flat rate for the whole loan (the common case). Rate
 * changes are modelled by `ratePeriods`; if multiple periods are supplied the
 * daily rate is selected per-day by effective date.
 */
export function computeBalance(input: InterestInput): BalanceBreakdown {
  const { asOf } = input;
  const ratePeriods =
    input.ratePeriods && input.ratePeriods.length > 0
      ? [...input.ratePeriods].sort((a, b) =>
          a.effectiveFrom < b.effectiveFrom ? -1 : 1,
        )
      : [{ annualEffectiveRate: DEFAULT_ANNUAL_EFFECTIVE_RATE, effectiveFrom: '0000-01-01' }];

  // Precompute daily rate per period.
  const dailyByPeriod = ratePeriods.map((p) => ({
    from: p.effectiveFrom,
    r: dailyRate(p.annualEffectiveRate),
  }));

  const rateForDate = (date: IsoDate): Decimal => {
    let chosen = dailyByPeriod[0]!.r;
    for (const p of dailyByPeriod) {
      if (isOnOrBefore(p.from, date)) chosen = p.r;
      else break;
    }
    return chosen;
  };

  const segments = input.principalSegments.filter((s) =>
    isOnOrBefore(s.effectiveDate, asOf),
  );

  let principalFen = 0;
  let totalDue = new Decimal(0);

  for (const seg of segments) {
    principalFen += seg.deltaFen;
    const days = daysBetween(seg.effectiveDate, asOf);
    // Compound this segment's delta forward over its lifetime. When rate is
    // flat this is delta * (1+r)^days; with rate periods we step day-by-day.
    let value = new Decimal(seg.deltaFen);
    if (dailyByPeriod.length === 1) {
      value = value.mul(dailyByPeriod[0]!.r.plus(1).pow(days));
    } else {
      let cursor = seg.effectiveDate;
      for (let i = 0; i < days; i++) {
        value = value.mul(rateForDate(cursor).plus(1));
        cursor = addOneDay(cursor);
      }
    }
    totalDue = totalDue.plus(value);
  }

  const totalDueFen = toFen(totalDue);
  return {
    principalFen,
    totalDueFen,
    interestFen: totalDueFen - principalFen,
  };
}

function addOneDay(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return next.toISOString().slice(0, 10);
}

/**
 * "今日增加" (spec §11): interest growth realised between yesterday and asOf,
 * separated from any principal change so a new 20,000 add is never mislabelled
 * as today's interest. Returns the pure interest delta in 分.
 */
export function interestGrowthOn(
  input: InterestInput,
  previousDate: IsoDate,
): number {
  const today = computeBalance(input);
  const yesterday = computeBalance({ ...input, asOf: previousDate });
  const todayInterestOnPriorPrincipal =
    today.totalDueFen - today.principalFen;
  const yesterdayInterest = yesterday.totalDueFen - yesterday.principalFen;
  return todayInterestOnPriorPrincipal - yesterdayInterest;
}
