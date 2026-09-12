# FamilyLedger v2 Clean Rewrite Roadmap

**Status:** authoritative implementation roadmap for the v2 rewrite  
**Date:** 2026-09-12 · refreshed through R11  
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
- no `familyId` / legacy-role compatibility branches;
- no effort to complete unfinished v1.1 business flows;
- no migration framework for disposable development/test data;
- Git history is the archive of v1.1.

If valuable real records are ever discovered, handle them through a separate one-shot import with explicit provenance. Do not distort v2 to fit old data.

---

## 2. Reuse by semantic fit

Worth reusing:

- `packages/calc` mathematical approach and deterministic tests;
- Fen integer money representation;
- Decimal-based interest calculation;
- date/timezone helpers whose semantics still match v2;
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
- admin/family Mini Program pages;
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

Active v2 product/domain concepts:

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

Established v2 shared types, collection names, schema-v2 events and explicit RateSnapshot. Removed family/admin/global-role concepts from the active server/domain layer and removed the implicit historical 5% calculation fallback.

### R2 — State machine / permissions / idempotency — DONE / Draft PR #2

Implemented pure rules for request transitions, known-counterparty and first-contact flows, participant permissions, canonical semantic fingerprints, idempotent retry and same-key/different-payload conflict.

### R3 — Persistence foundation — DONE / Draft PR #3

Implemented v2 `LedgerRepo` / `LedgerTransaction`, `MemoryRepo`, `CloudBaseRepo`, cursor pagination, transaction primitives, deterministic event keys, per-Loan sequence allocation and schema/index contracts.

Current lockfile boundary: `@cloudbase/node-sdk 3.18.3` + `@cloudbase/database 1.4.3`.

### R4 — `ensureUser` — DONE / Draft PR #4

Runtime OPENID → ordinary v2 User. No admin bootstrap, role assignment or family initialization.

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

Implemented `getLoan`, `listLoans`, `listLoanEvents`, `listPendingRequests`, and `getHomeSummary`. One shared Loan/event stream projects as receivable to lender and payable to borrower. Growing reads follow all cursor pages and use `packages/calc` as the money engine.

### R7 — PRINCIPAL_REPAY — DONE / Draft PR #7

Either participant may propose principal repayment; the other confirms. Acceptance reads authoritative history inside the transaction. R11 later strengthened this path so a backdated repayment cannot create a hidden negative-principal interval later in the existing timeline.

### R8 — PRINCIPAL_ADD + RATE_CHANGE — DONE / Draft PR #8

Added mutually confirmed principal addition and rate change. Same-effective-date rate precedence is deterministic by formal event sequence in calc and read projections.

### R9 — CORRECTION / CLOSE semantics — DONE / Draft PR #9

Defined append-only Correction and mutually confirmed final-settlement Close semantics before production implementation.

Key decisions:

- Correction has exactly one dimension: principal or rate;
- Correction never edits/deletes target history;
- Correction effective date derives from target event;
- Close is a settlement boundary, not an invented payment;
- principal must be zero at close;
- server snapshots residual accrued interest;
- accepted close means residual interest has been settled/waived/rounded/otherwise handled offline;
- pre-close history remains reconstructable;
- current projection at/after close is zero.

See `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md`.

### R10 — CORRECTION implementation — DONE / Draft PR #10

Implemented:

- discriminated `PRINCIPAL` / `RATE` Correction payload;
- Correction request fingerprint projection without client effective date;
- `createCorrectionRequest`;
- complete transaction-scoped target lookup;
- principal/rate target validation;
- historical principal non-negative invariant;
- current same-day rate-winner validation;
- deterministic `<requestId>:correction` event;
- accept/reject/cancel support;
- same-dimension correction-of-correction;
- append-only target preservation.

See `docs/V2_R10_CORRECTION_PROGRESS_2026-09-12.md`.

### R11 — CLOSE_LOAN implementation — DONE / Draft PR #11

Implemented:

