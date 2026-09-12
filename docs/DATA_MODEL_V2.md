# FamilyLedger v2 — Data Model

**Status:** authoritative implementation target for product spec v2.0  
**Date:** 2026-09-12

This document translates `docs/来往账_产品规划设计书_v2.0.md` into concrete domain objects, collection shapes, indexes, state transitions, and migration rules.

The product spec owns business meaning. This document owns implementation shape. If they diverge, fix both before merging production code.

---

## 1. Design goals

The v2 model must support:

- every WeChat user having an independent account;
- the same user acting as borrower in one Loan and lender in another;
- one shared Loan per debt record rather than duplicated per-user copies;
- proposal/confirmation before any formal ledger mutation;
- append-only formal history;
- deterministic balance reconstruction;
- first-contact invite binding without trusting client-supplied identity;
- idempotent retries and concurrency-safe confirmation;
- future rate sources such as CPI without hard-coding a single global 5% rule.

The v2 model must not contain global family/admin semantics.

---

## 2. Collection overview

Target collections:

| Collection | Purpose |
|---|---|
| `users` | WeChat-backed product identities |
| `loans` | Static bilateral debt relationships |
| `ledger_requests` | Proposed changes awaiting mutual consent |
| `loan_events` | Immutable applied ledger history |
| `invite_tokens` | First-contact invitation/claim credentials |
| `audit_logs` | Security and write-operation audit trail |
| `rate_references` | Optional future CPI/reference-rate cache; not required for MVP |

Legacy collections `loan_accounts`, `loan_terms`, and `change_requests` are not part of the v2 target model.

---

## 3. Shared scalar types

```ts
export type UserId = string;
export type LoanId = string;
export type RequestId = string;
export type EventId = string;
export type InviteId = string;

/** Calendar date in the fixed ledger timezone, YYYY-MM-DD. */
export type IsoDate = string;

/** UTC epoch milliseconds from trusted server time. */
export type EpochMillis = number;

/** Integer Chinese cents. Must also satisfy Number.isSafeInteger. */
export type Fen = number;

/** Decimal string, e.g. "0.026" for 2.6%. */
export type AnnualEffectiveRate = string;
```

Money must never be persisted as floating-point yuan values.

---

## 4. User

```ts
export interface User {
  _id: UserId;
  openid: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}
```

### Rules

- No `role` field.
- No `familyId` field.
- `openid` is read from trusted CloudBase/WeChat runtime context, never from client authority.
- One OPENID maps to at most one User.
- A user can be borrower and lender simultaneously across different Loans.

### Required indexes

- unique: `users.openid`

---

## 5. Loan

A Loan is the static identity of one debt relationship.

```ts
export const LoanStatus = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
} as const;
export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];

export interface Loan {
  _id: LoanId;
  lenderUserId: UserId;
  borrowerUserId: UserId;
  currency: 'CNY';
  ledgerTimezone: 'Asia/Shanghai';

  /** The CREATE_LOAN request that atomically created this Loan. */
  createdFromRequestId: RequestId;

  /** Operational projection; formal close history remains in events/audit. */
  status: LoanStatus;

  createdAt: EpochMillis;
  closedAt: EpochMillis | null;
}
```

### Rules

- `lenderUserId !== borrowerUserId`.
- Both users must exist.
- Parties are immutable after creation.
- No current principal, interest, or balance is stored as authoritative truth on Loan.
- Same two users may have multiple Loans.
- Same two users may also have Loans in opposite directions.

### Required indexes

- unique: `loans.createdFromRequestId`
- query: `loans.lenderUserId + status`
- query: `loans.borrowerUserId + status`

Optional future performance index:

- compound/indexed pair of `lenderUserId + borrowerUserId`

---

## 6. Rate source metadata

```ts
export const RateSource = {
  CPI_REFERENCE: 'CPI_REFERENCE',
  MANUAL: 'MANUAL',
} as const;
export type RateSource = (typeof RateSource)[keyof typeof RateSource];

export interface RateSnapshot {
  annualEffectiveRate: AnnualEffectiveRate;
  rateSource: RateSource;
  rateReferenceYear?: number | null;
  rateReferenceLabel?: string | null;
}
```

