# FamilyLedger v2 Clean Rewrite Roadmap

**Status:** authoritative implementation roadmap for the v2 rewrite  
**Date:** 2026-09-12 · refreshed through R12B  
**Scope:** implementation strategy and sequencing

Business meaning and implementation shape are governed by:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `AGENTS.md`

This roadmap owns development sequencing. v2 is a **clean rewrite of product/domain/application layers inside the existing repository**, not a compatibility migration from v1.1.

---

## 1. Non-negotiable rewrite decision

v1.1 was a short-lived proof of concept with no production compatibility obligation.

Therefore:

- no backward-compatible v1.1 API layer;
- no permanent dual-model support or dual writes;
- no `familyId` / legacy-role compatibility branches;
- no effort to finish obsolete v1.1 business flows;
- no migration framework for disposable development/test data;
- Git history is the archive of removed v1.1 code.

If valuable real records are ever discovered, handle them through a separate one-shot import/export with explicit provenance. Do not distort v2 to fit old data.

---

## 2. Reuse by semantic fit

Keep/reuse when semantics still match:

- `packages/calc` deterministic mathematical approach;
- Fen integer money;
- Decimal-based interest calculation;
- date/timezone helpers;
- runtime OPENID identity boundary;
- token hashing/crypto helpers;
- CloudBase build/deploy plumbing;
- generic error/response utilities;
- MemoryRepo testing approach;
- append-only event ledger;
- audit and idempotency concepts.

Disposable v1 product abstractions include:

- global `UserRole`;
- `familyId` / `DEFAULT_FAMILY_ID`;
- `LoanAccount`, `LoanTerm` as truth, `ChangeRequest`;
- `bootstrapAdmin` and admin-only authorization;
- family-scoped queries and family-wide privileged views;
- direction-based unilateral confirmation rules;
- family invite/bind semantics;
- admin/family Mini Program pages;
- v1 router/API contracts and collections.

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

Active v2 concepts:

```text
User / UserDisplayProfile
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

Established v2 shared types/collections/schema-v2 events and explicit RateSnapshot. Removed family/admin/global-role concepts from active server/domain code and removed implicit 5% fallback.

### R2 — State machine / permissions / idempotency — DONE / Draft PR #2

Implemented explicit request transitions, participant permissions, first-contact/known-counterparty rules, canonical semantic fingerprints and same-key/different-payload conflict.

### R3 — Persistence foundation — DONE / Draft PR #3

Implemented `LedgerRepo`, `LedgerTransaction`, `MemoryRepo`, `CloudBaseRepo`, cursor pagination, transaction primitives, deterministic event keys, per-Loan sequence allocation and executable index contract.

Current locked baseline remains `@cloudbase/node-sdk 3.18.3` + `@cloudbase/database 1.4.3`; SDK migration is deliberately separate from product semantics.

### R4 — `ensureUser` — DONE / Draft PR #4

Runtime OPENID → ordinary v2 User. No admin bootstrap, role assignment or family initialization.

### R5 — CREATE_LOAN first-contact slice — DONE / Draft PR #5

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ invitee claim
→ PENDING_INITIATOR_VERIFY
→ proposer verifies claimant
→ atomic Loan + initial principal + initial rate + APPLIED
```

No Loan exists before final initiator verification.

### R6 — Read model / bidirectional home — DONE / Draft PR #6

Implemented participant-safe Loan/read actions and shared event-stream projections. One Loan is receivable to lender and payable to borrower. Growing reads paginate and money projections use `packages/calc`.

### R7 — PRINCIPAL_REPAY — DONE / Draft PR #7

Either participant may propose repayment; counterparty confirmation applies it. Acceptance rebuilds authoritative transaction-scoped history and prevents hidden negative-principal intervals.

### R8 — PRINCIPAL_ADD + RATE_CHANGE — DONE / Draft PR #8

Added mutually confirmed principal addition and rate change. Same-effective-date rate precedence is deterministic by formal event sequence.

### R9 — CORRECTION / CLOSE semantics — DONE / Draft PR #9

Locked append-only Correction and final-settlement Close semantics before implementation. See `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md`.

### R10 — CORRECTION implementation — DONE / Draft PR #10

Implemented typed principal/rate corrections, target validation, request fingerprinting, append-only correction events, historical principal non-negative validation and correction-of-correction rules.

See `docs/V2_R10_CORRECTION_PROGRESS_2026-09-12.md`.

### R11 — CLOSE_LOAN implementation — DONE / Draft PR #11

Implemented zero-principal close requirement, residual-interest settlement snapshot, deterministic close event, atomic Loan/request/event transition, lifecycle-aware projections, idempotent retries and post-close mutation blocking.

See `docs/V2_R11_CLOSE_LOAN_PROGRESS_2026-09-12.md`.

### R12 — v2 cutover / UI / real CloudBase hardening — IN PROGRESS

#### R12 audit — DONE

Completed read-only cutover audit and classified remaining runtime/UI/docs/setup assets as DELETE / REWRITE / KEEP.

Key result: the old Mini Program was still an entire v1 family/admin client while the backend was already v2, so it was treated as a rewrite rather than patched with compatibility adapters.

See `docs/V2_R12_CUTOVER_AUDIT_2026-09-12.md`.

