# Next Development Handoff — v2 R2 State Machine, Permissions, Idempotency

**Date:** 2026-09-12  
**Repository:** `Jazz0006/FamilyLedger`  
**Current branch:** `codex/v2-r1-clean-domain`  
**Next milestone:** `R2 — state machine, permissions, and idempotency fingerprint`

## Read first

Use these as authority:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md`
4. `AGENTS.md`
5. `docs/V2_R1_CLEAN_DOMAIN_PROGRESS_2026-09-12.md`

R1 removed the v1.1 family/admin server business layer. Do not reintroduce it.

## R2 objective

Build the small pure domain/application rules that every later CloudBase action will depend on before persistence code is written.

R2 should answer deterministically:

- may this request status transition to that status?;
- is this actor allowed to perform the transition?;
- is this actor a participant in the Loan?;
- who is the counterparty for a Loan-scoped request?;
- is a CREATE_LOAN first-contact request structurally valid?;
- does an idempotency retry represent the same semantic request or a conflicting payload?

These rules must be testable without CloudBase.

## Recommended ownership

Prefer small pure modules, for example:

```text
cloud/functions/ledger/src/domain/
  request-state.ts
  permissions.ts
  request-fingerprint.ts
  validation.ts        # only if real shared validation emerges
```

Do not build generic framework abstractions. Keep each module focused on the concrete v2 rules.

## Request state machine

Known counterparty:

```text
PENDING
  -> APPLIED
  -> REJECTED
  -> CANCELLED
  -> EXPIRED
```

First-contact:

```text
PENDING
  -> PENDING_INITIATOR_VERIFY
      -> APPLIED
      -> CANCELLED
      -> EXPIRED
  -> REJECTED
  -> CANCELLED
  -> EXPIRED
```

No transition out of terminal states is legal.

R2 should expose a pure transition assertion/helper rather than scattering status checks across future actions.

## Permission rules

Loan-scoped operations:

- only `loan.lenderUserId` or `loan.borrowerUserId` may read/propose;
- proposer cannot accept/reject their own normal pending request;
- counterparty may accept/reject a normal pending request;
- only proposer may cancel their own pending request;
- unrelated users may not read/modify the Loan or request;
- borrower/lender direction is derived from the Loan, never from a User role.

First-contact CREATE_LOAN:

- proposer identity is fixed when request is created;
- unknown party is exactly one side (`BORROWER` or `LENDER`);
- invite claimant identity comes from trusted runtime identity later, not a client-supplied ID;
- after invitee acceptance, only the original proposer can perform initiator verification;
- `PENDING_INITIATOR_VERIFY -> APPLIED` is not yet implemented as persistence in R2, only its domain permission/state rule.

## Idempotency fingerprint

Implement deterministic canonical semantic fingerprinting for client-originated mutation requests.

Required behavior:

1. semantically identical payload + same idempotency key => same fingerprint;
2. object key order must not change the fingerprint;
3. changing amount, request type, Loan, counterparty, effective date, rate metadata, correction target, etc. must change the fingerprint;
4. transport-only or server-generated fields must not be included accidentally;
5. use a stable canonical representation plus SHA-256 (or another explicitly documented deterministic cryptographic hash already available in runtime);
6. never treat "same key, different fingerprint" as an idempotent success — later actions must return `CONFLICT`.

Keep fingerprint generation pure so MemoryRepo/action tests can use it without CloudBase.

## Minimum tests

At least cover:

### State transitions

- known-counterparty PENDING -> APPLIED allowed;
- PENDING -> REJECTED/CANCELLED/EXPIRED allowed;
- first-contact PENDING -> PENDING_INITIATOR_VERIFY allowed;
- PENDING_INITIATOR_VERIFY -> APPLIED/CANCELLED/EXPIRED allowed;
- PENDING_INITIATOR_VERIFY -> REJECTED rejected unless product spec explicitly changes;
- terminal -> anything rejected;
- APPLIED cannot revert.

### Permissions

- same User may be lender in one Loan and borrower in another;
- lender and borrower can read their Loan;
- unrelated User cannot read it;
- participant can propose a Loan-scoped change;
- proposer cannot accept own normal request;
- counterparty can accept/reject;
- only proposer can cancel;
- first-contact initiator verification is proposer-only.

### Fingerprint

- same semantic request with reordered object keys hashes identically;
- one-field semantic change hashes differently;
- rate snapshot metadata is included;
- CREATE_LOAN direction/counterparty semantics are included;
- correction target is included.

## Explicit non-goals

Do not yet:

- create v2 CloudBase repositories;
- implement database transactions;
- implement `ensureUser`;
- create or claim real invite tokens;
- implement CREATE_LOAN application;
- restore old server actions;
- redesign the Mini Program UI.

Those belong to R3+.

## Completion gate

R2 is complete when:

1. request transitions are centralized and exhaustively tested;
2. participant/counterparty/proposer permission helpers are pure and tested;
3. request fingerprinting is stable, canonical and tested;
4. no global role/family/admin concept appears in the new domain modules;
5. build/typecheck/tests pass in an executable environment;
6. R3 can build repository/transaction primitives against these rules without redefining them.
