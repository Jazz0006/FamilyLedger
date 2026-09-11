import type { IsoDate } from '@family-ledger/shared';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Effective dates are plain calendar dates in the ledger timezone
 * (Asia/Shanghai). Because we only ever diff *whole calendar days*, we can
 * anchor each date at UTC midnight and subtract — the timezone offset cancels
 * out and there is no DST in Asia/Shanghai anyway. This keeps day counts
 * identical across frontend, backend, and tests.
 */
function toUtcMidnight(date: IsoDate): number {
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`Invalid IsoDate (expected YYYY-MM-DD): ${date}`);
  }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  // Guard against silent normalization of impossible dates like 2026-02-31.
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return ms;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `from` to `to` (to - from). Same date => 0.
 * Negative if `to` precedes `from`.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / MS_PER_DAY);
}

/** True if `a <= b` as calendar dates. */
export function isOnOrBefore(a: IsoDate, b: IsoDate): boolean {
  return toUtcMidnight(a) <= toUtcMidnight(b);
}

/** Returns the calendar date one day before `date`. */
export function previousDay(date: IsoDate): IsoDate {
  const d = new Date(toUtcMidnight(date) - MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}
