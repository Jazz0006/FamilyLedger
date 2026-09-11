import { describe, expect, it } from 'vitest';
import { isoDateInTimezone } from './timezone.js';

const TZ = 'Asia/Shanghai';

describe('isoDateInTimezone (Asia/Shanghai, UTC+8)', () => {
  it('maps a UTC afternoon to the same calendar day', () => {
    // 2026-09-11T04:00:00Z -> 12:00 Beijing, same date.
    const ms = Date.UTC(2026, 8, 11, 4, 0, 0);
    expect(isoDateInTimezone(ms, TZ)).toBe('2026-09-11');
  });

  it('rolls over to the next day for late-UTC instants (>=16:00Z)', () => {
    // 2026-09-11T16:30:00Z -> 00:30 Beijing on the 12th.
    const ms = Date.UTC(2026, 8, 11, 16, 30, 0);
    expect(isoDateInTimezone(ms, TZ)).toBe('2026-09-12');
  });

  it('handles the 23:30 vs 00:30 local boundary consistently', () => {
    // 23:30 Beijing on the 11th == 15:30Z on the 11th.
    expect(isoDateInTimezone(Date.UTC(2026, 8, 11, 15, 30), TZ)).toBe(
      '2026-09-11',
    );
    // 00:30 Beijing on the 12th == 16:30Z on the 11th.
    expect(isoDateInTimezone(Date.UTC(2026, 8, 11, 16, 30), TZ)).toBe(
      '2026-09-12',
    );
  });
});
