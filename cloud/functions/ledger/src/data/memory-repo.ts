import type {
  AuditLog,
  InviteToken,
  LedgerRequest,
  Loan,
  LoanEvent,
  User,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { assertMatchingRequestFingerprint } from '../domain/request-fingerprint.js';
import {
  decodeCreatedAtCursor,
  decodeSequenceCursor,
  encodeCreatedAtCursor,
  encodeSequenceCursor,
  validatePageInput,
} from './cursor.js';
import { assertSameEventMutation } from './event-idempotency.js';
import type {
  CreateResult,
  LedgerRepo,
  LedgerTransaction,
  NewAuditLog,
  NewInviteToken,
  NewLedgerRequest,
  NewLoan,
  NewLoanEvent,
  NewUser,
  Page,
  PageInput,
} from './repo.js';

interface MemoryState {
  users: Map<string, User>;
  loans: Map<string, Loan>;
  requests: Map<string, LedgerRequest>;
  events: Map<string, LoanEvent>;
  invites: Map<string, InviteToken>;
  audits: Map<string, AuditLog>;
  nextEventSequence: Map<string, number>;
  counters: Record<string, number>;
}

function emptyState(): MemoryState {
  return {
    users: new Map(),
    loans: new Map(),
    requests: new Map(),
    events: new Map(),
    invites: new Map(),
    audits: new Map(),
    nextEventSequence: new Map(),
    counters: {},
  };
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map(
    [...source.entries()].map(([key, value]) => [key, cloneValue(value)]),
  );
}

function cloneState(source: MemoryState): MemoryState {
  return {
    users: cloneMap(source.users),
    loans: cloneMap(source.loans),
    requests: cloneMap(source.requests),
    events: cloneMap(source.events),
    invites: cloneMap(source.invites),
    audits: cloneMap(source.audits),
    nextEventSequence: new Map(source.nextEventSequence),
    counters: { ...source.counters },
  };
}

function nextId(state: MemoryState, prefix: string): string {
  const next = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = next;
  return `${prefix}-${next}`;
}

function pageCreatedAt<T extends { createdAt: number; _id: string }>(
  rows: T[],
  page: PageInput,
): Page<T> {
  validatePageInput(page);
  let filtered = [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return b._id.localeCompare(a._id);
  });

  if (page.cursor) {
    const cursor = decodeCreatedAtCursor(page.cursor);
    filtered = filtered.filter(
      (row) =>
        row.createdAt < cursor.createdAt ||
        (row.createdAt === cursor.createdAt && row._id < cursor._id),
    );
  }

  const hasMore = filtered.length > page.limit;
  const items = filtered.slice(0, page.limit).map(cloneValue);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCreatedAtCursor({ createdAt: last.createdAt, _id: last._id })
        : null,
  };
}

function pageLoanEvents(
  state: MemoryState,
  params: { loanId: string; page: PageInput },
): Page<LoanEvent> {
  validatePageInput(params.page);
  const afterSequence = params.page.cursor
    ? decodeSequenceCursor(params.page.cursor)
    : 0;
  const rows = [...state.events.values()]
    .filter(
      (event) =>
        event.loanId === params.loanId && event.sequence > afterSequence,
    )
    .sort((a, b) => a.sequence - b.sequence);
  const hasMore = rows.length > params.page.limit;
  const items = rows.slice(0, params.page.limit).map(cloneValue);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? encodeSequenceCursor(last.sequence) : null,
  };
}

export class MemoryRepo implements LedgerRepo {
  private state: MemoryState = emptyState();
  private transactionTail: Promise<void> = Promise.resolve();

  async getUserByOpenid(openid: string): Promise<User | null> {
    const found = [...this.state.users.values()].find(
      (user) => user.openid === openid,
    );
    return found ? cloneValue(found) : null;
  }

  async getUserById(userId: string): Promise<User | null> {
    const user = this.state.users.get(userId);
    return user ? cloneValue(user) : null;
  }

  async createUserIfOpenidFree(user: NewUser): Promise<CreateResult<User>> {
    const existing = [...this.state.users.values()].find(
      (item) => item.openid === user.openid,
    );
    if (existing) return { item: cloneValue(existing), created: false };

    const created: User = {
      ...cloneValue(user),
      _id: nextId(this.state, 'user'),
    };
    this.state.users.set(created._id, created);
    return { item: cloneValue(created), created: true };
  }

  async getLoan(loanId: string): Promise<Loan | null> {
    const loan = this.state.loans.get(loanId);
    return loan ? cloneValue(loan) : null;
  }

  async listLoansForUser(
    params: Parameters<LedgerRepo['listLoansForUser']>[0],
  ): Promise<Page<Loan>> {
    const field =
      params.direction === 'LENDER' ? 'lenderUserId' : 'borrowerUserId';
    return pageCreatedAt(
      [...this.state.loans.values()].filter(
        (loan) =>
          loan[field] === params.userId && loan.status === params.status,
      ),
      params.page,
    );
  }

  async getRequest(requestId: string): Promise<LedgerRequest | null> {
    const request = this.state.requests.get(requestId);
    return request ? cloneValue(request) : null;
  }

  async getRequestByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerRequest | null> {
    const request = [...this.state.requests.values()].find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    return request ? cloneValue(request) : null;
  }

  async createRequestIdempotent(
    request: NewLedgerRequest,
  ): Promise<CreateResult<LedgerRequest>> {
    const existing = [...this.state.requests.values()].find(
      (item) => item.idempotencyKey === request.idempotencyKey,
    );
    if (existing) {
      assertMatchingRequestFingerprint({
        storedFingerprint: existing.requestFingerprint,
        incomingFingerprint: request.requestFingerprint,
      });
      return { item: cloneValue(existing), created: false };
    }

    const created: LedgerRequest = {
      ...cloneValue(request),
      _id: nextId(this.state, 'request'),
    };
    this.state.requests.set(created._id, created);
    return { item: cloneValue(created), created: true };
  }