#### R12A — UI-facing server contract — DONE

Implemented:

- `UserDisplayProfile` without OPENID exposure;
- internal `getUserById` persistence capability;
- human-readable counterparty profiles on Loan/pending/invite reads;
- `listKnownCounterparties` derived only from existing shared Loans;
- `createKnownLoanRequest` / `acceptKnownLoanRequest` for subsequent Loans between already-known parties;
- server-side relationship validation so knowledge of an arbitrary user ID does not create authorization;
- shared CREATE_LOAN genesis writer for first-contact and known-counterparty paths;
- first-contact proposer cancellation after claimant acceptance;
- regression coverage for UI-facing profile/privacy and relationship boundaries.

#### R12B — active v2 Mini Program cutover — DONE / VALIDATING

The active Mini Program now contains only v2 user flows:

```text
home
create
detail
confirm
bind
```

Implemented:

- ordinary-user bootstrap;
- bidirectional home totals and active Loan lists;
- first-contact or known-counterparty new Loan creation in either debt direction;
- cryptographically secure first-contact bearer token generation via WeChat secure randomness;
- retry-stable request idempotency key + invite token for unchanged submissions;
- invite preview/acceptance;
- initiator claimant verify/cancel;
- normal pending accept/reject;
- known-counterparty CREATE_LOAN acceptance;
- Loan summary and fully paginated formal event history;
- physical deletion of all `admin-*` Mini Program pages;
- v2 app/project naming and client documentation.

GitHub Actions now executes the full workspace build/typecheck/test gate on pushes/PRs. A successful CI checkpoint exists after the R12B code/test changes; each later documentation/head change must still be checked independently before claiming its head is green.

#### R12C — Loan mutation proposal UI — NEXT

Add focused proposal forms from the Loan-detail context for server capabilities already implemented:

1. PRINCIPAL_REPAY;
2. PRINCIPAL_ADD;
3. RATE_CHANGE;
4. CORRECTION;
5. CLOSE_LOAN.

Rules:

- forms only propose; client never applies formal ledger effects directly;
- use integer Fen parsing and explicit rate snapshots;
- preserve mutation idempotency keys across unchanged network retries;
- show exact action/amount/date/rate before submit;
- closed Loans do not expose normal mutation entry points;
- Correction UX must preserve typed principal-vs-rate semantics and target-event selection;
- Close UX must communicate that it is a mutually confirmed settlement boundary, not an in-app payment.

#### R12D — real CloudBase / two-account hardening — AFTER R12C

- provision and verify all required v2 collections/indexes from `schema-contract.ts`;
- verify runtime OPENID identity behavior;
- verify real transaction commit/rollback semantics;
- verify duplicate-key/error behavior against repository assumptions;
- run concurrent invite claim / request application checks;
- run real two-account WeChat flows in both debt directions;
- validate share/invite paths on devices;
- complete deployment/security regression and remove any remaining obsolete setup/docs residue.

Audit/export/backup UX and CPI reference automation remain post-core unless a concrete product requirement promotes them.

---

## 5. Deletion-first guidance

Prefer deletion whenever old code has no valid v2 responsibility. Do not create adapters merely to keep a legacy call site alive.

Temporary code is acceptable only when it keeps an adjacent rewrite checkpoint buildable and is not imported as a new v2 dependency.

---

## 6. Data strategy

Current v1 CloudBase content is presumed disposable development data unless explicitly proven otherwise.

Default v2 cutover:

- use fresh v2 collections/indexes;
- validate with fresh test identities/data;
- do not convert family/admin records;
- do not reinterpret unilateral v1 events as mutually confirmed history.

---

## 7. Mandatory production gates

Before production cutover, coverage must include at minimum:

- one User can be lender in one Loan and borrower in another;
- unrelated User cannot read Loan/event/request details;
- UI-facing relationship data never exposes OPENID;
- arbitrary user IDs cannot bypass known-counterparty relationship validation;
- first-contact invite token uses high-entropy secure randomness and stored hash only;
- first-contact invite claim is single-winner;
- first-contact accept does not create Loan before proposer verification;
- proposer can reject a wrong claimant by cancellation without creating a Loan;
- request fingerprint/idempotent retry conflict behavior;
- atomic CREATE_LOAN genesis set;
- paginated histories reconstruct completely;
- principal timeline never becomes negative after accepted principal mutation;
- principal add/rate change require mutual consent;
- same-day rate sequence precedence is deterministic;
- rejection/cancellation create no formal event;
- Correction never edits target history;
- Close requires zero principal and snapshots residual accrued interest;
- Close atomically transitions Loan + request + event;
- CLOSED current projection is zero and does not continue accruing;
- pre-close history remains reconstructable;
- post-close mutation requests cannot apply;
- full workspace `npm ci / build / typecheck / test` succeeds;
- real CloudBase unique indexes and transaction behavior match MemoryRepo assumptions;
- complete two-account Mini Program flow works with real WeChat identities.

---

## 8. Immediate next task

Start **R12C — Loan mutation proposal UI** after confirming the latest R12B branch head remains green in CI.

Do not begin real production cutover merely because unit/workspace CI passes. R12D real CloudBase/two-account validation remains a separate mandatory gate.
