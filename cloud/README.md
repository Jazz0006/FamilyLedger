# Cloud functions (Tencent CloudBase)

This directory is the server-authoritative boundary for the v2 bilateral ledger. The v1.1 family/admin action layer and persistence model were removed during the clean rewrite and are not compatibility targets.

## Active v2 router

The `ledger` cloud function is active. Current routed actions include:

### Identity / discovery

- `ensureUser`
- `listKnownCounterparties`

### CREATE_LOAN

First contact:

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ acceptInviteRequest
→ verifyFirstCounterparty
→ atomic Loan + two genesis events
```

Known counterparty:

```text
createKnownLoanRequest
→ acceptKnownLoanRequest
→ atomic Loan + two genesis events
```

### Reads

- `getHomeSummary`
- `getLoan`
- `listLoans`
- `listLoanEvents`
- `listPendingRequests`

### Existing-Loan mutations

- `createRepaymentRequest`
- `createPrincipalAddRequest`
- `createRateChangeRequest`
- `createCorrectionRequest`
- `createCloseLoanRequest`
- `acceptRequest`
- `rejectRequest`
- `cancelRequest`

Routers stay thin; state, permission, validation, calculation and persistence rules live in focused modules below `src/actions`, `src/domain`, `src/data` and `packages/calc`.

## Collections

Active v2 collections:

- `users`
- `loans`
- `ledger_requests`
- `loan_events`
- `invite_tokens`
- `audit_logs`
- optional/future `rate_references`

Do **not** recreate legacy `loan_accounts`, `loan_terms`, or `change_requests`.

## Persistence contract

The application layer depends on `src/data/repo.ts`, not raw CloudBase query objects.

Implementations/support:

- `src/data/memory-repo.ts` — deterministic transactional tests;
- `src/data/cloudbase-repo.ts` — CloudBase adapter;
- `src/data/cursor.ts` — opaque stable pagination cursors;
- `src/data/event-idempotency.ts` — deterministic formal-event keys and collision checks;
- `src/data/schema-contract.ts` — executable required-index contract.

The current CloudBase SDK type declarations do not completely model the transaction callback surface used by the runtime. That declaration gap is isolated as a narrow structural cast inside the CloudBase adapter; it must not leak `any`/SDK assumptions into application/domain code.

## Pagination

Growing collections never rely on an unbounded one-shot `get()`.

- Loan/request lists: `createdAt DESC, _id DESC` cursor.
- Loan events: `sequence ASC` cursor.
- page size is bounded to 1–100.
- complete balance/history reconstruction follows continuation cursors until exhausted.

A completely full CloudBase page may yield a continuation cursor even when it was the exact final multiple of page size; the next bounded read may then return empty. This is intentional and preferable to silent truncation.

## Event ordering

`LoanEvent.sequence` is authoritative within one Loan.

CloudBase persists an infrastructure-only Loan field:

```text
nextEventSequence
```

It is not domain balance state. It reserves contiguous event sequences inside the same transaction that appends formal events. Never derive the next sequence from an out-of-transaction “latest event” query.

## Required indexes

The executable source of truth is `src/data/schema-contract.ts`.

| Collection | Index | Unique |
|---|---|---:|
| `users` | `openid` | yes |
| `loans` | `createdFromRequestId` | yes |
| `loans` | `lenderUserId, status, createdAt DESC, _id DESC` | no |
| `loans` | `borrowerUserId, status, createdAt DESC, _id DESC` | no |
| `ledger_requests` | `idempotencyKey` | yes |
| `ledger_requests` | `counterpartyUserId, status, createdAt DESC, _id DESC` | no |
| `ledger_requests` | `proposerUserId, status, createdAt DESC, _id DESC` | no |
| `ledger_requests` | `loanId, createdAt DESC, _id DESC` | no |
| `loan_events` | `idempotencyKey` | yes |
| `loan_events` | `loanId, sequence` | yes |
| `loan_events` | `sourceRequestId` | **no** |
| `invite_tokens` | `tokenHash` | yes |

`loan_events.sourceRequestId` is intentionally non-unique because one CREATE_LOAN request creates two genesis events: initial principal and initial rate.

## Transaction boundaries

Formal operations that must be all-or-nothing use `LedgerRepo.runTransaction()`.

Examples:

- first-contact claim binds invite + request identity atomically but does not create a Loan;
- first-contact final verification creates Loan + both genesis events + APPLIED atomically;
- known-counterparty CREATE_LOAN acceptance creates the same genesis set atomically;
- existing-Loan accepted mutations append the formal event and transition the request atomically;
- Close additionally updates the typed Loan lifecycle projection atomically.

Balance-sensitive acceptance reads the complete relevant formal history from the same transaction snapshot before appending.

## Idempotency

- `ledger_requests.idempotencyKey` is unique.
- `requestFingerprint` distinguishes a legitimate retry from same-key/different-semantics conflict.
- `loan_events.idempotencyKey` is unique.
- server event keys are deterministic (`<requestId>:<purpose>`).
- event sequence and event idempotency collisions fail closed.
- first-contact invite raw tokens are bearer credentials; only their SHA-256 hashes are persisted.

## Security boundary

- Runtime OPENID is authoritative identity.
- Client-supplied user IDs never prove identity.
- `UserDisplayProfile` omits OPENID from UI-facing relationship data.
- Known counterparties are derived from existing shared Loans; arbitrary user IDs cannot bypass relationship checks.
- Clients do not directly mutate formal ledger collections.
- Formal `loan_events` are append-only through product APIs.
- Applying a request and creating its formal accounting effect is transactionally atomic.

## SDK baseline

The dependency range is `@cloudbase/node-sdk ^3.9.0`; the current lockfile resolves 3.18.3 with `@cloudbase/database 1.4.3`.

The v2 rewrite intentionally did not combine product semantics with an SDK migration. A future SDK upgrade should remain isolated behind `LedgerRepo`/`CloudBaseRepo`.

## Validation

From the repository root:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run bundle -w @family-ledger/cloud-ledger
```

GitHub Actions runs the first four commands. Real CloudBase testing is still required before production release for runtime OPENID, actual index definitions, transaction/rollback semantics, duplicate-key error shapes, concurrent invite/request application and full two-account flows.
