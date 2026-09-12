/** Days per year used to derive the daily compounding rate. */
export const DAYS_PER_YEAR = 365;

/** Fixed ledger day boundary for the v2 migration baseline. */
export const LEDGER_TIMEZONE = 'Asia/Shanghai' as const;

/** v2 MVP currency. */
export const CURRENCY = 'CNY' as const;

/** Every newly written v2 formal event carries schema version 2. */
export const LOAN_EVENT_SCHEMA_VERSION = 2 as const;

/** First-contact invite validity window. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
