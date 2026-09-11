/** Business role of a user (spec §4). */
export const UserRole = {
  BORROWER: 'BORROWER',
  LENDER: 'LENDER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Immutable ledger event types (spec §13). Interest is NOT an event —
 * it is computed from principal + rate + dates (spec Rule E).
 */
export const LoanEventType = {
  /** Principal increased (money lent to 曾骏). */
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  /** Principal repaid (曾骏 returned money). */
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  /** Annual effective rate changed from an effective date. */
  RATE_CHANGE: 'RATE_CHANGE',
  /** Append-only correction of a prior mistaken event (spec Rule C). */
  CORRECTION: 'CORRECTION',
} as const;
export type LoanEventType = (typeof LoanEventType)[keyof typeof LoanEventType];

/**
 * Change-request lifecycle (spec §13, canonical naming).
 * PENDING -> APPLIED | REJECTED | CANCELLED.
 * APPLIED must be atomic with creating the corresponding loan_event.
 */
export const ChangeRequestStatus = {
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ChangeRequestStatus =
  (typeof ChangeRequestStatus)[keyof typeof ChangeRequestStatus];

/** The kind of change a request proposes. Maps to a LoanEventType on APPLIED. */
export const ChangeRequestType = {
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  RATE_CHANGE: 'RATE_CHANGE',
  CORRECTION: 'CORRECTION',
} as const;
export type ChangeRequestType =
  (typeof ChangeRequestType)[keyof typeof ChangeRequestType];

export const LoanAccountStatus = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
} as const;
export type LoanAccountStatus =
  (typeof LoanAccountStatus)[keyof typeof LoanAccountStatus];

export const CompoundingMode = {
  DAILY: 'DAILY',
} as const;
export type CompoundingMode =
  (typeof CompoundingMode)[keyof typeof CompoundingMode];
