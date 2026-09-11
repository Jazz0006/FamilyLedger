import {
  Collections,
  type AuditLog,
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
