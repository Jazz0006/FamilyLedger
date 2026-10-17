import type {
  InviteStatus,
  LedgerRequestStatus,
  LedgerRequestType,
  LoanEventType,
  LoanStatus,
  RateSource,
} from './enums.js';

export type UserId = string;
export type LoanId = string;
export type RequestId = string;
export type EventId = string;
export type InviteId = string;

/** Calendar date in the ledger timezone, formatted YYYY-MM-DD. */
export type IsoDate = string;

/** Trusted server timestamp, epoch milliseconds UTC. */
export type EpochMillis = number;

/** Integer Chinese cents. Business validation must also require safe integer. */
export type Fen = number;

/** Decimal string, for example "0.026" for 2.6%. */
export type AnnualEffectiveRate = string;

export interface User {
  _id: UserId;
  openid: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}

export interface Loan {
  _id: LoanId;
  lenderUserId: UserId;
  borrowerUserId: UserId;
  currency: 'CNY';
  ledgerTimezone: 'Asia/Shanghai';
  createdFromRequestId: RequestId;
  status: LoanStatus;
  createdAt: EpochMillis;
  closedAt: EpochMillis | null;
}

export interface RateSnapshot {
  annualEffectiveRate: AnnualEffectiveRate;
  rateSource: RateSource;
  rateReferenceYear?: number | null;
  rateReferenceLabel?: string | null;
}

export interface CreateLoanPayload {
  borrowerUserId: UserId | null;
  lenderUserId: UserId | null;
  unknownPartyRole: 'BORROWER' | 'LENDER' | null;
  initialPrincipalFen: Fen;
  rate: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface PrincipalAddPayload {
  amountFen: Fen;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface PrincipalRepayPayload {
  amountFen: Fen;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface RateChangePayload {
  rate: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface CorrectionPayload {
  targetEventId: EventId;
  principalDeltaFen?: Fen;
  replacementRate?: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  reason?: string | null;
}

export interface CloseLoanPayload {
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export type LedgerRequestPayload =
  | CreateLoanPayload
  | PrincipalAddPayload
  | PrincipalRepayPayload
  | RateChangePayload
  | CorrectionPayload
  | CloseLoanPayload;

export interface LedgerRequest {
  _id: RequestId;
  type: LedgerRequestType;
  loanId: LoanId | null;
  proposerUserId: UserId;
  counterpartyUserId: UserId | null;
  payload: LedgerRequestPayload;
  status: LedgerRequestStatus;
  requiresInitiatorVerify: boolean;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
  resolvedAt: EpochMillis | null;
  expiresAt: EpochMillis | null;
}

export interface LoanEvent {
  _id: EventId;
  loanId: LoanId;
  eventType: LoanEventType;
  amountFen: Fen | null;
  rate?: RateSnapshot;
  targetEventId?: EventId | null;
  effectiveDate: IsoDate;
  sourceRequestId: RequestId;
  createdBy: UserId;
  confirmedBy: UserId;
  sequence: number;
  idempotencyKey: string;
  createdAt: EpochMillis;
  schemaVersion: 2;
}

export interface InviteToken {
  _id: InviteId;
  requestId: RequestId;
  tokenHash: string;
  status: InviteStatus;
  createdByUserId: UserId;
  claimedByUserId: UserId | null;
  createdAt: EpochMillis;
  claimedAt: EpochMillis | null;
  expiresAt: EpochMillis;
  revokedAt: EpochMillis | null;
}

export interface AuditLog {
  _id: string;
  actorOpenId: string | null;
  actorUserId: UserId | null;
  action: string;
  targetId: string | null;
  requestId: RequestId | null;
  result: 'OK' | 'DENIED' | 'ERROR';
  detail?: string;
  serverTime: EpochMillis;
}

export interface UserHomeSummary {
  receivable: {
    principalFen: Fen;
    interestFen: Fen;
    totalFen: Fen;
    loanCount: number;
  };
  payable: {
    principalFen: Fen;
    interestFen: Fen;
    totalFen: Fen;
    loanCount: number;
  };
  pendingRequestCount: number;
}

export interface LoanSummary {
  loanId: LoanId;
  lenderUserId: UserId;
  borrowerUserId: UserId;
  principalFen: Fen;
  interestFen: Fen;
  totalFen: Fen;
  todayInterestFen: Fen;
  currentRate: RateSnapshot;
  asOfDate: IsoDate;
}
