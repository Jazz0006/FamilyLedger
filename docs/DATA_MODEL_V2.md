# FamilyLedger v2 — Data Model

**Status:** authoritative implementation target for product spec v2.0  
**Date:** 2026-09-12 · R9 semantics clarified

This document translates `docs/来往账_产品规划设计书_v2.0.md` into concrete domain objects, collection shapes, indexes, state transitions, transaction rules, and clean-rewrite implementation constraints.

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
- future rate sources such as CPI without hard-coding a single global 5% rule;
- explicit compensating corrections rather than event edits;
- a mutually confirmed close/settlement boundary without pretending the app moved money.

The v2 model must not contain global family/admin semantics or a v1 compatibility layer.

---

## 2. Collection overview

Target collections:

| Collection | Purpose |
|---|---|
| `users` | WeChat-backed product identities |
| `loans` | Static bilateral debt relationships plus lifecycle status |
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

A Loan is the identity and lifecycle container of one debt relationship.

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

  /** Operational lifecycle projection; formal history remains in events. */
  status: LoanStatus;

  createdAt: EpochMillis;
  /** Server timestamp when CLOSE_LOAN was applied, not the ledger effective date. */
  closedAt: EpochMillis | null;
}
```

### Rules

- `lenderUserId !== borrowerUserId`.
- Both users must exist.
- Parties are immutable after creation.
- No current principal, interest, or total balance is stored as authoritative truth on Loan.
- Same two users may have multiple Loans.
- Same two users may also have Loans in opposite directions.
- Once status becomes CLOSED, normal principal/rate/correction requests can no longer apply.

### Infrastructure-only persisted field

CloudBase may persist a private infrastructure counter such as `nextEventSequence` on the Loan document to allocate monotonically ordered formal events. It is not part of the accounting/domain `Loan` interface and must not become a balance source.

### Required indexes

- unique: `loans.createdFromRequestId`
- query: `loans.lenderUserId + status + createdAt + _id`
- query: `loans.borrowerUserId + status + createdAt + _id`

Optional future performance index:

- `lenderUserId + borrowerUserId`

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

### Payloads

```ts
export interface CreateLoanPayload {
  borrowerUserId: UserId | null;
  lenderUserId: UserId | null;
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

/** Principal reduction only; not a generic cash-payment allocation. */
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
```

### Correction payload — discriminated MVP union

Correction input does **not** carry a client-selected effective date. The formal Correction event inherits the target event's effective date server-side.

```ts
export interface PrincipalCorrectionPayload {
  correctionKind: 'PRINCIPAL';
  targetEventId: EventId;
  /** Signed, non-zero compensation. */
  principalDeltaFen: Fen;
  reason?: string | null;
}

export interface RateCorrectionPayload {
  correctionKind: 'RATE';
  targetEventId: EventId;
  replacementRate: RateSnapshot;
  reason?: string | null;
}

export type CorrectionPayload =
  | PrincipalCorrectionPayload
  | RateCorrectionPayload;
```

One Correction request has exactly one correction dimension and creates exactly one formal `CORRECTION` event in MVP.

### Close payload

```ts
export interface CloseLoanPayload {
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}
```

Acceptance semantics, not a fake payment field, define closure: principal must be zero, remaining calculated interest is snapshot and jointly acknowledged as settled/waived/otherwise handled offline, and current balance is zero from the close date onward.

### Base record

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

  /** Client generated. Reusing with different semantics is a conflict. */
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

On retry, the server compares a canonical fingerprint of semantic request fields. Same key + same fingerprint returns the original semantic result. Same key + different semantic payload returns `CONFLICT`.

For first-contact CREATE_LOAN, the fingerprint describes the original proposal; server-side invite binding later fills the unknown counterparty identity without reinterpreting a changed client proposal.

### Required indexes

- unique: `ledger_requests.idempotencyKey`
- query: `ledger_requests.proposerUserId + status + createdAt + _id`
- query: `ledger_requests.counterpartyUserId + status + createdAt + _id`
- query: `ledger_requests.loanId + createdAt + _id`

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

All transition checks are server-side and use transaction/CAS semantics.

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

export interface CloseSettlementSnapshot {
  /**
   * Server-calculated accrued interest immediately before the settlement
   * boundary. It is an audit snapshot, not proof of an in-app payment.
   */
  accruedInterestFen: Fen;
}

export interface LoanEvent {
  _id: EventId;
  loanId: LoanId;
  eventType: LoanEventType;

  amountFen: Fen | null;
  rate?: RateSnapshot;
  targetEventId?: EventId | null;
  closeSettlement?: CloseSettlementSnapshot;

  effectiveDate: IsoDate;
  sourceRequestId: RequestId;
  createdBy: UserId;
  confirmedBy: UserId;

  /** Stable ordering inside one Loan when dates tie. */
  sequence: number;

  /** Unique per generated event, not equal to client request idempotency key. */
  idempotencyKey: string;

  createdAt: EpochMillis;
  schemaVersion: 2;
}
```

### Event-specific shape constraints

- `PRINCIPAL_ADD`: positive `amountFen`; no rate/closeSettlement.
- `PRINCIPAL_REPAY`: positive `amountFen`; no rate/closeSettlement.
- `RATE_CHANGE`: `amountFen=null`; required `rate`; no closeSettlement.
- principal `CORRECTION`: signed non-zero `amountFen`; no rate; required `targetEventId`.
- rate `CORRECTION`: `amountFen=null`; required `rate` and `targetEventId`.
- `LOAN_CLOSED`: `amountFen=null`; no rate; required `closeSettlement`; no targetEventId.

A CORRECTION event must never contain both a principal amount and a replacement rate.

### Event generation per request

| Request | Events |
|---|---|
| CREATE_LOAN | `PRINCIPAL_ADD` + `RATE_CHANGE` |
| PRINCIPAL_ADD | `PRINCIPAL_ADD` |
| PRINCIPAL_REPAY | `PRINCIPAL_REPAY` |
| RATE_CHANGE | `RATE_CHANGE` |
| CORRECTION | exactly one `CORRECTION` in MVP |
| CLOSE_LOAN | exactly one `LOAN_CLOSED` |

A CREATE_LOAN request intentionally creates two genesis events so there is no second source of truth for initial principal/rate.

### Deterministic event keys

Examples:

```text
<requestId>:initial-principal
<requestId>:initial-rate
<requestId>:principal-add
<requestId>:principal-repay
<requestId>:rate-change
<requestId>:correction
<requestId>:loan-close
```

### Required indexes

`sourceRequestId` **must not be globally unique** because CREATE_LOAN intentionally creates two events.

Require:

- unique: `loan_events.idempotencyKey`
- unique: `loan_events.loanId + sequence`
- query: `loan_events.loanId + sequence`
- query: `loan_events.sourceRequestId`

---

## 10. Event ordering

Every Loan has stable event order independent of database natural order.

Rules:

1. `effectiveDate` controls accounting/calculation date semantics;
2. monotonic per-Loan `sequence` is the deterministic tie-break and application order;
3. `createdAt` is audit metadata, not the ordering guarantee.

For rate-affecting events with the same effectiveDate, the highest sequence wins. `packages/calc` and read-model `currentRate` must use the same rule.

For principal timeline safety validation, events are grouped/ordered by effectiveDate and sequence so backdated compensation cannot create a hidden negative-principal interval.

---

## 11. Correction target rules

### Principal correction

Allowed targets:

- `PRINCIPAL_ADD`;
- `PRINCIPAL_REPAY`;
- a previous principal-kind `CORRECTION`.

Target must belong to the same Loan. The Correction event inherits `target.effectiveDate`.

At acceptance, insert the candidate compensation into the replayed timeline and reject if principal is negative at any ledger-day boundary from that effective date onward.

### Rate correction

Allowed targets:

- `RATE_CHANGE`;
- a previous rate-kind `CORRECTION`.

Target must belong to the same Loan and must be the current winning rate-affecting event on its effectiveDate (highest sequence for that date). The new correction inherits the target effectiveDate and its later sequence becomes the new winner.

### Explicit non-goals

MVP Correction does not directly correct an event's `effectiveDate`. A date-correction feature would require explicit reverse-and-reapply semantics and is deferred.

---

## 12. Close / settlement rules

`CLOSE_LOAN` is a lifecycle + settlement boundary, not a payment event.

At acceptance, inside one transaction:

1. request is PENDING and actor is counterparty;
2. Loan is ACTIVE and request parties match Loan parties;
3. complete formal event history is read in the same transaction snapshot;
4. `proposedEffectiveDate <= ledgerToday(serverNow)`;
5. close effectiveDate is on/after every existing formal event effectiveDate;
6. balance at close date is reconstructed;
7. `principalFen === 0` is required;
8. `interestFen >= 0` is required;
9. server creates `LOAN_CLOSED` with `closeSettlement.accruedInterestFen = interestFen`;
10. Loan status becomes CLOSED and `closedAt = serverNow`;
11. request becomes APPLIED.

All writes are atomic.

The close acceptance itself means both parties agree the residual accrued interest shown by the system has been settled, waived, rounded, or otherwise handled offline. No separate cash-payment fact is invented.

After Loan status becomes CLOSED, pending normal change/correction requests must fail application because they require an ACTIVE Loan.

---

## 13. InviteToken

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

Rules:

- Store only token hash.
- Token points to one specific LedgerRequest.
- Only first valid claim may bind `claimedByUserId`.
- Claiming user is resolved from runtime OPENID.
- For first-contact CREATE_LOAN, claim binds the previously unknown party in request payload.
- A token cannot be reused to create multiple counterparties.
- Retrying invite issuance must not generate multiple semantically different active credentials for the same intended request retry.

Required indexes:

- unique: `invite_tokens.tokenHash`
- one-active-at-a-time / unique request policy as implemented for `invite_tokens.requestId`
- query: `invite_tokens.expiresAt + status`

---

## 14. AuditLog

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

## 15. Optional RateReference

Not required for the core MVP.

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

This collection is only a source for prefilling proposals. It must never retroactively mutate existing LoanEvent rate snapshots.

---

## 16. Derived views

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

Only ACTIVE Loans enter current receivable/payable totals.

### LoanSummary

```ts
export interface LoanSummary {
  loanId: LoanId;
  lenderUserId: UserId;
  borrowerUserId: UserId;
  status: LoanStatus;

  principalFen: Fen;
  interestFen: Fen;
  totalFen: Fen;
  todayInterestFen: Fen;
  currentRate: RateSnapshot;
  asOfDate: IsoDate;

  closeEffectiveDate: IsoDate | null;
  /** Historical accrued interest discharged by the close settlement. */
  settledInterestFen: Fen | null;
}
```

For ACTIVE Loans, close fields are null.

For a CLOSED Loan current projection at/after the close effectiveDate:

```text
principalFen = 0
interestFen = 0
totalFen = 0
todayInterestFen = 0
```

`settledInterestFen` comes from `LOAN_CLOSED.closeSettlement.accruedInterestFen`.

Historical as-of projection before close continues to replay pre-close events normally.

Never persist `LoanSummary` values as accounting truth.

---

## 17. Permission matrix

For Loan-scoped operations:

| Operation | Lender | Borrower | Unrelated user |
|---|:---:|:---:|:---:|
| Read Loan | ✓ | ✓ | ✗ |
| Read Loan events | ✓ | ✓ | ✗ |
| Propose add principal | ✓ | ✓ | ✗ |
| Propose principal repayment | ✓ | ✓ | ✗ |
| Propose rate change | ✓ | ✓ | ✗ |
| Propose correction | ✓ | ✓ | ✗ |
| Propose close | ✓ | ✓ | ✗ |
| Accept counterparty request | ✓ | ✓ | ✗ |
| Reject counterparty request | ✓ | ✓ | ✗ |
| Cancel own pending request | if proposer | if proposer | ✗ |

For first-contact CREATE_LOAN, an unrelated user only becomes candidate counterparty by successfully claiming the invite with runtime OPENID.

Once Loan is CLOSED, no new formal change/correction may apply to it.

---

## 18. Atomic transaction boundaries

### Apply CREATE_LOAN

One transaction covers at minimum:

- check request status and actor;
- bind final counterparty identity if applicable;
- create Loan;
- create initial PRINCIPAL_ADD event;
- create initial RATE_CHANGE event;
- mark request APPLIED;
- finalize invite state as needed.

### Apply PRINCIPAL_REPAY

One transaction covers:

- reload request + ACTIVE Loan;
- verify actor/counterparty and participant consistency;
- page through complete LoanEvent history inside transaction snapshot;
- reconstruct principal as proposed effective date;
- require repayment <= principal;
- allocate sequence;
- append `PRINCIPAL_REPAY`;
- request -> APPLIED.

### Apply PRINCIPAL_ADD / RATE_CHANGE

One transaction covers:

- reload request + ACTIVE Loan;
- verify actor/counterparty and participants;
- validate request payload;
- allocate sequence;
- append deterministic formal event;
- request -> APPLIED.

### Apply CORRECTION

One transaction covers:

- reload request + ACTIVE Loan;
- verify actor/counterparty;
- load complete event stream;
- find and validate target event;
- derive effectiveDate from target;
- for principal correction, replay candidate timeline and prohibit negative principal at any affected ledger-day boundary;
- for rate correction, require target is current winning rate event for that effectiveDate;
- allocate sequence;
- append one deterministic `CORRECTION`;
- request -> APPLIED.

### Apply CLOSE_LOAN

One transaction covers all rules in section 12, including:

- full event replay;
- principal == 0;
- residual-interest snapshot;
- append LOAN_CLOSED;
- Loan ACTIVE -> CLOSED and closedAt update;
- request -> APPLIED.

Audit may be inside the same transaction where practical. If audit is outside, audit failure must never trigger duplicate business mutation.

---

## 19. Pagination requirement

Every collection read that can grow beyond one CloudBase page must paginate until complete or use a bounded indexed query whose limit is part of the business contract.

This is mandatory for:

- `loan_events` reconstruction;
- transaction-scoped balance validation;
- user Loan lists;
- user pending/history request lists;
- audit/export tools.

No balance or correction/close validation may assume one `.get()` returned the full stream.

---

## 20. Balance reconstruction rules

For an ACTIVE Loan:

- `PRINCIPAL_ADD`: increases outstanding principal from effectiveDate;
- `PRINCIPAL_REPAY`: decreases principal from effectiveDate;
- `RATE_CHANGE`: changes annual effective rate from effectiveDate;
- principal `CORRECTION`: applies only its signed compensating principal effect;
- rate `CORRECTION`: applies only its replacement rate from target effectiveDate;
- original target events remain in history;
- same-day rate precedence uses higher event sequence.

CREATE_LOAN always writes an initial RATE_CHANGE, so there is no implicit historical default rate.

### CLOSED Loan

`LOAN_CLOSED` does not rewrite calculations for historical dates before close.

At/after the close effectiveDate, product current-settlement projection is zero because both parties explicitly discharged the remaining claim. Future interest does not accrue after the settlement boundary.

The close event preserves the pre-close residual accrued-interest snapshot for audit/display.

---

## 21. Idempotency contract

Every client-originated mutation has an idempotency key.

Server handling:

1. canonicalize semantic request fields;
2. compute `requestFingerprint`;
3. lookup existing request by idempotency key;
4. if absent, create;
5. if present and fingerprint matches, return original semantic result;
6. if present and fingerprint differs, return conflict.

Server-created LoanEvents use deterministic derived keys. Same event key with different semantic content is a conflict.

For Correction, canonical fingerprint includes:

- correctionKind;
- targetEventId;
- principalDeltaFen **or** replacementRate;
- reason normalization as defined by request semantics.

Correction effectiveDate is not a client fingerprint input because it is derived from the target event.

---

## 22. Clean rewrite map

| v1.1 concept | v2 treatment |
|---|---|
| `User.role` | remove |
| `User.familyId` | remove |
| `LoanAccount` | replace with `Loan` |
| `LoanAccount.familyId` | remove |
| `ChangeRequest` | replace with `LedgerRequest` |
| `requiredConfirmer` | derive from proposer + Loan parties |
| family invite authority fields | remove |
| `InviteToken.role` | request `unknownPartyRole` only for first contact |
| `LoanTerm` | remove as truth; rate lives in RATE_CHANGE/CORRECTION history |
| `LoanEvent.sourceRequestId unique` | remove uniqueness; query index only |
| `LoanEvent.idempotencyKey` | keep unique |
| `AuditLog` | keep, adapt action names |
| `DEFAULT_FAMILY_ID` | remove |
| global 5% default | remove |

v2 does not preserve runtime compatibility with these concepts.

---

## 23. Legacy data handling

The repository's v1.1 data is development-stage PoC data, not a production compatibility contract.

Default strategy:

1. build and validate only v2 collections/flows;
2. do not dual-write;
3. do not add `if (familyId)` or global-role compatibility branches;
4. keep Git history as the v1 source reference;
5. if CloudBase contains only test data, discard/archive it rather than writing a migration framework;
6. only if valuable real historical records are later identified, design a separate one-shot import with explicit provenance.

Never silently reinterpret an old unilateral admin-created event as mutual-consent v2 history.

---

## 24. API action target set

Implemented/currently planned semantic surface:

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

`acceptRequest/rejectRequest/cancelRequest` may be shared across implemented known-counterparty request types, but unsupported request types must fail closed until their validation semantics exist.

---

## 25. Test requirements before v2 production use

At minimum cover:

- a user can be lender in one Loan and borrower in another;
- unrelated users cannot read either Loan;
- first-contact invite can be claimed only once under concurrent attempts;
- first-contact acceptance does not create Loan before initiator verification;
- duplicate request retries are idempotent;
- reused idempotency key with different payload is rejected;
- CREATE_LOAN cannot leave only one genesis event;
- repayment cannot overdraw principal;
- concurrent stale repayments cannot both make principal negative;
- principal-add/rate-change require counterparty confirmation;
- concurrent formal events receive unique sequences;
- >1 CloudBase page event history reconstructs correctly;
- same-effective-date rate events resolve by higher sequence in both display and calc;
- initial rate always exists for every v2 Loan;
- rejected/cancelled/expired requests never create events;
- principal Correction never edits target and cannot produce negative principal on any affected historical day;
- rate Correction targets the winning same-day rate event and supersedes it by later sequence;
- Correction may correct a prior same-kind Correction through an explicit target chain;
- Close cannot apply while principal != 0;
- Close cannot be future-dated in MVP;
- Close cannot precede an already-applied formal event;
- Close snapshots residual accrued interest;
- Close atomically writes event + Loan CLOSED + request APPLIED;
- post-close pending changes cannot apply;
- CLOSED current projection is zero and no longer accrues interest;
- historical pre-close projection remains reconstructable;
- home receivable/payable views remain opposite projections of one shared Loan.
