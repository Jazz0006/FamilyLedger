import type {
  AuditLog,
  InviteToken,
  LedgerRequest,
  Loan,
  LoanEvent,
  LoanStatus,
  User,
  UserId,
} from '@family-ledger/shared';

export const MAX_PAGE_SIZE = 100;

export interface PageInput {
  limit: number;
  cursor?: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type LoanDirection = 'LENDER' | 'BORROWER';

export type NewUser = Omit<User, '_id'>;
export type NewLedgerRequest = Omit<LedgerRequest, '_id'>;
export type NewInviteToken = Omit<InviteToken, '_id'>;
export type NewLoan = Omit<Loan, '_id'>;
export type NewLoanEvent = Omit<LoanEvent, '_id'>;
export type NewAuditLog = Omit<AuditLog, '_id'>;

export interface CreateResult<T> {
  item: T;
  created: boolean;
}

/**
 * Transaction-scoped persistence operations used by request-application
 * actions. All balance-sensitive reads that protect a formal mutation must use
 * this snapshot rather than reading through the outer repository.
 */
export interface LedgerTransaction {
  getRequest(requestId: string): Promise<LedgerRequest | null>;
  putRequest(request: LedgerRequest): Promise<void>;

  getLoan(loanId: string): Promise<Loan | null>;
  createLoan(loan: NewLoan): Promise<Loan>;
  /** Persist the typed Loan lifecycle projection inside the same business transaction. */
  putLoan(loan: Loan): Promise<void>;

  listLoanEvents(params: {
    loanId: string;
    page: PageInput;
  }): Promise<Page<LoanEvent>>;

  /**
   * Reserve contiguous event sequence numbers for one Loan. Sequence allocation
   * must be atomic with the formal event append that consumes the numbers.
   */
  allocateEventSequences(loanId: string, count: number): Promise<number[]>;
  appendEventIdempotent(event: NewLoanEvent): Promise<CreateResult<LoanEvent>>;

  getInvite(inviteId: string): Promise<InviteToken | null>;
  putInvite(invite: InviteToken): Promise<void>;
}

/**
 * v2 persistence contract. It intentionally exposes only capabilities needed by
 * application use cases; it is not a generic ORM abstraction.
 */
export interface LedgerRepo {
  getUserByOpenid(openid: string): Promise<User | null>;
  createUserIfOpenidFree(user: NewUser): Promise<CreateResult<User>>;

  getLoan(loanId: string): Promise<Loan | null>;
  listLoansForUser(params: {
    userId: UserId;
    direction: LoanDirection;
    status: LoanStatus;
    page: PageInput;
  }): Promise<Page<Loan>>;

  getRequest(requestId: string): Promise<LedgerRequest | null>;
  getRequestByIdempotencyKey(idempotencyKey: string): Promise<LedgerRequest | null>;
  createRequestIdempotent(
    request: NewLedgerRequest,
  ): Promise<CreateResult<LedgerRequest>>;
  listActionableRequestsForUser(params: {
    userId: UserId;
    page: PageInput;
  }): Promise<Page<LedgerRequest>>;

  listLoanEvents(params: {
    loanId: string;
    page: PageInput;
  }): Promise<Page<LoanEvent>>;

  createInvite(invite: NewInviteToken): Promise<InviteToken>;
  getInviteByHash(tokenHash: string): Promise<InviteToken | null>;

  appendAudit(entry: NewAuditLog): Promise<void>;

  runTransaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T>;
}