- `CloseSettlementSnapshot` and `LoanEvent.closeSettlement`;
- lifecycle-aware `LoanSummary.status / closeEffectiveDate / settledInterestFen`;
- transaction-scoped typed Loan lifecycle update;
- `createCloseLoanRequest`;
- future/backdated-close validation;
- complete transaction balance reconstruction;
- zero-principal close requirement;
- residual accrued-interest snapshot;
- deterministic `<requestId>:loan-close` event;
- atomic Loan `CLOSED` + request `APPLIED` + close event;
- idempotent close retry without moving `closedAt`;
- current CLOSED projection = zero from the close boundary onward;
- pre-close historical projection preserved;
- post-close mutations blocked;
- close-vs-other-mutation concurrency serialized;
- CloudBase Loan lifecycle update preserves infrastructure-only `nextEventSequence`;
- shared full principal-timeline invariant now protects both repayment and principal Correction against hidden historical negative balances.

See `docs/V2_R11_CLOSE_LOAN_PROGRESS_2026-09-12.md`.

### R12 — v2 cutover / UI / real CloudBase hardening — NEXT

R12 begins with a **read-only cutover audit** before deleting anything.

Audit and implementation scope:

1. inventory all remaining v1 Mini Program pages/components/API calls;
2. inventory obsolete setup/deploy scripts and collection assumptions;
3. inventory README / CLAUDE / docs that still describe family/admin/v1 behavior;
4. classify each residue as DELETE / REWRITE / KEEP;
5. replace the Mini Program with v2 user/home/loan/request/invite flows;
6. expose correction/close/history UX;
7. provision and verify all required CloudBase collections/indexes;
8. run real two-account invite/consent flows;
9. run real CloudBase concurrency/rollback tests;
10. remove remaining v1 runtime code and obsolete setup assets;
11. finish deployment/security regression.

Audit/export/backup UX may be implemented during R12 after the main cutover path is stable. CPI reference-source automation and cryptographic hash chaining remain post-core enhancements unless a concrete requirement promotes them.

---

## 5. Deletion-first guidance

Prefer deletion whenever old code has no valid v2 responsibility.

Do not create adapters merely to keep a legacy call site alive. Temporary code is acceptable only when it keeps an adjacent rewrite checkpoint buildable and is not imported by new v2 modules.

---

## 6. Data strategy

Current v1 CloudBase content is presumed disposable development data unless explicitly proven otherwise.

Default v2 cutover:

- use fresh v2 collections/indexes;
- validate v2 with fresh test identities/data;
- do not convert family/admin records;
- do not reinterpret unilateral v1 events as mutually confirmed history.

---

## 7. Mandatory production gates

Before production cutover, coverage must include at minimum:

- one User can be lender in one Loan and borrower in another;
- unrelated User cannot read Loan/event/request details;
- first-contact invite claim is single-winner;
- first-contact accept does not create Loan before proposer verification;
- request fingerprint idempotency/conflict behavior;
- atomic CREATE_LOAN genesis set;
- paginated histories reconstruct completely;
- principal timeline never becomes negative after any accepted principal mutation;
- principal add/rate change require mutual consent;
- same-day rate sequence precedence is deterministic;
- rejection/cancellation create no formal event;
- Correction never edits target history;
- backdated principal Correction cannot create a hidden historical negative interval;
- rate Correction targets/supersedes the correct same-day winner;
- Close requires zero principal;
- Close snapshots residual accrued interest;
- Close atomically transitions Loan + request + event;
- CLOSED current projection is zero and does not continue accruing;
- pre-close history remains reconstructable;
- post-close mutation requests cannot apply;
- real CloudBase unique indexes and transaction behavior match MemoryRepo assumptions;
- complete two-account Mini Program flow works on real WeChat identities.

Full workspace `build/typecheck/test` plus real CloudBase two-account/concurrency validation remain merge/production gates.

---

## 8. Immediate next task

Start **R12 — read-only cutover audit** from the R11 checkpoint.

Do not immediately patch the old v1 UI. First identify every remaining legacy runtime/setup/document dependency and classify it as DELETE / REWRITE / KEEP. Then perform the cutover in small reviewable slices.
