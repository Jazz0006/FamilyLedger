# V2 R3 — Persistence Foundation Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r3-persistence-foundation`  
**Base:** `codex/v2-r2-state-machine`

## Completed

R3 rebuilds persistence around v2 semantics only.

### Repository contract

`cloud/functions/ledger/src/data/repo.ts` now defines the use-case-shaped v2 persistence boundary:

- User lookup / idempotent creation by OPENID;
- Loan lookup and bounded participant-direction listing;
- request lookup / idempotent creation / actionable listing;
- ordered paginated LoanEvent reads;
- invite create/hash lookup;
- audit append;
- transaction-scoped request/Loan/event/invite mutation capabilities.

No family/admin repository concepts were restored.

### MemoryRepo

`memory-repo.ts` models:

- unique OPENID semantics;
- unique request idempotency keys + request fingerprint conflict detection;
- Loan `createdFromRequestId` uniqueness;
- deterministic Loan listings;
- stable event pagination by sequence;
- deterministic event idempotency keys;
- event-key content conflict detection;
- multiple events sharing one `sourceRequestId`;
- contiguous event sequence allocation;
- atomic rollback via transactional state copy;
- serialized in-memory transactions for concurrency-oriented action tests.

### CloudBaseRepo

`cloudbase-repo.ts` provides:

- bounded cursor-based reads instead of one-shot `.get()` history assumptions;
- `createdAt DESC, _id DESC` pagination for Loan/request lists;
- `sequence ASC` pagination for LoanEvents;
- unique-index backed user/request creation semantics;
- transaction adapter via `db.runTransaction`;
- transaction-owned event sequence allocation;
- formal-event idempotency checks.

The persisted CloudBase Loan document has infrastructure-only `nextEventSequence`. It is not part of the shared `Loan` domain type and is not an authoritative balance.

### Index contract

`schema-contract.ts` encodes required indexes, including:

- unique `users.openid`;
- unique `loans.createdFromRequestId`;
- lender/borrower cursor indexes;
- unique request/event idempotency keys;
- unique `(loanId, sequence)`;
- **non-unique** `sourceRequestId`;
- unique invite `tokenHash`.

## SDK audit

The repository declares `@cloudbase/node-sdk ^3.9.0`, while the current lockfile resolves:

- `@cloudbase/node-sdk 3.18.3`;
- `@cloudbase/database 1.4.3`.

R3 intentionally does not mix an SDK migration into the product rewrite. The adapter remains behind `LedgerRepo`.

Version-sensitive corrections made during audit:

- transaction `runTransaction` is treated as returning the callback value directly;
- transaction update calls use the node-sdk/database transaction shape rather than assuming another SDK generation;
- CloudBaseRepo never asks for `limit + 1` when page size can be 100; a full page returns a continuation cursor and an exact-final-multiple may require one harmless empty follow-up read.

## Tests added

- `memory-repo.test.ts`
- `cursor.test.ts`
- `event-idempotency.test.ts`
- `schema-contract.test.ts`
- `cloudbase-repo.test.ts`

Coverage includes:

- concurrent same-OPENID user creation semantics;
- request idempotency same/different fingerprint;
- lender vs borrower listings;
- event sequence allocation and multi-page reads;
- two genesis events sharing one source request;
- duplicate event-key retry vs changed-content conflict;
- failed transaction rollback;
- cursor validation;
- sourceRequestId index non-uniqueness;
- CloudBase 100-row page cap behavior;
- direct runTransaction callback return semantics.

## Validation status

The current environment cannot resolve npm/GitHub through the local shell, so a real workspace dependency install and full Vitest run have not been executed here.

Validation performed:

- GitHub branch/diff audit: R3 is stacked cleanly on R2;
- lockfile dependency audit;
- official CloudBase transaction/pagination API audit;
- local strict TypeScript check for the pure persistence contract/cursor/event-idempotency modules: **PASS**.

Before merge, a normal checkout should run:

```bash
npm install
npm run build
npm run typecheck
npm test
```

CloudBase integration tests remain mandatory before production use for real unique indexes, transaction conflicts and duplicate-key error shapes.

## Next

Proceed to **R4 — ensureUser**.

R4 should be deliberately small: resolve caller OPENID from trusted context, create an ordinary User if absent, return the existing User on retry/concurrent duplicate, and expose only that action through the currently-disabled v2 router. It must not recreate bootstrapAdmin, binding, global roles, family initialization or client-supplied OPENID identity.
