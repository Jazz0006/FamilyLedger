# Next Development Handoff — v2 R3 Persistence Contract and Safety Foundation

**Date:** 2026-09-12  
**Repository:** `Jazz0006/FamilyLedger`  
**Base checkpoint:** R2 state machine / permissions / idempotency  
**Next milestone:** `R3 — v2 persistence contract and safety foundation`

## Read first

Use these as authority:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md`
4. `AGENTS.md`
5. `docs/V2_R2_STATE_MACHINE_PROGRESS_2026-09-12.md`

Do not restore or adapt the deleted v1 family/admin repository interface.

## Objective

Define the smallest persistence capabilities that the v2 application layer actually needs, with a deterministic MemoryRepo and a CloudBase implementation strategy that is safe for growing histories and concurrent request application.

## Required repository capabilities

Prefer use-case-shaped capabilities instead of a generic ORM abstraction.

At minimum the v2 repository contract should support:

### User

- `getUserByOpenid(openid)`
- idempotent create-if-absent semantics needed by future `ensureUser`

### Loan

- `getLoan(loanId)`
- bounded/paginated listing by lender or borrower
- participant-safe lookup happens in actions/domain, not by trusting caller-supplied identity

### LedgerRequest

- get by id
- get by idempotency key
- create request with unique idempotency key
- paginated pending-request listing for one user
- compare-and-set / transactional terminal transitions

### LoanEvent

- paginated ordered read by `(loanId, sequence)`
- append with deterministic event idempotency key
- stable next-sequence allocation inside the same transaction that applies a request
- query by `sourceRequestId` without assuming it is unique

### InviteToken

- get by token hash
- create one-time token
- transactional claim/finalization/revocation primitives needed by R5

### Audit

- append audit record; audit failure must not be able to duplicate formal business mutation on retry

## Pagination rules

Any collection that can grow unbounded must not expose a fake `listAll()` that performs one CloudBase `.get()`.

Use an explicit page contract, for example:

```ts
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

Cursor design must have deterministic ordering. For LoanEvent use `(sequence, _id)` or an equivalent stable indexed order. Do not depend on unspecified database return order.

## Transaction boundary

R3 does not implement CREATE_LOAN itself, but the repository/infrastructure must be capable of expressing one transaction that can later:

- reload/request-lock the current `LedgerRequest`;
- verify expected status;
- create/update Loan documents;
- append one or more LoanEvents;
- allocate event sequence numbers safely;
- change request state;
- finalize an InviteToken;
- commit once.

Do not emulate this with read-then-write calls outside a transaction.

## Event sequencing

`LoanEvent.sequence` is authoritative ordering within one Loan.

R3 must choose and document one concurrency-safe strategy. Preferred baseline:

- store `nextEventSequence` on the `Loan` infrastructure document or equivalent transaction-owned counter;
- allocate one or more contiguous sequence values inside the same transaction as the event append;
- never derive the next sequence by reading "latest event + 1" outside the transaction.

If the persisted `Loan` model needs a non-business infrastructure counter, document clearly that it is not an authoritative balance.

## Idempotency

- request `idempotencyKey` unique;
- request `requestFingerprint` compared using the R2 helper;
- event `idempotencyKey` unique;
- `sourceRequestId` intentionally non-unique because CREATE_LOAN creates multiple events;
- deterministic server event keys should be derived from request id and event purpose.

## CloudBase indexes to encode

At minimum plan for:

- `users.openid` unique;
- `loans.createdFromRequestId` unique;
- lender/status and borrower/status query indexes;
- `ledger_requests.idempotencyKey` unique;
- proposer/status and counterparty/status indexes;
- loanId/createdAt or equivalent request history index;
- `loan_events.idempotencyKey` unique;
- `loan_events.(loanId, sequence)` unique/strongly enforced;
- `loan_events.sourceRequestId` non-unique query index;
- `invite_tokens.tokenHash` unique.

## MemoryRepo requirements

MemoryRepo is not throwaway test glue. It should model the same semantics needed by actions:

- unique constraints relevant to business invariants;
- deterministic pagination;
- idempotent inserts;
- transaction-like atomic mutation for unit tests;
- no family/admin concepts.

Do not overbuild a generic in-memory database.

## Tests

At least cover:

- pagination returns all events across multiple pages without duplicates or gaps;
- event order is stable by sequence;
- duplicate request idempotency key with same fingerprint returns original semantics;
- same key/different fingerprint conflicts;
- duplicate event idempotency key does not append a second event;
- `sourceRequestId` may legitimately appear on multiple events;
- sequence allocation remains unique for multiple events in one transaction;
- failed transaction leaves no partial writes in MemoryRepo;
- participant loan listing works in both lender and borrower directions.

CloudBase integration tests may be added when executable credentials/environment are available; do not fake passing CloudBase transaction tests in pure unit tests.

## Explicit non-goals

Do not yet:

- implement `ensureUser` action/router exposure;
- implement CREATE_LOAN business flow;
- implement real invite share/claim flow;
- redesign UI;
- migrate v1 data;
- add compatibility collections.

## Completion gate

R3 is complete when:

1. the repository contract is purely v2;
2. MemoryRepo covers the required semantics with tests;
3. CloudBaseRepo has safe paginated reads and transaction primitives or an explicitly documented implementation boundary sufficient for R4/R5;
4. event ordering/idempotency/index strategy is encoded in code/docs;
5. no old family/admin persistence concept returns;
6. R4 can implement `ensureUser` without redesigning persistence.
