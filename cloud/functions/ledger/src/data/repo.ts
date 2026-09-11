import type {
  InviteToken,
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

  // --- Onboarding ---------------------------------------------------------

  /** Does a BORROWER/admin already exist anywhere? Guards the bootstrap. */
  borrowerExists(): Promise<boolean>;

  /**
   * Create a user IFF the openid is unused (unique index on users.openid).
   * Returns the created user, or the existing one if that openid was already
   * bound — making the bind idempotent and preventing one WeChat account from
   * binding twice (spec §7).
   */
  createUserIfOpenidFree(
    user: Omit<User, '_id'>,
  ): Promise<{ user: User; created: boolean }>;

  createLoanAccount(account: Omit<LoanAccount, '_id'>): Promise<LoanAccount>;

  createInvite(invite: Omit<InviteToken, '_id'>): Promise<InviteToken>;

  getInviteByHash(tokenHash: string): Promise<InviteToken | null>;

  /**
   * Atomically mark an invite consumed IFF it is still unused (compare-and-set
   * on usedAt == null). Returns true if THIS caller won the race, false if it
   * was already consumed. Guarantees one-time use under concurrency (spec §7).
   */
  consumeInvite(
    inviteId: string,
    usedAt: number,
    consumedUserId: string,
  ): Promise<boolean>;
}
