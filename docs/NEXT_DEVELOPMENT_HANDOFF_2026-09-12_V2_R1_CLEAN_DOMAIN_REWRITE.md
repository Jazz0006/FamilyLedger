# Next Development Handoff — v2 R1 Clean Domain Rewrite

**Date:** 2026-09-12  
**Repository:** `Jazz0006/FamilyLedger`  
**Next milestone:** `R1 — Clean v2 domain rewrite`

## Read first

Treat these as authoritative, in this order for their respective concerns:

1. `docs/来往账_产品规划设计书_v2.0.md` — product/business semantics
2. `docs/DATA_MODEL_V2.md` — target domain/persistence shape
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md` — implementation strategy and sequencing
4. `AGENTS.md` — engineering guardrails
5. `CLAUDE.md` — repository operating guidance

The v1.1 product document and current v1.1 production code are historical references only.

## Project decision

Do **not** migrate v1.1 incrementally.

v2 is a clean rewrite of the product/domain/application layers in the same repository.

There is no requirement to preserve:

- v1.1 API compatibility;
- v1.1 UI/navigation;
- family/admin abstractions;
- v1.1 development/test CloudBase data;
- legacy collection schemas;
- unfinished v1.1 actions.

Git history is sufficient preservation for obsolete source code.

Do not create permanent compatibility adapters, dual writes, or legacy-mode conditionals.

## Current code assumptions to remove

The current code still contains v1.1 concepts such as:

- `UserRole.BORROWER/LENDER`;
- `User.familyId`;
- `DEFAULT_FAMILY_ID`;
- `LoanAccount`;
- `LoanTerm`;
- `ChangeRequest`;
- `bootstrapAdmin`;
- `borrowerExists()`;
- family-scoped queries;
- admin-only `recordLodgment`;
- direction-based confirmation;
- family/admin mini-program pages.

Do not build new v2 behavior on these abstractions.

## R1 objective

Establish a clean v2 shared domain foundation before implementing CloudBase business flows.

R1 should make `packages/shared` describe the v2 product directly.

Target concepts:

```text
User
Loan
LedgerRequest
LoanEvent
InviteToken
RateSnapshot
```

Target request types:

```text
CREATE_LOAN
PRINCIPAL_ADD
PRINCIPAL_REPAY
RATE_CHANGE
CORRECTION
CLOSE_LOAN
```

Target statuses:

```text
PENDING
PENDING_INITIATOR_VERIFY
APPLIED
REJECTED
CANCELLED
EXPIRED
```

## Required R1 changes

At minimum:

- remove global role/family semantics from the new `User` type;
- replace `LoanAccount` with `Loan`;
- introduce typed `LedgerRequest` payloads;
- add `RateSnapshot` / `RateSource`;
- update `InviteToken` to request-bound v2 semantics;
- update `LoanEvent` to schema v2 shape including event ordering fields;
- add `LOAN_CLOSED` event type;
- set v2 event schema version;
- define v2 collection names (`loans`, `ledger_requests`, etc.);
- remove `DEFAULT_FAMILY_ID` from the v2 domain;
- prevent the global fixed 5% default from remaining a v2 product invariant.

If legacy types are temporarily required to keep old files compiling during R1, isolate them explicitly as legacy and ensure no new v2 module imports them. Prefer deleting them as soon as the affected old callers are replaced.

## Preserve selectively

Do not rewrite working technical code without reason.

Likely reusable assets include:

- Fen scalar convention;
- `IsoDate` / `EpochMillis` concepts;
- Decimal-based calc engine;
- date/timezone helpers;
- crypto/token hashing;
- build/bundle/deploy plumbing;
- generic audit/idempotency concepts.

Reuse only when semantics still match v2.

## Tests for R1

R1 is primarily a compile/domain milestone. Add focused tests only where useful to protect domain invariants introduced in shared/pure code.

Do not yet spend time testing CloudBase transaction behavior; that belongs to later milestones.

R2 will add explicit state-machine, permission, and idempotency-fingerprint tests.

## Explicit non-goals for R1

Do not:

- redesign mini-program UI;
- implement `CREATE_LOAN` cloud actions yet;
- finish v1.1 `proposeRepayment` / `confirmChange`;
- migrate old CloudBase records;
- implement CPI fetching;
- build a general schema-migration framework;
- maintain two active product models.

## R1 completion gate

R1 is complete when:

1. the shared v2 model matches the authoritative v2 data model;
2. newly written code uses no family/admin/global-role assumptions;
3. v2 collection names and event schema are defined;
4. the project builds/tests successfully, or any remaining build break is confined to clearly identified legacy callers scheduled for immediate replacement;
5. no compatibility layer has been introduced as permanent architecture;
6. the next task can begin as `R2 — state machine, permissions, and idempotency tests` without revisiting the basic domain shape.

## Recommended working approach

Prefer a short, decisive rewrite over a long transitional state.

Where an old type is fundamentally wrong for v2, replace/delete it rather than adding optional fields until it can represent both products.

The goal of R1 is not to preserve maximum code. The goal is to establish the smallest correct foundation for the product we actually intend to ship.
