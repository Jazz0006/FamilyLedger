# FamilyLedger v2 Clean Rewrite Roadmap

**Status:** authoritative implementation roadmap for the v2 rewrite  
**Date:** 2026-09-12  
**Scope:** implementation strategy and sequencing

This document records the project decision to implement v2 as a **clean rewrite of the product/domain/application layers inside the existing repository**, rather than as a compatibility migration from v1.1.

Business meaning remains governed by:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `AGENTS.md`

For implementation strategy and development order, this roadmap supersedes the older incremental-migration wording in product-spec §24–25 and data-model §21 where those sections imply preserving or gradually adapting v1.1 code.

---

## 1. Decision

v1.1 was a short-lived proof of concept built before the product direction was understood. It has no production compatibility obligation and no architectural status beyond being a reference implementation.

v2 will therefore be built with these rules:

- no backward-compatible v1.1 API layer;
- no permanent dual-model support;
- no dual writes to v1.1 and v2 collections;
- no `if (familyId)` / `legacyRole` compatibility branches in v2 production code;
- no effort to complete unfinished v1.1 features before v2 work;
- no migration of development/test data unless real records are explicitly identified as worth preserving;
- Git history is the archive of the v1.1 implementation.

The default assumption is that disposable v1.1 CloudBase test data may be abandoned.

If real records later need preservation, handle that as a separate, one-shot, explicitly reviewed data-conversion task. Do not distort the v2 domain to accommodate legacy data.

---

## 2. What is worth reusing

The rewrite is not a repository reset. Reuse technical assets whose semantics remain valid:

- `packages/calc` mathematical approach and valid deterministic tests;
- integer Fen money representation;
- Decimal-based interest calculation;
- date/timezone helpers where semantics still match v2;
- server-authoritative OPENID identity boundary;
- token hashing / crypto utilities;
- CloudBase bundling and deployment plumbing;
- small generic error/response utilities where useful;
- MemoryRepo-style testing technique;
- append-only event-ledger principle;
- audit-log concept;
- idempotency-key concept.

Reuse is by **semantic fit**, not by file preservation. A reused module may still need a focused v2 cleanup.

---

## 3. What should be rewritten instead of migrated

Treat these v1.1 areas as disposable product code:

- global `UserRole`;
- `familyId` and `DEFAULT_FAMILY_ID`;
- `LoanAccount` domain model;
- `LoanTerm` as an authoritative persistence model;
- `ChangeRequest` model;
- `bootstrapAdmin` / `borrowerExists`;
- family-scoped repository queries;
- admin-only authorization model;
- direct `recordLodgment` formal event writes;
- direction-based confirmation rules;
- family-member invite semantics;
- admin/family mini-program pages;
- v1.1 router actions and API contracts.

Do not preserve these abstractions merely because working code already exists.

---

## 4. Rewrite architecture

The target dependency direction remains:

```text
Mini Program UI
      ↓
Application Actions / Use Cases
      ↓
Domain + packages/calc
      ↓
Repository Interfaces
      ↓
CloudBase Infrastructure
```

v2 code should be written directly against the v2 domain:

```text
User
Loan
LedgerRequest
LoanEvent
InviteToken
RateSnapshot
```

The v1.1 domain is not an adapter layer and should not sit underneath v2.

---

## 5. Rewrite sequence

### R0 — Freeze v1.1

Immediately stop feature development on the v1.1 model.

Do not implement the unfinished v1.1 repayment/confirmation path or expand admin/family APIs. Only make a v1.1 change if it is needed to recover data or unblock the rewrite environment.

**Exit condition:** all new product work is explicitly v2 work.

### R1 — Clean v2 domain rewrite

Rebuild `packages/shared` around v2 concepts.

Required outcomes:

- `User` has no global role or family;
- introduce `Loan`;
- introduce typed `LedgerRequest` payloads;
- introduce v2 request/status enums;
- introduce `RateSnapshot` and rate-source metadata;
- update `LoanEvent` to schema v2 shape;
- add stable IDs/types where useful;
- define v2 collection names;
- remove the permanent 5% product assumption from the v2 domain;
- keep legacy types only temporarily if compilation requires it, clearly isolated and never imported by new v2 modules.

**Preferred implementation style:** build new v2 types first; delete legacy shared types as soon as all v2 callers exist rather than maintaining aliases.

### R2 — Domain state machine, permissions, and idempotency tests

Before CloudBase mutation code, implement and test pure rules for:

- legal `LedgerRequest` transitions;
- known-counterparty flow;
- first-contact `PENDING_INITIATOR_VERIFY` flow;
- proposer vs counterparty permissions;
- lender/borrower participant checks;
- request fingerprint generation/canonicalization;
- same-key/same-payload retry behavior;
- same-key/different-payload conflict behavior.

These rules must be server-owned even if the UI later mirrors them.