### Important semantic rule

The numeric `annualEffectiveRate` is a snapshot agreed by both parties.

`CPI_REFERENCE` is explanatory metadata, not a live pointer that silently changes an existing Loan later.

---

## 7. LedgerRequest

Every proposed formal change goes through `ledger_requests`.

```ts
export const LedgerRequestType = {
  CREATE_LOAN: 'CREATE_LOAN',
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  RATE_CHANGE: 'RATE_CHANGE',
  CORRECTION: 'CORRECTION',
  CLOSE_LOAN: 'CLOSE_LOAN',
} as const;
export type LedgerRequestType =
  (typeof LedgerRequestType)[keyof typeof LedgerRequestType];

export const LedgerRequestStatus = {
  PENDING: 'PENDING',
  PENDING_INITIATOR_VERIFY: 'PENDING_INITIATOR_VERIFY',
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type LedgerRequestStatus =
  (typeof LedgerRequestStatus)[keyof typeof LedgerRequestStatus];
```

Use a typed payload union rather than one loose bag of fields:

```ts
export interface CreateLoanPayload {
  borrowerUserId: UserId | null;
  lenderUserId: UserId | null;

  /** Exactly one party may initially be unknown for a first-contact invite. */
  unknownPartyRole: 'BORROWER' | 'LENDER' | null;

  initialPrincipalFen: Fen;
  rate: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface PrincipalAddPayload {
  amountFen: Fen;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface PrincipalRepayPayload {
  amountFen: Fen;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface RateChangePayload {
  rate: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}

export interface CorrectionPayload {
  targetEventId: EventId;
  /**
   * Compensating change, not replacement of the original event.
   * Exact subtype should be narrowed further when implementation begins.
   */
  principalDeltaFen?: Fen;
  replacementRate?: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  reason?: string | null;
}

export interface CloseLoanPayload {
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}
```

Base record:

```ts
export interface LedgerRequest {
  _id: RequestId;
  type: LedgerRequestType;
  loanId: LoanId | null; // null for CREATE_LOAN before application

  proposerUserId: UserId;
  counterpartyUserId: UserId | null;

  payload:
    | CreateLoanPayload
    | PrincipalAddPayload
    | PrincipalRepayPayload
    | RateChangePayload
    | CorrectionPayload
    | CloseLoanPayload;

  status: LedgerRequestStatus;

  /** True only for first-contact invite flow. */
  requiresInitiatorVerify: boolean;

  /** Client generated. Reusing with different payload is a conflict. */
  idempotencyKey: string;
  requestFingerprint: string;

  createdAt: EpochMillis;
  updatedAt: EpochMillis;
  resolvedAt: EpochMillis | null;
  expiresAt: EpochMillis | null;
}
```

### Why `requestFingerprint` exists

A unique idempotency key alone is not enough.

On retry, the server must compare a canonical fingerprint of the semantic request. If the same key arrives with a different amount/loan/type/payload, return `CONFLICT`; do not return the old request as if the new operation succeeded.

### Required indexes

- unique: `ledger_requests.idempotencyKey`
- query: `ledger_requests.proposerUserId + status`
- query: `ledger_requests.counterpartyUserId + status`
- query: `ledger_requests.loanId + createdAt`

---

## 8. LedgerRequest state machine

### Existing known counterparty

```text
PENDING
  ├─ accept  -> APPLIED
  ├─ reject  -> REJECTED
  ├─ cancel  -> CANCELLED
  └─ expire  -> EXPIRED
```

`PENDING -> APPLIED` must happen in the same transaction as every formal write caused by the request.

### First-contact invite

```text
PENDING
  ├─ invitee accepts -> PENDING_INITIATOR_VERIFY
  │                       ├─ initiator verifies -> APPLIED
  │                       ├─ initiator cancels  -> CANCELLED
  │                       └─ expire             -> EXPIRED
  ├─ invitee rejects -> REJECTED
  ├─ initiator cancels -> CANCELLED
  └─ expire -> EXPIRED
```

No other transition is legal.

All transition checks must be server-side and use transaction/CAS semantics.

