# CLAUDE.md

Guidance for working in `Jazz0006/FamilyLedger`.

## Authority

Use these documents in order for their respective concerns:

1. `docs/来往账_产品规划设计书_v2.0.md` — product/business meaning
2. `docs/DATA_MODEL_V2.md` — target domain/persistence shape
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md` — implementation strategy and sequencing
4. `AGENTS.md` — engineering boundaries
5. milestone handoff/progress docs — current execution state

The v1.1 family-loan code/spec is historical reference only. Do not preserve its API, family/admin model, collection schema, or unfinished actions for compatibility.

## Current status

R1 — Clean v2 Domain Rewrite is implemented on the rewrite branch.

Active TypeScript server/domain code no longer contains the old family/admin action layer or v1 repository contract. The existing Mini Program pages are still the old UI and are temporary reference only; do not let them drive v2 server/domain design.

The cloud router is intentionally disabled during R1 and returns `INVALID_STATE` until new v2 server actions are implemented. Do not restore old actions to make the UI appear functional.

Current checkpoint:

- `docs/V2_R1_CLEAN_DOMAIN_PROGRESS_2026-09-12.md`
- next: `docs/NEXT_DEVELOPMENT_HANDOFF_2026-09-12_V2_R2_STATE_MACHINE_PERMISSIONS_IDEMPOTENCY.md`

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

## Active v2 shared model

Core concepts:

```text
User
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

Target collections:

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

Keep routers thin. Put business rules in focused pure/domain/action modules, CloudBase SDK calls in infrastructure, and money math in `packages/calc`.

## R1 behavior that must not be undone

Do not reintroduce:

- `UserRole.BORROWER/LENDER`;
- `familyId` / `DEFAULT_FAMILY_ID`;
- `bootstrapAdmin`;
- admin-only direct `PRINCIPAL_ADD` or RATE_CHANGE;
- v1 `LoanAccount`, `LoanTerm`, or `ChangeRequest` as active domain models;
- v1 Repo/MemoryRepo/CloudBaseRepo contracts;
- product-level default 5% rate fallback;
- old `setupCollections` schema;
- compatibility branches or dual writes.

Git history is sufficient preservation for removed v1 code.

## Current development order

1. R1 — clean v2 domain + remove obsolete v1 server layer — implemented, executable validation pending
2. R2 — request state machine, permissions, idempotency fingerprint
3. R3 — v2 Repo / MemoryRepo / CloudBaseRepo, pagination, transaction primitives
4. R4 — `ensureUser`
5. R5 — CREATE_LOAN invite/accept/verify/apply closed loop
6. R6 — bidirectional home/query flows
7. R7 — repayment
8. R8 — principal add / rate change / correction / close
9. R9 — remove remaining v1 UI/docs/deployment residue
10. R10 — CPI source, export/backup, UI polish, two-account regression

## Testing

Use tests-first for money, state transitions, permissions, idempotency, transaction-sensitive behavior, and event reconstruction.

Most R2 behavior should be pure unit tests and must not depend on CloudBase. Use real CloudBase integration tests later for runtime OPENID, indexes, transactions, concurrent invite claim, and real two-user flows.

Expected local/CI checks:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Do not claim those checks passed unless they were actually executed.
