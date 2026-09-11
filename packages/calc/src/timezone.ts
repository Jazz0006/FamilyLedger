import type { IsoDate } from '@family-ledger/shared';

/**
 * Convert an epoch-millis instant to the calendar date (YYYY-MM-DD) observed
 * in the given IANA timezone. Uses Intl so DST/offset rules are correct; for
 * Asia/Shanghai (fixed UTC+8, no DST) this is simply the local date.
 *
 * This is how the server decides "today" for effective dates and the
 * "今日增加" boundary (spec §11) — never from the client.
 */
export function isoDateInTimezone(
  epochMillis: number,
  timeZone: string,
): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMillis));
  return parts;
}