---

## 9. LoanEvent

Formal applied history is append-only.

```ts
export const LoanEventType = {
  PRINCIPAL_ADD: 'PRINCIPAL_ADD',
  PRINCIPAL_REPAY: 'PRINCIPAL_REPAY',
  RATE_CHANGE: 'RATE_CHANGE',
  CORRECTION: 'CORRECTION',
  LOAN_CLOSED: 'LOAN_CLOSED',
} as const;
export type LoanEventType =
  (typeof LoanEventType)[keyof typeof LoanEventType];

export interface LoanEvent {
  _id: EventId;
  loanId: LoanId;
  eventType: LoanEventType;

  amountFen: Fen | null;
  rate?: RateSnapshot;
  targetEventId?: EventId | null;

  effectiveDate: IsoDate;

  /** Request whose application created this event. */
  sourceRequestId: RequestId;

  createdBy: UserId;
  confirmedBy: UserId;

  /** Stable ordering inside one Loan when dates/timestamps tie. */
  sequence: number;

  /** Unique per generated event, not necessarily equal to request idempotency key. */
  idempotencyKey: string;

  createdAt: EpochMillis;
  schemaVersion: 2;
}
```

### Event generation per request

| Request | Events |
|---|---|
| CREATE_LOAN | `PRINCIPAL_ADD` + `RATE_CHANGE` |
| PRINCIPAL_ADD | `PRINCIPAL_ADD` |
| PRINCIPAL_REPAY | `PRINCIPAL_REPAY` |
| RATE_CHANGE | `RATE_CHANGE` |
| CORRECTION | one or more compensating event(s), implementation must be deterministic |
| CLOSE_LOAN | `LOAN_CLOSED` |

A CREATE_LOAN request intentionally creates two genesis events so the existing calculation model can migrate without introducing a second source of truth for initial principal/rate.

### Important index change from v1.1

`sourceRequestId` **must not be globally unique** in v2 because one `CREATE_LOAN` request creates more than one event.

Instead require:

- unique: `loan_events.idempotencyKey`
- unique or strongly enforced ordering: `loan_events.loanId + sequence`
- query: `loan_events.loanId + sequence`
- query: `loan_events.sourceRequestId`

Example event idempotency keys derived server-side:

```text
<requestId>:principal-add
<requestId>:initial-rate
<requestId>:repay
```

---

## 10. Event ordering

Every Loan must have stable event order independent of database natural order.

Preferred rule:

1. primary: `effectiveDate` for calculation semantics;
2. tie-breaking/application order: monotonic `sequence` assigned transactionally per Loan;
3. `createdAt` is audit metadata, not the sole ordering guarantee.

If implementing a transactional monotonic sequence is unnecessarily expensive in CloudBase, a deterministic alternative may be chosen, but it must be documented and covered by tests before production use.

---

## 11. InviteToken

```ts
export const InviteStatus = {
  ACTIVE: 'ACTIVE',
  CLAIMED: 'CLAIMED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export interface InviteToken {
  _id: InviteId;
  requestId: RequestId;
  tokenHash: string;

  status: InviteStatus;

  createdByUserId: UserId;
  claimedByUserId: UserId | null;

  createdAt: EpochMillis;
  claimedAt: EpochMillis | null;
  expiresAt: EpochMillis;
  revokedAt: EpochMillis | null;
}
```

### Rules

- Store only token hash.
- Token points to one specific LedgerRequest.
- Only first valid claim may bind `claimedByUserId`.
- Invite claim must never let the client choose arbitrary user IDs.
- Claiming user is resolved from runtime OPENID.
- For first-contact CREATE_LOAN, claim binds the previously unknown borrower/lender position in request payload.
- A token cannot be reused to create multiple counterparties.

### Required indexes

- unique: `invite_tokens.tokenHash`
- unique or one-active-at-a-time policy: `invite_tokens.requestId` as appropriate
- query: `invite_tokens.expiresAt + status`

---

## 12. AuditLog

Current structure is broadly reusable:

