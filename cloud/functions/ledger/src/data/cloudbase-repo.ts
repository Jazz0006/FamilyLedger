import {
  Collections,
  LedgerRequestStatus,
  type InviteToken,
  type LedgerRequest,
  type Loan,
  type LoanEvent,
  type User,
} from '@family-ledger/shared';
import type { CallContext } from '../context.js';
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
} from './repo.js';

type Db = CallContext['db'];
type DbTransaction = Parameters<Parameters<Db['runTransaction']>[0]>[0];
type DbCommand = Db['command'];

type LoanRecord = Loan & {
  /** Infrastructure-only event sequence counter; never an accounting balance. */
  nextEventSequence: number;
};

function withoutId<T extends { _id: string }>(value: T): Omit<T, '_id'> {
  const { _id: _ignored, ...rest } = value;
  return rest;
}

function extractRows<T>(response: { data?: unknown }): T[] {
  return Array.isArray(response.data) ? (response.data as T[]) : [];
}

function extractOne<T>(response: { data?: unknown }): T | null {
  if (Array.isArray(response.data)) {
    return (response.data[0] as T | undefined) ?? null;
  }
  if (response.data && typeof response.data === 'object') {
    return response.data as T;
  }
  return null;
}

function extractAddedId(response: { id?: unknown; ids?: unknown }): string {
  if (typeof response.id === 'string' && response.id) return response.id;
  if (
    Array.isArray(response.ids) &&
    typeof response.ids[0] === 'string' &&
    response.ids[0]
  ) {
    return response.ids[0];
  }
  throw new AppError(ErrorCode.INTERNAL, 'CloudBase insert did not return an id');
}

function stripLoanRecord(record: LoanRecord): Loan {
  const { nextEventSequence: _ignored, ...loan } = record;
  return loan;
}

function pageFromCreatedAtRows<T extends { createdAt: number; _id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length === limit && last
        ? encodeCreatedAtCursor({ createdAt: last.createdAt, _id: last._id })
        : null,
  };
}

function eventPage(items: LoanEvent[], limit: number): Page<LoanEvent> {
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length === limit && last
        ? encodeSequenceCursor(last.sequence)
        : null,
  };
}

export class CloudBaseRepo implements LedgerRepo {
  constructor(private readonly db: Db) {}

  private async first<T>(collection: string, where: object): Promise<T | null> {
    const response = await this.db.collection(collection).where(where).limit(1).get();
    return extractRows<T>(response)[0] ?? null;
  }

  async getUserByOpenid(openid: string): Promise<User | null> {
    return this.first<User>(Collections.USERS, { openid });
  }