### R3 — v2 persistence contract and safety foundation

Rewrite `LedgerRepo`, `MemoryRepo`, and CloudBase persistence around v2 use cases rather than adapting the family repository interface.

Required foundations:

- paginated reads for unbounded collections;
- v2 collection/index assumptions;
- transaction/CAS support for request application;
- stable event ordering/sequence strategy;
- event-level deterministic idempotency keys;
- no global uniqueness assumption on `sourceRequestId`;
- explicit initial rate event requirement;
- calc path must not silently fall back to a historical v1 fixed 5% when reconstructing a v2 Loan.

### R4 — `ensureUser`

Implement the first v2 server use case:

```text
runtime OPENID
→ find User
→ create normal User if absent
→ return User
```

No admin bootstrap, family initialization, or role assignment.

### R5 — CREATE_LOAN vertical slice

Build the first complete business path:

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ invitee accept/claim
→ PENDING_INITIATOR_VERIFY
→ initiator verifies counterparty
→ atomic Loan + genesis events + request APPLIED
```

The final transaction must atomically establish:

- one `Loan`;
- one initial `PRINCIPAL_ADD` event;
- one initial `RATE_CHANGE` event;
- final request state;
- invite finalization where applicable.

Known counterparties may later skip the first-contact verification step as defined by the product spec.

### R6 — Read model and bidirectional home

Implement:

- `listLoans`;
- `getLoan`;
- `listLoanEvents`;
- `listPendingRequests`;
- `getHomeSummary`.

The same Loan must project as receivable for one participant and payable for the other. Never create per-user balance copies.

### R7 — Repayment vertical slice

Implement `PRINCIPAL_REPAY` using the generic v2 request/application machinery.

Final acceptance must reload current authoritative Loan history and reject an over-repayment. Concurrent accepts must produce exactly one applied event set.

### R8 — Remaining ledger changes

Add, in this order unless a concrete dependency changes the order:

1. `PRINCIPAL_ADD`;
2. `RATE_CHANGE`;
3. `CORRECTION`;
4. `CLOSE_LOAN`.

All use the same propose → consent → apply architecture.

### R9 — v1 deletion and cutover

Once R5–R7 are validated, remove obsolete v1.1 production code rather than leaving it dormant.

Delete or replace:

- v1 actions;
- family/admin repository methods;
- legacy shared types/enums/constants;
- admin/family pages;
- legacy router endpoints;
- obsolete setup assumptions;
- legacy collection creation from current setup tooling.

Keep old implementation only in Git history.

Legacy CloudBase collections may be deleted only after confirming they contain no records worth preserving or after an explicit backup/export.

### R10 — Post-core product work

After the v2 core is stable:

- audit/export/backup UX;
- CPI reference source and prefill behavior;
- UI/interaction polish;
- two-account real-device regression;
- security hardening beyond the MVP baseline if justified.

---

## 6. Deletion-first guidance

During R1–R9, prefer deletion when old code has no valid v2 responsibility.

Do not create adapters just to keep a v1.1 call site alive for a few more commits if that call site itself is scheduled for replacement.

Temporary legacy code is acceptable only when it keeps the repository buildable while the adjacent v2 replacement is being completed. It must be visibly temporary and must not become a dependency of new v2 modules.

---

## 7. Data strategy

Current v1.1 database content is presumed disposable development data unless explicitly proven otherwise.

Default v2 setup:

- create v2 collections/indexes cleanly;
- validate the complete v2 flow with fresh test users/data;
- do not convert old family/admin records;
- do not reinterpret unilateral v1 events as mutually confirmed v2 history.

A one-shot data converter is out of scope unless a concrete preservation requirement is identified.

---

## 8. Testing gates

The rewrite should not copy old tests mechanically. Keep tests only when they validate still-correct semantics.

Mandatory coverage before v2 cutover includes:

- one user can be lender in one Loan and borrower in another;
- unrelated users cannot read a Loan;
- first-contact invite can be claimed only once;
- first-contact acceptance does not create a Loan before initiator verification;
- known-counterparty acceptance applies directly;
- request idempotency fingerprint behavior;
- atomic CREATE_LOAN genesis event set;
- concurrent accept produces one applied result;
- repayment cannot make principal invalid/negative;
- paginated history reconstructs correctly;
- multiple rate changes reconstruct correctly;
- rejected/cancelled/expired requests never create formal events;
- correction appends compensation instead of editing history;
- home receivable/payable views are opposite projections of the same Loan.

---

## 9. Immediate next task

Start **R1 — Clean v2 domain rewrite**.

The first implementation checkpoint should touch only the minimum needed to establish the new domain foundation and its tests. Do not start by editing the mini-program UI or by completing v1.1 cloud actions.

A healthy R1 result leaves the repository in a state where all newly written code speaks only v2 concepts, and the remaining v1.1 code is obviously legacy waiting to be deleted.