```ts
export interface AuditLog {
  _id: string;
  actorOpenId: string | null;
  actorUserId: UserId | null;
  action: string;
  targetId: string | null;
  requestId: RequestId | null;
  result: 'OK' | 'DENIED' | 'ERROR';
  detail?: string;
  serverTime: EpochMillis;
}
```

Audit logs are operational/security records, not a substitute for LoanEvent history.

Do not store raw invite tokens in audit details.

---

## 13. Optional RateReference

Not required for the first migration milestone.

```ts
export interface RateReference {
  _id: string;
  type: 'CPI';
  jurisdiction: string;
  referenceYear: number;
  annualRate: AnnualEffectiveRate;
  label: string;
  sourceUrl?: string | null;
  publishedAt?: EpochMillis | null;
  fetchedAt: EpochMillis;
}
```

This collection is only a source for prefilling proposals.

It must never retroactively mutate existing LoanEvent rate snapshots.

---

## 14. Derived views

These are query results, not authoritative collections.

### UserHomeSummary

```ts
export interface UserHomeSummary {
  receivable: {
    principalFen: Fen;
    interestFen: Fen;
    totalFen: Fen;
    loanCount: number;
  };
  payable: {
    principalFen: Fen;
    interestFen: Fen;
    totalFen: Fen;
    loanCount: number;
  };
  pendingRequestCount: number;
}
```

### LoanSummary

```ts
export interface LoanSummary {
  loanId: LoanId;
  lenderUserId: UserId;
  borrowerUserId: UserId;
  principalFen: Fen;
  interestFen: Fen;
  totalFen: Fen;
  todayInterestFen: Fen;
  currentRate: RateSnapshot;
  asOfDate: IsoDate;
}
```

Never persist these values as the only source of truth.

---

## 15. Permission matrix

For Loan-scoped operations:

| Operation | Lender | Borrower | Unrelated user |
|---|:---:|:---:|:---:|
| Read Loan | ✓ | ✓ | ✗ |
| Read Loan events | ✓ | ✓ | ✗ |
| Propose add principal | ✓ | ✓ | ✗ |
| Propose repayment | ✓ | ✓ | ✗ |
| Propose rate change | ✓ | ✓ | ✗ |
| Propose correction | ✓ | ✓ | ✗ |
| Accept counterparty request | ✓ | ✓ | ✗ |
| Reject counterparty request | ✓ | ✓ | ✗ |
| Cancel own pending request | if proposer | if proposer | ✗ |

For CREATE_LOAN first-contact invites, an unrelated user only becomes the candidate counterparty by successfully claiming the invite with their runtime OPENID.

---

## 16. Atomic transaction boundaries

### Apply CREATE_LOAN

One transaction must cover at minimum:

- lock/check request status;
- verify correct acting user;
- bind final counterparty identity if applicable;
- create Loan;
- create initial PRINCIPAL_ADD event;
- create initial RATE_CHANGE event;
- mark request APPLIED;
- mark invite consumed/claimed final as needed.

Audit may be included in the same transaction where practical. If not, audit failure must not cause the client to retry in a way that duplicates business state.

### Apply normal request

One transaction must cover:

- check request is PENDING;
- check actor is the counterparty, not proposer;
- reload current Loan and complete balance state required for validation;
- enforce current constraints such as repayment <= principal;
- append event(s);
- transition request to APPLIED.

---

## 17. Pagination requirement

Every collection read that can grow beyond one CloudBase page must paginate until complete or use a bounded indexed query whose limit is part of the business contract.

This is especially mandatory for:

- `loan_events` reconstruction;
- user Loan lists;
- user pending/history request lists;
- audit/export tools.

No balance calculation may assume a single database `.get()` call returned the full event stream.

---

## 18. Balance reconstruction rules

A Loan balance is reconstructed from ordered LoanEvents.

At minimum:

- `PRINCIPAL_ADD`: increases outstanding principal from its effective date;
- `PRINCIPAL_REPAY`: decreases outstanding principal from its effective date;
- `RATE_CHANGE`: changes the annual effective rate from its effective date;
- `CORRECTION`: applies only its explicit compensating effect; it never mutates the target event;
- `LOAN_CLOSED`: changes lifecycle state, not historical math before close.

