import {
  UserRole,
  type AuditLog,
  type InviteToken,
  type LoanAccount,
  type LoanEvent,
  type User,
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
  invites: InviteToken[] = [];
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

  async borrowerExists(): Promise<boolean> {
    return this.users.some((u) => u.role === UserRole.BORROWER);
  }

  async createUserIfOpenidFree(
    user: Omit<User, '_id'>,
  ): Promise<{ user: User; created: boolean }> {
    const existing = user.openid
      ? this.users.find((u) => u.openid === user.openid)
      : undefined;
    if (existing) return { user: existing, created: false };
    const created: User = { ...user, _id: this.nextId('usr') };
    this.users.push(created);
    return { user: created, created: true };
  }

  async createLoanAccount(
    account: Omit<LoanAccount, '_id'>,
  ): Promise<LoanAccount> {
    const created: LoanAccount = { ...account, _id: this.nextId('loan') };
    this.accounts.push(created);
    return created;
  }

  async createInvite(invite: Omit<InviteToken, '_id'>): Promise<InviteToken> {
    const created: InviteToken = { ...invite, _id: this.nextId('inv') };
    this.invites.push(created);
    return created;
  }

  async getInviteByHash(tokenHash: string): Promise<InviteToken | null> {
    return this.invites.find((i) => i.tokenHash === tokenHash) ?? null;
  }

  async consumeInvite(
    inviteId: string,
    usedAt: number,
    consumedUserId: string,
  ): Promise<boolean> {
    const inv = this.invites.find((i) => i._id === inviteId);
    if (!inv || inv.usedAt != null) return false; // already consumed
    inv.usedAt = usedAt;
    inv.consumedUserId = consumedUserId;
    return true;
  }
}
