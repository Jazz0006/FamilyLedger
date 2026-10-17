# Cloud functions (Tencent CloudBase)

This directory is the server-authoritative boundary for the v2 bilateral ledger.

## Current rewrite status

The v1.1 family/admin action layer and repository implementation were intentionally removed in **R1 — Clean v2 Domain Rewrite**. They are not compatibility targets.

During R1 the `ledger` entry point is deliberately disabled and returns `INVALID_STATE` for product actions. Do not deploy this branch as a usable ledger backend until the later v2 server milestones restore real actions.

The next server milestones will rebuild the backend against the v2 domain model:

1. R2 — request state machine, permissions, idempotency fingerprint;
2. R3 — v2 repository contract, MemoryRepo, CloudBaseRepo, pagination and transaction primitives;
3. R4 — `ensureUser`;
4. R5 — `CREATE_LOAN` invite/accept/verify/apply closed loop.

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

Required indexes and transaction semantics are authoritative in `docs/DATA_MODEL_V2.md`. In particular, v2 `loan_events.sourceRequestId` is not globally unique because one `CREATE_LOAN` request creates both initial principal and initial rate events.

## Security boundary

- Runtime OPENID is authoritative identity.
- Client-supplied user IDs never prove identity.
- Clients do not directly mutate formal ledger collections.
- Applying a request and creating its formal events must be atomic or transactionally equivalent.
- Reads that can grow beyond a CloudBase page must paginate.
- Formal `loan_events` are append-only through product APIs.

## Reusable infrastructure

The rewrite intentionally keeps infrastructure that is independent of the old product model:

- `src/context.ts` — CloudBase runtime context;
- `src/crypto.ts` — token hashing/random helpers;
- `src/errors.ts` — v2 application error envelope;
- `scripts/bundle.mjs` — deployment bundle plumbing.

## Build

From the repository root:

```bash
npm install
npm run build
npm test
npm run bundle -w @family-ledger/cloud-ledger
```

The cloud package temporarily allows zero cloud tests during R1 because the old v1 tests were deleted with the old business layer. R2 must add the new state-machine/permission/idempotency tests before server behavior expands again.
