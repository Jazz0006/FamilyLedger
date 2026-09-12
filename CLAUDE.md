# CLAUDE.md

Guidance for working in `Jazz0006/FamilyLedger`.

## Authority

Use these documents in order for their respective concerns:

1. `docs/来往账_产品规划设计书_v2.0.md` — product/business meaning
2. `docs/DATA_MODEL_V2.md` — target domain/persistence shape
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md` — implementation strategy and sequencing
4. `AGENTS.md` — engineering boundaries
5. milestone handoff/progress docs — current execution state

The v1.1 family-loan code/spec is historical reference only. Do not preserve its API, family/admin model, collection schema, UI or unfinished actions for compatibility.

## Current status

R1-R11 are implemented on the stacked v2 rewrite branches. R12 cutover is in progress on `codex/v2-r12-cutover-audit`.

Current R12 state:

- cutover audit completed;
- v2 cloud router is active and exposes implemented product actions;
- UI-facing user data uses a safe `UserDisplayProfile` rather than exposing OPENID;
- known counterparties are derived only from existing shared Loans;
- known-counterparty CREATE_LOAN is implemented with ordinary bilateral confirmation;
- the old Mini Program `admin-*` pages are deleted;
- active Mini Program pages are `home`, `create`, `detail`, `confirm` and `bind`;
- first-contact invite tokens are high-entropy bearer credentials; the server stores only hashes;
- unchanged client retries reuse request idempotency identity and invite token;
- GitHub Actions runs `npm ci`, build, typecheck and tests.

The remaining R12 UI gap is dedicated detail-page proposal forms for repayment, principal add, rate change, Correction and Close. Real WeChat/CloudBase two-account and concurrency/index validation also remains mandatory before production cutover.

Current execution records:

- `docs/V2_R12_CUTOVER_AUDIT_2026-09-12.md`
- `docs/V2_R12_CUTOVER_PROGRESS_2026-09-12.md` once present

## v2 domain rules

1. Every WeChat identity is a normal `User`.
2. There is no global borrower/lender role, fixed family, or product-level admin.
3. Borrower/lender direction belongs to one `Loan` only.
4. A Loan is one shared bilateral ledger, not two synchronized copies.
5. Formal ledger mutation follows propose -> counterparty consent -> apply.
6. First-contact invite acceptance additionally requires initiator verification before the first Loan becomes formal.
7. Existing known counterparties use the normal pending-request flow.

## Non-negotiable invariants

- Money is integer Fen and must remain a safe integer.
- `loan_events` are append-only through product APIs.
- Principal/interest/total are derived from formal history.
- `packages/calc` is the only money/interest calculation implementation.
- Every v2 Loan has explicit confirmed rate history; there is no global fallback annual rate.
- CPI/reference metadata may prefill a proposal but never silently changes an existing Loan.
- Runtime OPENID is authoritative identity; never trust a client-supplied user ID as proof of identity.
- Request application plus formal event creation must be transaction/CAS safe.
- Idempotent retries with the same semantic payload return the same result; same key with a different semantic payload is a conflict.
- Growing reads paginate; balance reconstruction must never use a truncated event stream.
- First-contact bearer tokens must be generated from cryptographically secure randomness and persisted only as hashes server-side.

## Active v2 shared model

Core concepts:

```text
User
UserDisplayProfile
Loan
LedgerRequest
LoanEvent
InviteToken
RateSnapshot
```

Request types:

```text
CREATE_LOAN
PRINCIPAL_ADD
PRINCIPAL_REPAY
RATE_CHANGE
CORRECTION
CLOSE_LOAN
```

Request states:

```text
PENDING
PENDING_INITIATOR_VERIFY
APPLIED
REJECTED
CANCELLED
EXPIRED
```

Collections:

```text
users
loans
ledger_requests
loan_events
invite_tokens
audit_logs
rate_references   # optional/future
```

Legacy `loan_accounts`, `loan_terms`, and `change_requests` are not v2 collections.

## Architecture

```text
Mini Program UI
      ↓
Application Actions / Use Cases
      ↓
Domain + packages/calc
      ↓
Repository Interfaces
      ↓
CloudBase Repository / Infrastructure
```

Keep routers thin. Put business rules in focused domain/action modules, CloudBase SDK calls in infrastructure, and money math in `packages/calc`.

## Do not reintroduce v1

Do not reintroduce:

- `UserRole.BORROWER/LENDER`;
- `familyId` / `DEFAULT_FAMILY_ID`;
- `bootstrapAdmin`;
- family-wide privileged views;
- admin-only direct principal/rate writes;
- v1 `LoanAccount`, `LoanTerm`, or `ChangeRequest` as active models;
- v1 Repo contracts or collections;
- product-level default 5% fallback;
- old family invite/bind flows;
- `admin-*` Mini Program pages;
- compatibility branches or dual writes.

Git history is sufficient preservation for removed v1 code.

## Current development direction

R1-R11 established the v2 backend/core. R12 owns cutover and hardening:

1. R12A — cutover audit + UI-facing contracts + known-counterparty CREATE_LOAN — implemented.
2. R12B — active v2 Mini Program shell and removal of v1 admin UI — implemented/in validation.
3. Next UI slice — Loan-detail mutation proposal forms for repayment/principal add/rate change/Correction/Close.
4. CloudBase environment hardening — provision/verify required indexes, transaction behavior and rollback semantics.
5. Real two-account WeChat regression — first contact, known counterparty, both debt directions, consent/reject/cancel, concurrency.
6. Remaining deployment/document/security cleanup.

## Testing

Use tests-first for money, state transitions, permissions, idempotency, transaction-sensitive behavior and event reconstruction.

Expected CI/local gate:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

Do not claim the current head passed until its actual CI run completed successfully. Unit/MemoryRepo success does not replace real CloudBase integration testing.
