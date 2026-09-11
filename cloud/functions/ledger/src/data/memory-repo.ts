import type {
  AuditLog,
  LoanAccount,
  LoanEvent,
  User,
} from '@family-ledger/shared';
import type { LedgerRepo } from './repo.js';

/**
 * In-memory LedgerRepo for unit tests. Mirrors the production invariants that
 * matter to business logic: append-only events and a unique idempotencyKey.
 * Not for production use.
 */
export class MemoryRepo implements LedgerRepo {
  users: User[] = [];
  accounts: LoanAccount[] = [];
  events: LoanEvent[] = [];
  audits: AuditLog[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async getUserByOpenid(openid: string): Promise<User | null> {
    return this.users.find((u) => u.openid === openid) ?? null;
  }

  async listUsersInFamily(familyId: string): Promise<User[]> {
    return this.users.filter((u) => u.familyId === familyId);
  }

  async getLoanAccount(loanId: string): Promise<LoanAccount | null> {
    return this.accounts.find((a) => a._id === loanId) ?? null;
  }

  async listLoanAccountsInFamily(familyId: string): Promise<LoanAccount[]> {
    return this.accounts.filter((a) => a.familyId === familyId);
  }

  async listEvents(loanId: string): Promise<LoanEvent[]> {
    return this.events.filter((e) => e.loanId === loanId);
  }

  async appendEventIdempotent(
    event: Omit<LoanEvent, '_id'>,
  ): Promise<{ event: LoanEvent; created: boolean }> {
    const existing = this.events.find(
      (e) => e.idempotencyKey === event.idempotencyKey,
    );
    if (existing) return { event: existing, created: false };
    const created: LoanEvent = { ...event, _id: this.nextId('evt') };
    this.events.push(created);
    return { event: created, created: true };
  }

  async appendAudit(entry: Omit<AuditLog, '_id'>): Promise<void> {
    this.audits.push({ ...entry, _id: this.nextId('aud') });
  }
}