  async listActionableRequestsForUser(
    params: Parameters<LedgerRepo['listActionableRequestsForUser']>[0],
  ): Promise<Page<LedgerRequest>> {
    return pageCreatedAt(
      [...this.state.requests.values()].filter(
        (request) =>
          (request.status === 'PENDING' &&
            request.counterpartyUserId === params.userId) ||
          (request.status === 'PENDING_INITIATOR_VERIFY' &&
            request.proposerUserId === params.userId),
      ),
      params.page,
    );
  }

  async listLoanEvents(
    params: Parameters<LedgerRepo['listLoanEvents']>[0],
  ): Promise<Page<LoanEvent>> {
    return pageLoanEvents(this.state, params);
  }

  async createInvite(invite: NewInviteToken): Promise<InviteToken> {
    if (
      [...this.state.invites.values()].some(
        (item) => item.tokenHash === invite.tokenHash,
      )
    ) {
      throw new AppError(ErrorCode.CONFLICT, 'Invite token hash already exists');
    }
    const created: InviteToken = {
      ...cloneValue(invite),
      _id: nextId(this.state, 'invite'),
    };
    this.state.invites.set(created._id, created);
    return cloneValue(created);
  }

  async getInviteByHash(tokenHash: string): Promise<InviteToken | null> {
    const invite = [...this.state.invites.values()].find(
      (item) => item.tokenHash === tokenHash,
    );
    return invite ? cloneValue(invite) : null;
  }

  async appendAudit(entry: NewAuditLog): Promise<void> {
    const audit: AuditLog = {
      ...cloneValue(entry),
      _id: nextId(this.state, 'audit'),
    };
    this.state.audits.set(audit._id, audit);
  }

  async runTransaction<T>(
    work: (tx: LedgerTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const working = cloneState(this.state);
    try {
      const result = await work(new MemoryTransaction(working));
      this.state = working;
      return result;
    } finally {
      release();
    }
  }
}

class MemoryTransaction implements LedgerTransaction {
  constructor(private readonly state: MemoryState) {}

  async getRequest(requestId: string): Promise<LedgerRequest | null> {
    const request = this.state.requests.get(requestId);
    return request ? cloneValue(request) : null;
  }

  async putRequest(request: LedgerRequest): Promise<void> {
    if (!this.state.requests.has(request._id)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'LedgerRequest not found');
    }
    this.state.requests.set(request._id, cloneValue(request));
  }

  async getLoan(loanId: string): Promise<Loan | null> {
    const loan = this.state.loans.get(loanId);
    return loan ? cloneValue(loan) : null;
  }

  async createLoan(loan: NewLoan): Promise<Loan> {
    if (
      [...this.state.loans.values()].some(
        (item) => item.createdFromRequestId === loan.createdFromRequestId,
      )
    ) {
      throw new AppError(ErrorCode.CONFLICT, 'Loan already exists for request');
    }
    const created: Loan = {
      ...cloneValue(loan),
      _id: nextId(this.state, 'loan'),
    };
    this.state.loans.set(created._id, created);
    this.state.nextEventSequence.set(created._id, 1);
    return cloneValue(created);
  }

  async putLoan(loan: Loan): Promise<void> {
    if (!this.state.loans.has(loan._id)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
    }
    this.state.loans.set(loan._id, cloneValue(loan));
  }

  async listLoanEvents(params: {
    loanId: string;
    page: PageInput;
  }): Promise<Page<LoanEvent>> {
    return pageLoanEvents(this.state, params);
  }

  async allocateEventSequences(
    loanId: string,
    count: number,
  ): Promise<number[]> {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Sequence allocation count must be positive',
      );
    }
    if (!this.state.loans.has(loanId)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
    }
    const start = this.state.nextEventSequence.get(loanId) ?? 1;
    this.state.nextEventSequence.set(loanId, start + count);
    return Array.from({ length: count }, (_, index) => start + index);
  }

  async appendEventIdempotent(
    event: NewLoanEvent,
  ): Promise<CreateResult<LoanEvent>> {
    const existing = [...this.state.events.values()].find(
      (item) => item.idempotencyKey === event.idempotencyKey,
    );
    if (existing) {
      assertSameEventMutation(existing, event);
      return { item: cloneValue(existing), created: false };
    }

    if (
      [...this.state.events.values()].some(
        (item) =>
          item.loanId === event.loanId && item.sequence === event.sequence,
      )
    ) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Loan event sequence already exists',
      );
    }

    const created: LoanEvent = {
      ...cloneValue(event),
      _id: nextId(this.state, 'event'),
    };
    this.state.events.set(created._id, created);
    return { item: cloneValue(created), created: true };
  }

  async getInvite(inviteId: string): Promise<InviteToken | null> {
    const invite = this.state.invites.get(inviteId);
    return invite ? cloneValue(invite) : null;
  }

  async putInvite(invite: InviteToken): Promise<void> {
    if (!this.state.invites.has(invite._id)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'InviteToken not found');
    }
    if (
      [...this.state.invites.values()].some(
        (item) =>
          item._id !== invite._id && item.tokenHash === invite.tokenHash,
      )
    ) {
      throw new AppError(ErrorCode.CONFLICT, 'Invite token hash already exists');
    }
    this.state.invites.set(invite._id, cloneValue(invite));
  }
}
