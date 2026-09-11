import type {
  ChangeRequestStatus,
  ChangeRequestType,
  CompoundingMode,
  LoanAccountStatus,
  LoanEventType,
  UserRole,
} from './enums.js';

/**
 * A calendar date in the ledger timezone, as an ISO date string `YYYY-MM-DD`.
 * Interest day boundaries are computed from this in Asia/Shanghai. We store a
 * plain date (not a timestamp) so effective dates are unambiguous.
 */
export type IsoDate = string;

/** Server timestamp, epoch milliseconds (UTC). */
export type EpochMillis = number;

/** Money is always integer 分 (cents). Never a float. (spec Rule G) */
export type Fen = number;

export interface User {
  _id: string;
  openid: string;
  displayName: string;
  role: UserRole;
  familyId: string;
  boundAt: EpochMillis | null;
}

export interface LoanAccount {
  _id: string;
  familyId: string;
  lenderUserId: string;
  borrowerUserId: string;
  currency: string;
  status: LoanAccountStatus;
}

export interface LoanTerm {
  _id: string;
  loanId: string;
  /** Annual effective rate as a decimal string, e.g. "0.05". */
  annualEffectiveRate: string;
  compounding: CompoundingMode;
  effectiveFrom: IsoDate;
  createdBy: string;
  confirmedAt: EpochMillis;
}

export interface ChangeRequest {
  _id: string;
  loanId: string;
  type: ChangeRequestType;
  /** Present for principal changes; null for pure rate changes. */
  amountFen: Fen | null;
  /** For RATE_CHANGE requests: proposed new annual effective rate string. */
  proposedRate?: string;
  proposedEffectiveDate: IsoDate;
  requestedBy: string;
  requiredConfirmer: string;
  status: ChangeRequestStatus;
  /** Client-generated UUID; unique index prevents double-submit (spec §15). */
  idempotencyKey: string;
  createdAt: EpochMillis;
  resolvedAt: EpochMillis | null;
}

/**
 * Immutable ledger event. Never updated or deleted (spec Rule C).
 * `amountFen` meaning depends on eventType; `rate` present for RATE_CHANGE.
 */
export interface LoanEvent {
  _id: string;
  loanId: string;
  eventType: LoanEventType;
  amountFen: Fen | null;
  /** For RATE_CHANGE: new annual effective rate as a decimal string. */
  rate?: string;
  effectiveDate: IsoDate;
  /** The change_request that produced this event (null for genesis/system). */
  sourceRequestId: string | null;
  createdBy: string;
  confirmedBy: string;
  createdAt: EpochMillis;
  /** For forward migration safety. */
  schemaVersion: number;
}

export interface InviteToken {
  _id: string;
  targetUserId: string;
  tokenHash: string;
  expiresAt: EpochMillis;
  usedAt: EpochMillis | null;
}

export interface AuditLog {
  _id: string;
  actorOpenId: string | null;
  actorUserId: string | null;
  action: string;
  targetId: string | null;
  requestId: string | null;
  result: 'OK' | 'DENIED' | 'ERROR';
  detail?: string;
  serverTime: EpochMillis;
}
