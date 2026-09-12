# Cloud functions (Tencent CloudBase)

This directory is the server-authoritative boundary for the v2 bilateral ledger.

## Current rewrite status

The v1.1 family/admin action layer and repository implementation were intentionally removed in **R1 — Clean v2 Domain Rewrite**. They are not compatibility targets.

Current checkpoints:

1. R1 — clean v2 domain foundation;
2. R2 — request state machine, permissions, request fingerprinting;
3. **R3 — v2 persistence contract, MemoryRepo, CloudBaseRepo, cursor pagination, transaction primitives and index contract.**

The `ledger` entry point is still deliberately disabled for product actions. R4 will restore the first real v2 action (`ensureUser`); R5 will add the first formal ledger write flow (`CREATE_LOAN`). Do not deploy the current rewrite branch as a finished ledger backend.

## Target collections

The v2 target collections are:

- `users`
- `loans`
- `ledger_requests`
- `loan_events`
- `invite_tokens`
- `audit_logs`
- optional future `rate_references`

Do **not** recreate the legacy `loan_accounts`, `loan_terms`, or `change_requests` schema for v2.

## Persistence contract

The application layer depends on `src/data/repo.ts`, not directly on CloudBase query objects.

Implementations:

- `src/data/memory-repo.ts` — deterministic transactional test implementation;
- `src/data/cloudbase-repo.ts` — CloudBase implementation;
- `src/data/cursor.ts` — opaque stable pagination cursors;
- `src/data/event-idempotency.ts` — deterministic formal-event keys and collision checks;
- `src/data/schema-contract.ts` — required database index contract.

There is intentionally no generic ORM/repository framework.

## Pagination

Growing collections never expose an unbounded one-shot `get()` assumption.

- Loan/request lists: `createdAt DESC, _id DESC` cursor.
- Loan events: `sequence ASC` cursor.
- page size is bounded to 1–100.

The locked `@cloudbase/node-sdk` / `@cloudbase/database` path may cap one database read at 100 rows. Therefore CloudBaseRepo requests at most the requested page size, never `limit + 1`. A completely full page returns a continuation cursor; if it happened to be the exact final multiple of the page size, the next request returns an empty page. This is an acceptable extra bounded read and is preferable to silent truncation.

## Event ordering

`LoanEvent.sequence` is the authoritative order inside one Loan.

CloudBase persists an infrastructure-only field on the Loan document:

```text
nextEventSequence
```

This field is **not** part of the shared `Loan` domain type and is not an accounting balance. It exists only to reserve contiguous sequence values inside the same database transaction that appends formal events.

Never derive the next event sequence by querying the latest event outside a transaction.

## Required indexes

The executable source-of-truth list is `src/data/schema-contract.ts`.

Required baseline:

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

`loan_events.sourceRequestId` must stay non-unique because one `CREATE_LOAN` request creates two genesis events: initial principal and initial rate.

## Transaction boundary

`LedgerRepo.runTransaction()` exposes only transaction-scoped v2 persistence capabilities.

Future R5 CREATE_LOAN application must be able to complete in one transaction:

- reload/check the request;
- create the Loan;
- reserve two event sequences;
- append initial principal + initial rate events;
- mark request `APPLIED`;
- finalize the invite when applicable.

A failure before commit must leave none of those formal writes behind.

## Idempotency

- `ledger_requests.idempotencyKey` is unique.
- The R2 `requestFingerprint` distinguishes legitimate retry from key reuse with changed business semantics.
- `loan_events.idempotencyKey` is unique.
- Server event keys are deterministic (`<requestId>:<purpose>`).
- Reusing one event key for different event content is a conflict.
- `sourceRequestId` is a lookup field, not an idempotency key.

## CloudBase SDK baseline

The repository dependency range is `@cloudbase/node-sdk ^3.9.0`; the current lockfile resolves **3.18.3** with `@cloudbase/database 1.4.3`.

R3 intentionally does not combine the product rewrite with an SDK migration. The database implementation is isolated behind `LedgerRepo` so a future move to the newer CloudBase SDK can be handled separately.

## Security boundary

- Runtime OPENID is authoritative identity.
- Client-supplied user IDs never prove identity.
- Clients do not directly mutate formal ledger collections.
- Applying a request and creating its formal events must be atomic.
- Formal `loan_events` are append-only through product APIs.

## Reusable infrastructure

The rewrite keeps infrastructure independent of the old product model:

- `src/context.ts` — CloudBase runtime context;
- `src/crypto.ts` — token hashing/random helpers;
- `src/errors.ts` — v2 application error envelope;
- `scripts/bundle.mjs` — deployment bundle plumbing.

## Build

From the repository root:

```bash
npm install
npm run build
npm run typecheck
npm test
npm run bundle -w @family-ledger/cloud-ledger
```

CloudBase integration testing is still required before release for real transactions, indexes, duplicate-key error shapes and concurrent invite/request application. Pure MemoryRepo tests do not substitute for that environment.
