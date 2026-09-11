import type {
  LoanAccount,
  LoanEvent,
  User,
} from '@family-ledger/shared';

/**
 * Data-access boundary. Actions depend on this interface, NOT the CloudBase
 * SDK directly, so business logic is unit-testable with an in-memory fake and
 * the production wiring is swappable. All methods are server-side only.
 */
export interface LedgerRepo {
  /** Resolve the caller's user record from their WeChat OPENID. */
  getUserByOpenid(openid: string): Promise<User | null>;

  /** All users in a family (for the family roll-up). */
  listUsersInFamily(familyId: string): Promise<User[]>;

  getLoanAccount(loanId: string): Promise<LoanAccount | null>;

  /** All active loan accounts in a family. */
  listLoanAccountsInFamily(familyId: string): Promise<LoanAccount[]>;

  /** Every immutable event for a loan, any order (caller sorts if needed). */
  listEvents(loanId: string): Promise<LoanEvent[]>;

  /**
   * Append an immutable event IFF its idempotencyKey has not been used before
   * (unique index on loan_events.idempotencyKey). Returns the created event,
   * or the pre-existing event if the key was already used — making retries and
   * double-taps safe (spec §15). Never updates or deletes (Rule C).
   */
  appendEventIdempotent(
    event: Omit<LoanEvent, '_id'>,
  ): Promise<{ event: LoanEvent; created: boolean }>;

  /** Append-only audit record (spec §15). */
  appendAudit(entry: {
    actorOpenId: string | null;
    actorUserId: string | null;
    action: string;
    targetId: string | null;
    requestId: string | null;
    result: 'OK' | 'DENIED' | 'ERROR';
    detail?: string;
    serverTime: number;
  }): Promise<void>;
}
