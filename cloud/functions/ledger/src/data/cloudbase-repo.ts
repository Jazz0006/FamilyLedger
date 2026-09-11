import {
  Collections,
  UserRole,
  type AuditLog,
  type InviteToken,
  type LoanAccount,
  type LoanEvent,
  type User,
} from '@family-ledger/shared';
import type { CallContext } from '../context.js';
import type { LedgerRepo } from './repo.js';

type Db = CallContext['db'];

/**
 * Production LedgerRepo backed by CloudBase. Relies on these DB-level
 * invariants (create in the console, see cloud/README.md):
 *  - loan_events.idempotencyKey  UNIQUE
 *  - users.openid                UNIQUE
 * The unique index on idempotencyKey is what makes appendEventIdempotent safe
 * under retries: a duplicate insert is rejected by the DB, and we resolve it
 * to the pre-existing event.
 */
export class CloudBaseRepo implements LedgerRepo {
  constructor(private readonly db: Db) {}

  private async first<T>(collection: string, query: object): Promise<T | null> {
    const res = await this.db.collection(collection).where(query).limit(1).get();
    const rows = (res.data ?? []) as T[];
    return rows[0] ?? null;
  }

  private async all<T>(collection: string, query: object): Promise<T[]> {
    const res = await this.db.collection(collection).where(query).get();
    return (res.data ?? []) as T[];
  }

  getUserByOpenid(openid: string): Promise<User | null> {
    return this.first<User>(Collections.USERS, { openid });
  }

  listUsersInFamily(familyId: string): Promise<User[]> {
    return this.all<User>(Collections.USERS, { familyId });
  }

  getLoanAccount(loanId: string): Promise<LoanAccount | null> {
    return this.first<LoanAccount>(Collections.LOAN_ACCOUNTS, { _id: loanId });
  }

  listLoanAccountsInFamily(familyId: string): Promise<LoanAccount[]> {
    return this.all<LoanAccount>(Collections.LOAN_ACCOUNTS, { familyId });
  }

  listEvents(loanId: string): Promise<LoanEvent[]> {
    return this.all<LoanEvent>(Collections.LOAN_EVENTS, { loanId });
  }

  async appendEventIdempotent(
    event: Omit<LoanEvent, '_id'>,
  ): Promise<{ event: LoanEvent; created: boolean }> {
    try {
      const res = await this.db.collection(Collections.LOAN_EVENTS).add(event);
      const id = (res.id ?? res.ids?.[0]) as string;
      return { event: { ...event, _id: id }, created: true };
    } catch (err) {
      // Unique-index violation on idempotencyKey => the event already exists.
      // Resolve to it so retries are safe (spec §15). If the failure was NOT a
      // duplicate-key error, rethrow.
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await this.first<LoanEvent>(Collections.LOAN_EVENTS, {
        idempotencyKey: event.idempotencyKey,
      });
      if (!existing) throw err;
      return { event: existing, created: false };
    }
  }

  async appendAudit(entry: Omit<AuditLog, '_id'>): Promise<void> {
    await this.db.collection(Collections.AUDIT_LOGS).add(entry);
  }

  async borrowerExists(): Promise<boolean> {
    const res = await this.db
      .collection(Collections.USERS)
      .where({ role: UserRole.BORROWER })
      .limit(1)
      .get();
    return (res.data ?? []).length > 0;
  }

  async createUserIfOpenidFree(
    user: Omit<User, '_id'>,
  ): Promise<{ user: User; created: boolean }> {
    try {
      const res = await this.db.collection(Collections.USERS).add(user);
      const id = (res.id ?? res.ids?.[0]) as string;
      return { user: { ...user, _id: id }, created: true };
    } catch (err) {
      // Unique index on users.openid rejected a second bind of this openid.
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await this.first<User>(Collections.USERS, {
        openid: user.openid,
      });
      if (!existing) throw err;
      return { user: existing, created: false };
    }
  }

  async createLoanAccount(
    account: Omit<LoanAccount, '_id'>,
  ): Promise<LoanAccount> {
    const res = await this.db.collection(Collections.LOAN_ACCOUNTS).add(account);
    const id = (res.id ?? res.ids?.[0]) as string;
    return { ...account, _id: id };
  }

  async createInvite(invite: Omit<InviteToken, '_id'>): Promise<InviteToken> {
    const res = await this.db.collection(Collections.INVITE_TOKENS).add(invite);
    const id = (res.id ?? res.ids?.[0]) as string;
    return { ...invite, _id: id };
  }

  getInviteByHash(tokenHash: string): Promise<InviteToken | null> {
    return this.first<InviteToken>(Collections.INVITE_TOKENS, { tokenHash });
  }

  async consumeInvite(
    inviteId: string,
    usedAt: number,
    consumedUserId: string,
  ): Promise<boolean> {
    // Compare-and-set: only update rows still unused. `updated` counts matched
    // docs, so 1 => this caller won, 0 => already consumed (spec §7).
    const res = await this.db
      .collection(Collections.INVITE_TOKENS)
      .where({ _id: inviteId, usedAt: null })
      .update({ usedAt, consumedUserId });
    return (res.updated ?? 0) > 0;
  }
}

/** CloudBase surfaces duplicate-key as a specific error code/message. */
function isDuplicateKeyError(err: unknown): boolean {
  const anyErr = err as { code?: string | number; message?: string };
  const code = String(anyErr?.code ?? '');
  const msg = anyErr?.message ?? '';
  return (
    code.includes('DUPLICATE') ||
    code === '11000' ||
    /duplicate key/i.test(msg)
  );
}
