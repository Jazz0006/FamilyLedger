import { DAYS_PER_YEAR, type IsoDate } from '@family-ledger/shared';
import { Decimal, toFen } from './decimal-config.js';
import { daysBetween, isOnOrBefore } from './dates.js';

/**
 * Derive the daily compounding rate from an annual effective rate.
 * r = (1 + annual)^(1/365) - 1.
 */
export function dailyRate(annualEffectiveRate: string): Decimal {
  const annual = new Decimal(annualEffectiveRate);
  return annual.plus(1).pow(new Decimal(1).div(DAYS_PER_YEAR)).minus(1);
}

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
  /**
   * v2 requires explicit confirmed rate history. CREATE_LOAN writes an initial
   * RATE_CHANGE event, including when the agreed rate is zero.
   */
  ratePeriods: RatePeriod[];
  /** The date to value the balance at (inclusive). */
  asOf: IsoDate;
}

export interface BalanceBreakdown {
  principalFen: number;
  interestFen: number;
  totalDueFen: number;
}

/**
 * Compute the amount due at `asOf` from confirmed principal/rate history.
 * There is deliberately no product-level fallback rate in v2: a missing rate
 * history is invalid ledger state and must fail loudly rather than silently
 * applying the old v1.1 5% default.
 */
export function computeBalance(input: InterestInput): BalanceBreakdown {
  const { asOf } = input;
  if (input.ratePeriods.length === 0) {
    throw new Error('Missing confirmed rate history');
  }

  const ratePeriods = [...input.ratePeriods].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );

  const dailyByPeriod = ratePeriods.map((p) => ({
    from: p.effectiveFrom,
    r: dailyRate(p.annualEffectiveRate),
  }));

  const rateForDate = (date: IsoDate): Decimal => {
    let chosen: Decimal | null = null;
    for (const p of dailyByPeriod) {
      if (isOnOrBefore(p.from, date)) chosen = p.r;
      else break;
    }
    if (chosen == null) {
      throw new Error(`No confirmed rate is effective on ${date}`);
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
    let value = new Decimal(seg.deltaFen);

    if (dailyByPeriod.length === 1) {
      // Validate that the one confirmed rate is actually effective for this
      // segment before taking the flat-rate fast path.
      const r = rateForDate(seg.effectiveDate);
      value = value.mul(r.plus(1).pow(days));
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
 * Interest growth realised between `previousDate` and `input.asOf`, excluding
 * same-day principal movement from the reported interest delta.
 */
export function interestGrowthOn(
  input: InterestInput,
  previousDate: IsoDate,
): number {
  const today = computeBalance(input);
  const yesterday = computeBalance({ ...input, asOf: previousDate });
  const todayInterestOnPriorPrincipal = today.totalDueFen - today.principalFen;
  const yesterdayInterest = yesterday.totalDueFen - yesterday.principalFen;
  return todayInterestOnPriorPrincipal - yesterdayInterest;
}
