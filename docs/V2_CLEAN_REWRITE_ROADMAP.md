# FamilyLedger v2 Clean Rewrite Roadmap

**Status:** authoritative implementation roadmap for the v2 rewrite  
**Date:** 2026-09-12 · refreshed through R9  
**Scope:** implementation strategy and sequencing

Business meaning and implementation shape are governed by:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `AGENTS.md`

This roadmap owns development sequencing. v2 is a **clean rewrite of product/domain/application layers inside the existing repository**, not a compatibility migration from v1.1.

---

## 1. Non-negotiable rewrite decision

v1.1 was a short-lived proof of concept. It has no production compatibility obligation.

Therefore:

- no backward-compatible v1.1 API layer;
- no permanent dual-model support;
- no dual writes to v1.1 and v2 collections;
- no `if (familyId)` / legacy-role compatibility branches;
- no effort to complete unfinished v1.1 business flows;
- no migration framework for disposable development/test data;
- Git history is the archive of v1.1.

If valuable real records are ever discovered, handle them through a separate one-shot import with explicit provenance. Do not distort v2 to fit old data.

---

## 2. Reuse by semantic fit

Worth reusing:

- `packages/calc` mathematical approach and valid deterministic tests;
- Fen integer money representation;
- Decimal-based interest calculation;
- date/timezone helpers that still match v2 semantics;
- runtime OPENID identity boundary;
- token hashing/crypto helpers;
- CloudBase build/deploy plumbing;
- generic error/response utilities;
- MemoryRepo testing approach;
- append-only event-ledger principle;
- audit-log and idempotency concepts.

Disposable v1 product abstractions include:

- global `UserRole`;
- `familyId` / `DEFAULT_FAMILY_ID`;
- `LoanAccount`;
- `LoanTerm` as truth;
- `ChangeRequest`;
- `bootstrapAdmin`;
- family-scoped queries;
- admin-only authorization;
- direction-based confirmation;
- family invite semantics;
- admin/family mini-program pages;
- v1 router/API contracts.

---

## 3. Target architecture

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

New code speaks only these v2 concepts:

```text
User
Loan
LedgerRequest
LoanEvent
InviteToken
RateSnapshot
```

---

## 4. Milestones and current status

### R0 — Freeze v1.1 — DONE

No further v1 business feature development.

### R1 — Clean v2 domain rewrite — DONE / Draft PR #1

Established v2 shared types, collection names, schema-v2 events, explicit RateSnapshot, and removed family/admin/global-role concepts from active v2 code.

Also removed the implicit historical 5% calculation fallback.

### R2 — State machine / permissions / idempotency — DONE / Draft PR #2

Implemented pure rules for:

- LedgerRequest transitions;
- known-counterparty workflow;
- first-contact initiator verification;
- participant permissions;
- canonical semantic fingerprint;
- same-key/same-payload retry;
- same-key/different-payload conflict.

### R3 — Persistence foundation — DONE / Draft PR #3

Implemented:

- v2 `LedgerRepo` / `LedgerTransaction`;
- `MemoryRepo`;
- `CloudBaseRepo`;
- bounded cursor pagination;
- transaction primitives;
- deterministic formal-event keys;
- monotonic per-Loan sequence allocation;
- schema/index contract.

The actual lockfile boundary is `@cloudbase/node-sdk 3.18.3` + `@cloudbase/database 1.4.3`.

### R4 — `ensureUser` — DONE / Draft PR #4

Runtime OPENID → ordinary v2 User. No admin bootstrap, role assignment, family initialization, or automatic Loan creation.

### R5 — CREATE_LOAN first-contact vertical slice — DONE / Draft PR #5