The calculation engine must define the rate in effect before the first later `RATE_CHANGE`. For v2 CREATE_LOAN this is guaranteed by writing an initial rate event alongside the first principal event.

---

## 19. Idempotency contract

Every client-originated mutation has an idempotency key.

Server handling:

1. canonicalize semantic request fields;
2. compute `requestFingerprint`;
3. lookup existing request by idempotency key;
4. if absent, continue create;
5. if present and fingerprint matches, return original semantic result;
6. if present and fingerprint differs, return conflict.

Server-created LoanEvents use deterministic derived idempotency keys so retrying an apply transaction cannot append a second equivalent event.

---

## 20. v1.1 → v2 field migration map

| v1.1 | v2.0 |
|---|---|
| `User.role` | remove |
| `User.familyId` | remove |
| `LoanAccount` | `Loan` |
| `LoanAccount.familyId` | remove |
| `LoanAccount.lenderUserId` | keep on Loan |
| `LoanAccount.borrowerUserId` | keep on Loan |
| `ChangeRequest` | `LedgerRequest` |
| `requiredConfirmer` | derive from proposer + Loan parties |
| `InviteToken.familyId` | remove |
| `InviteToken.displayName` | remove from authority model |
| `InviteToken.role` | replace with request `unknownPartyRole` |
| `InviteToken.consumedUserId` | `claimedByUserId` |
| `LoanTerm` | remove as truth; rate truth lives in RATE_CHANGE events |
| `LoanEvent.sourceRequestId unique` | no longer unique; query index only |
| `LoanEvent.idempotencyKey` | keep unique |
| `AuditLog` | keep, adapt action names |
| `DEFAULT_FAMILY_ID` | remove |
| global 5% default | remove; proposal default becomes CPI-reference capable |

---

## 21. Legacy data handling

Current repository data is development-stage v1.1 data. Do not build a complex production migration before confirming there is real data worth preserving.

Recommended implementation strategy:

1. implement v2 types and collections in code/tests;
2. preserve old collections temporarily for rollback/reference;
3. develop a one-shot migration only if existing CloudBase records need preservation;
4. once v2 flows are validated, remove legacy writes;
5. remove legacy collections only after explicit backup/export.

Do not silently reinterpret a v1.1 admin-created event as mutual-consent v2 history. If legacy data is migrated, mark provenance/schema version clearly.

---

## 22. API action target set

Suggested v2 cloud actions:

```text
ensureUser
getHomeSummary
listLoans
getLoan
listLoanEvents

createLoanRequest
createLoanInvite
previewInvite
acceptInviteRequest
verifyFirstCounterparty

createPrincipalAddRequest
createRepaymentRequest
createRateChangeRequest
createCorrectionRequest
createCloseLoanRequest

listPendingRequests
acceptRequest
rejectRequest
cancelRequest
```

This is a semantic target, not a requirement to implement every endpoint in the first migration commit.

---

## 23. Test requirements before v2 production use

At minimum add tests for:

- a user can be lender in one Loan and borrower in another;
- unrelated users cannot read either Loan;
- first-contact invite can be claimed only once under true concurrent attempts;
- first-contact acceptance does not create Loan before initiator verification;
- known-counterparty acceptance applies directly;
- duplicate request retries are idempotent;
- reused idempotency key with different payload is rejected;
- CREATE_LOAN transaction cannot leave one genesis event without the other;
- repayment cannot overdraw outstanding principal;
- two concurrent accept calls produce one event set;
- event history over one CloudBase page reconstructs correctly;
- rate before/after multiple RATE_CHANGE events reconstructs correctly;
- initial rate always exists for a newly created v2 Loan;
- rejected/cancelled/expired requests never create events;
- correction appends compensation without changing target event;
- home receivable/payable views are opposite projections of the same Loan.

---

## 24. Implementation warning

Until the v2 migration is complete, the repository contains v1.1 code whose assumptions conflict with this model, including global UserRole, familyId, bootstrapAdmin, admin-only actions, direct PRINCIPAL_ADD writes, and family-oriented UI.

Do not extend those patterns merely because they already exist. Treat them as migration targets unless a v2 design decision explicitly retains them.
