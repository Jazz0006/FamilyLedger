# Cloud functions (Tencent CloudBase)

Server-side authority for FamilyLedger. The frontend never writes to the
ledger directly (spec §14–§15).

## Layout

- `functions/ledger` — a single router function. The miniprogram calls it with
  `{ action, payload }`. Actions live in `functions/ledger/src/actions/`.

## Collections (create in the CloudBase console)

`users`, `loan_accounts`, `loan_terms`, `change_requests`, `loan_events`,
`invite_tokens`, `audit_logs` (see spec §16 and
`packages/shared/src/collections.ts`).

**Required indexes (enforce invariants at the DB layer):**

- `change_requests.idempotencyKey` — **unique**. Blocks duplicate proposals
  from double-tap / retry (spec §15).
- `loan_events.sourceRequestId` — **unique** (sparse). Guarantees a confirmed
  request can produce at most one ledger event even if apply is retried.
- `invite_tokens.tokenHash` — unique.
- `users.openid` — unique (one WeChat identity ↔ one account, spec §4).

**Security rules:** deny all client-side writes to `loan_events`, `audit_logs`,
`change_requests`, `loan_terms`, `invite_tokens`. All writes go through the
`ledger` function. Reads should also be funnelled through the function so the
family-vs-private visibility rules (spec §6) are enforced server-side rather
than via permissive collection read rules.

## Build & deploy

```bash
# from repo root
npm run build            # compiles shared -> calc -> cloud (project refs)
```

Deploying requires the CloudBase CLI (`@cloudbase/cli`, provides `tcb`) and a
configured env id. Because the function imports workspace packages
(`@family-ledger/calc`, `@family-ledger/shared`), the deploy bundle must
include their built `dist/` output — configure this in your `cloudbaserc.json`
(not yet added; create it when you connect a real CloudBase env).

## Confirmation model (spec v1.1, Rule B)

Direction-based: **debt-increasing ops are admin-only + immediate;
debt-decreasing ops need lender confirmation.**

- `recordLodgment` (PRINCIPAL_ADD) — admin-only, direct single event, no
  confirmation, effective today.
- `proposeRepayment` (PRINCIPAL_REPAY) — admin creates a PENDING request;
  `confirmChange` applies it when the lender confirms, effective that day.
- Rate changes (RATE_CHANGE) — admin-only, direct (impl TODO).

The action files are still `NOT_IMPLEMENTED` stubs, but the flow and security
boundary are now fixed by v1.1 — implement the money logic against them.