Implemented:

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ invitee claim/accept
→ PENDING_INITIATOR_VERIFY
→ proposer verifies identity
→ atomic Loan + initial principal + initial rate + APPLIED
```

No Loan exists before final first-contact verification.

### R6 — Read model / bidirectional home — DONE / Draft PR #6

Implemented:

- `getLoan`;
- `listLoans`;
- `listLoanEvents`;
- `listPendingRequests`;
- `getHomeSummary`.

One shared Loan/event stream projects as receivable to lender and payable to borrower. Reads follow all cursor pages and use `packages/calc` as the money engine.

### R7 — PRINCIPAL_REPAY — DONE / Draft PR #7

Either participant may propose principal repayment; the other confirms.

Final acceptance rehydrates the complete event stream inside the transaction and rejects over-repayment. Concurrent stale repayments cannot both drive principal below zero.

### R8 — PRINCIPAL_ADD + RATE_CHANGE — DONE / Draft PR #8

Added mutually confirmed principal addition and rate change.

Also made same-effective-date rate precedence explicitly deterministic by formal event sequence in both calc and read projections.

### R9 — CORRECTION / CLOSE semantics — CURRENT DESIGN CHECKPOINT

No production mutation code in this milestone.

Authoritative decisions:

#### Correction

- one request = one correction dimension;
- principal correction or rate correction, never both;
- append one compensating `CORRECTION` event;
- never edit/delete target history;
- Correction effectiveDate derives from the target event;
- principal correction must not create negative principal on any affected historical ledger day;
- rate correction targets the current winning rate-affecting event for that effectiveDate.

#### Close

- close is a mutually confirmed final settlement boundary, not an invented payment;
- principal must be zero at close;
- server snapshots remaining accrued interest;
- acceptance means residual interest is settled/waived/otherwise handled offline;
- historical pre-close math remains reconstructable;
- current projection at/after close is zero and stops accruing interest.

See:

- `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md`
- updated product spec §13–16
- updated `DATA_MODEL_V2.md`.

### R10 — CORRECTION implementation — NEXT PRODUCTION MILESTONE

Implement the narrowed discriminated Correction payload and one-event compensation flow.

Required work:

- shared type change;
- request fingerprint projection change;
- `createCorrectionRequest`;
- target lookup from complete transaction event stream;
- principal target/type validation;
- historical principal non-negative replay validation;
- rate target winner validation;
- deterministic `<requestId>:correction` event;
- expand shared accept/reject/cancel support to CORRECTION;
- read-model/history tests for compensation chains.

### R11 — CLOSE_LOAN implementation

Required work:

- `CloseSettlementSnapshot` shared type;
- `LoanSummary.status / closeEffectiveDate / settledInterestFen`;
- repository transaction capability to update Loan lifecycle;
- `createCloseLoanRequest`;
- full transaction balance/effective-date validation;
- `LOAN_CLOSED` event;
- atomic Loan CLOSED + request APPLIED;
- current closed projection = zero;
- historical pre-close projection remains available;
- post-close mutations fail.

### R12 — v2 cutover / UI / real CloudBase hardening

After the core server semantics are complete:

- remove remaining obsolete v1 UI/pages/endpoints;
- provision/verify all required CloudBase indexes;
- real two-account invite/consent flows;
- real concurrency tests;
- closed/history UI;
- correction UI;
- audit/export/backup UX;
- deployment hardening;
- final production regression.

CPI reference-source automation and cryptographic hash chaining are post-core enhancements unless a concrete requirement promotes them.

---

## 5. Deletion-first guidance

Prefer deletion whenever old code has no valid v2 responsibility.

Do not create adapters merely to keep a legacy call site alive. Temporary code is acceptable only when it keeps an adjacent rewrite checkpoint buildable and is not imported by new v2 modules.

---

## 6. Data strategy

Current v1 CloudBase content is presumed disposable development data unless explicitly proven otherwise.

Default setup:

- use fresh v2 collections/indexes;
- validate v2 with fresh test identities/data;
- do not convert family/admin records;
- do not reinterpret unilateral v1 events as mutually confirmed history.

---

## 7. Mandatory testing gates

Before production cutover, coverage must include at minimum:

- one User can be lender in one Loan and borrower in another;
- unrelated User cannot read Loan/event/request details;
- first-contact invite claim is single-winner;
- first-contact accept does not create Loan before proposer verifies identity;
- request fingerprint idempotency/conflict behavior;
- atomic CREATE_LOAN genesis set;
- paginated histories reconstruct completely;
- concurrent repayment cannot make principal negative;
- principal add/rate change require mutual consent;
- same-day rate sequence precedence is deterministic;
- rejection/cancellation create no formal event;
- Correction never edits target history;
- backdated principal Correction cannot create a hidden historical negative-principal interval;
- rate Correction targets/supersedes the correct same-day winner;
- Close requires zero principal;
- Close snapshots residual accrued interest;
- Close atomically transitions Loan + request + event;
- CLOSED current projection is zero and does not continue accruing;
- pre-close history remains reconstructable;
- post-close mutation requests cannot apply.

Full workspace `build/typecheck/test` plus real CloudBase two-account/concurrency validation remain merge/production gates.

---

## 8. Immediate next task

Start **R10 — CORRECTION implementation** from the R9 semantic checkpoint.

Do not implement CLOSE_LOAN first. Correction is the remaining mechanism needed to repair an invalid principal/rate history before a Loan can safely satisfy close conditions.
