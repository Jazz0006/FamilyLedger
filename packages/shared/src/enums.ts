export const LoanStatus = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
} as const;
export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];

export const RateSource = {
  CPI_REFERENCE: 'CPI_REFERENCE',
  MANUAL: 'MANUAL',
} as const;
export type RateSource = (typeof RateSource)[keyof typeof RateSource];

export const LedgerRequestType = {
  CREATE_LOAN: 'CREATE_LOAN',
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  RATE_CHANGE: 'RATE_CHANGE',
  CORRECTION: 'CORRECTION',
  CLOSE_LOAN: 'CLOSE_LOAN',
} as const;
export type LedgerRequestType =
  (typeof LedgerRequestType)[keyof typeof LedgerRequestType];

export const LedgerRequestStatus = {
  PENDING: 'PENDING',
  PENDING_INITIATOR_VERIFY: 'PENDING_INITIATOR_VERIFY',
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type LedgerRequestStatus =
  (typeof LedgerRequestStatus)[keyof typeof LedgerRequestStatus];

export const LoanEventType = {
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  RATE_CHANGE: 'RATE_CHANGE',
  CORRECTION: 'CORRECTION',
  LOAN_CLOSED: 'LOAN_CLOSED',
} as const;
export type LoanEventType = (typeof LoanEventType)[keyof typeof LoanEventType];

export const InviteStatus = {
  ACTIVE: 'ACTIVE',
  CLAIMED: 'CLAIMED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];
