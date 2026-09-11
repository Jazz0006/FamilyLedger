/**
 * Product baseline constants (spec §5 Rule D, §11). Changing any of these
 * changes money outputs and MUST be accompanied by regenerating the golden
 * test vectors in @family-ledger/calc and a spec version bump.
 */

/** V1 baseline annual effective rate: 5.00%. Stored as a string for Decimal. */
export const DEFAULT_ANNUAL_EFFECTIVE_RATE = '0.05';

/** Days per year used to derive the daily compounding rate. */
export const DAYS_PER_YEAR = 365;

/**
 * Canonical timezone for "natural day" boundaries used in interest accrual
 * and the "今日增加" delta (spec §11). Pinned; do not change without
 * regenerating golden vectors.
 */
export const LEDGER_TIMEZONE = 'Asia/Shanghai';

/** Currency. V1 is single-currency (spec §21 defers multi-currency). */
export const CURRENCY = 'CNY';

/** Current loan_events schema version, stamped on every new event (spec §12). */
export const LOAN_EVENT_SCHEMA_VERSION = 1;

/**
 * V1 is a single family (spec §4, §9). We use one fixed familyId rather than a
 * families collection; multi-family is deferred. All scoping still goes through
 * familyId so a future migration to multiple families is a data change, not a
 * logic rewrite.
 */
export const DEFAULT_FAMILY_ID = 'family-default';

/** One-time invite validity window: 7 days (spec §7 — tokens expire). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