  async createUserIfOpenidFree(user: NewUser): Promise<CreateResult<User>> {
    try {
      const response = await this.db.collection(Collections.USERS).add(user);
      const created: User = { ...user, _id: extractAddedId(response) };
      return { item: created, created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.getUserByOpenid(user.openid);
      if (!existing) throw error;
      return { item: existing, created: false };
    }
  }

  async getLoan(loanId: string): Promise<Loan | null> {
    const record = await this.first<LoanRecord>(Collections.LOANS, { _id: loanId });
    return record ? stripLoanRecord(record) : null;
  }

  async listLoansForUser(
    params: Parameters<LedgerRepo['listLoansForUser']>[0],
  ): Promise<Page<Loan>> {
    validatePageInput(params.page);
    const field = params.direction === 'LENDER' ? 'lenderUserId' : 'borrowerUserId';
    const base: Record<string, unknown> = {
      [field]: params.userId,
      status: params.status,
    };

    const _ = this.db.command;
    let where: object = base;
    if (params.page.cursor) {
      const cursor = decodeCreatedAtCursor(params.page.cursor);
      where = _.or(
        { ...base, createdAt: _.lt(cursor.createdAt) },
        { ...base, createdAt: cursor.createdAt, _id: _.lt(cursor._id) },
      ) as object;
    }

    const response = await this.db
      .collection(Collections.LOANS)
      .where(where)
      .orderBy('createdAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(params.page.limit)
      .get();
    const rows = extractRows<LoanRecord>(response).map(stripLoanRecord);
    return pageFromCreatedAtRows(rows, params.page.limit);
  }

  async getRequest(requestId: string): Promise<LedgerRequest | null> {
    return this.first<LedgerRequest>(Collections.LEDGER_REQUESTS, { _id: requestId });
  }

  async getRequestByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LedgerRequest | null> {
    return this.first<LedgerRequest>(Collections.LEDGER_REQUESTS, {
      idempotencyKey,
    });
  }

  async createRequestIdempotent(
    request: NewLedgerRequest,
  ): Promise<CreateResult<LedgerRequest>> {
    try {
      const response = await this.db
        .collection(Collections.LEDGER_REQUESTS)
        .add(request);
      const created: LedgerRequest = {
        ...request,
        _id: extractAddedId(response),
      };
      return { item: created, created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.getRequestByIdempotencyKey(
        request.idempotencyKey,
      );
      if (!existing) throw error;
      assertMatchingRequestFingerprint({
        storedFingerprint: existing.requestFingerprint,
        incomingFingerprint: request.requestFingerprint,
      });
      return { item: existing, created: false };
    }
  }

  async listActionableRequestsForUser(
    params: Parameters<LedgerRepo['listActionableRequestsForUser']>[0],
  ): Promise<Page<LedgerRequest>> {
    validatePageInput(params.page);
    const _ = this.db.command;
    const actionable = _.or(
      {
        status: LedgerRequestStatus.PENDING,
        counterpartyUserId: params.userId,
      },
      {
        status: LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
        proposerUserId: params.userId,
      },
    );

    let where: object = actionable as object;
    if (params.page.cursor) {
      const cursor = decodeCreatedAtCursor(params.page.cursor);
      const afterCursor = _.or(
        { createdAt: _.lt(cursor.createdAt) },
        { createdAt: cursor.createdAt, _id: _.lt(cursor._id) },
      );
      where = _.and(actionable, afterCursor) as object;
    }

    const response = await this.db
      .collection(Collections.LEDGER_REQUESTS)
      .where(where)
      .orderBy('createdAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(params.page.limit)
      .get();
    return pageFromCreatedAtRows(
      extractRows<LedgerRequest>(response),
      params.page.limit,
    );
  }

  async listLoanEvents(
    params: Parameters<LedgerRepo['listLoanEvents']>[0],
  ): Promise<Page<LoanEvent>> {
    validatePageInput(params.page);
    const afterSequence = params.page.cursor
      ? decodeSequenceCursor(params.page.cursor)
      : 0;
    const response = await this.db
      .collection(Collections.LOAN_EVENTS)
      .where({
        loanId: params.loanId,
        sequence: this.db.command.gt(afterSequence),
      })
      .orderBy('sequence', 'asc')
      .limit(params.page.limit)
      .get();
    return eventPage(extractRows<LoanEvent>(response), params.page.limit);
  }

  async createInvite(invite: NewInviteToken): Promise<InviteToken> {
    const response = await this.db
      .collection(Collections.INVITE_TOKENS)
      .add(invite);
    return { ...invite, _id: extractAddedId(response) };
  }

  async getInviteByHash(tokenHash: string): Promise<InviteToken | null> {
    return this.first<InviteToken>(Collections.INVITE_TOKENS, { tokenHash });
  }

  async appendAudit(entry: NewAuditLog): Promise<void> {
    await this.db.collection(Collections.AUDIT_LOGS).add(entry);
  }

  async runTransaction<T>(
    work: (tx: LedgerTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.runTransaction(async (transaction) =>
      work(new CloudBaseTransaction(transaction, this.db.command)),
    );
  }
}

class CloudBaseTransaction implements LedgerTransaction {
  private readonly sequenceCache = new Map<string, number>();

  constructor(
    private readonly transaction: DbTransaction,
    private readonly command: DbCommand,
  ) {}

  private async first<T>(collection: string, where: object): Promise<T | null> {
    const response = await this.transaction
      .collection(collection)
      .where(where)
      .limit(1)
      .get();
    return extractRows<T>(response)[0] ?? null;
  }

  async getRequest(requestId: string): Promise<LedgerRequest | null> {
    return this.first<LedgerRequest>(Collections.LEDGER_REQUESTS, {
      _id: requestId,
    });
  }

  async putRequest(request: LedgerRequest): Promise<void> {
    await this.transaction
      .collection(Collections.LEDGER_REQUESTS)
      .doc(request._id)
      .update(withoutId(request));
  }

  async getLoan(loanId: string): Promise<Loan | null> {
    const record = await this.first<LoanRecord>(Collections.LOANS, {
      _id: loanId,
    });
    return record ? stripLoanRecord(record) : null;
  }

  async createLoan(loan: NewLoan): Promise<Loan> {
    const response = await this.transaction.collection(Collections.LOANS).add({
      ...loan,
      nextEventSequence: 1,
    });
    return { ...loan, _id: extractAddedId(response) };
  }

  async putLoan(loan: Loan): Promise<void> {
    // Partial update preserves the infrastructure-only nextEventSequence field.
    await this.transaction
      .collection(Collections.LOANS)
      .doc(loan._id)
      .update(withoutId(loan));
  }

  async listLoanEvents(
    params: Parameters<LedgerTransaction['listLoanEvents']>[0],
  ): Promise<Page<LoanEvent>> {
    validatePageInput(params.page);
    const afterSequence = params.page.cursor
      ? decodeSequenceCursor(params.page.cursor)
      : 0;
    const response = await this.transaction
      .collection(Collections.LOAN_EVENTS)
      .where({
        loanId: params.loanId,
        sequence: this.command.gt(afterSequence),
      })
      .orderBy('sequence', 'asc')
      .limit(params.page.limit)
      .get();
    return eventPage(extractRows<LoanEvent>(response), params.page.limit);
  }

  async allocateEventSequences(loanId: string, count: number): Promise<number[]> {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Sequence allocation count must be positive',
      );
    }

    let start = this.sequenceCache.get(loanId);
    if (start == null) {
      const response = await this.transaction
        .collection(Collections.LOANS)
        .doc(loanId)
        .get();
      const record = extractOne<LoanRecord>(response);
      if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Loan not found');
      start = record.nextEventSequence ?? 1;
    }

    const next = start + count;
    this.sequenceCache.set(loanId, next);
    await this.transaction
      .collection(Collections.LOANS)
      .doc(loanId)
      .update({ nextEventSequence: next });
    return Array.from({ length: count }, (_, index) => start! + index);
  }

  async appendEventIdempotent(
    event: NewLoanEvent,
  ): Promise<CreateResult<LoanEvent>> {
    const existing = await this.first<LoanEvent>(Collections.LOAN_EVENTS, {
      idempotencyKey: event.idempotencyKey,
    });
    if (existing) {
      assertSameEventMutation(existing, event);
      return { item: existing, created: false };
    }

    const response = await this.transaction
      .collection(Collections.LOAN_EVENTS)
      .add(event);
    return {
      item: { ...event, _id: extractAddedId(response) },
      created: true,
    };
  }

  async getInvite(inviteId: string): Promise<InviteToken | null> {
    return this.first<InviteToken>(Collections.INVITE_TOKENS, {
      _id: inviteId,
    });
  }

  async putInvite(invite: InviteToken): Promise<void> {
    await this.transaction
      .collection(Collections.INVITE_TOKENS)
      .doc(invite._id)
      .update(withoutId(invite));
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as { code?: string | number; message?: string };
  const code = String(candidate?.code ?? '');
  const message = candidate?.message ?? '';
  return (
    code.includes('DUPLICATE') ||
    code === '11000' ||
    /duplicate key/i.test(message)
  );
}
