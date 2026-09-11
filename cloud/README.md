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

## First-time setup (things only YOU can do)

These need your WeChat/Tencent account, real-name verification, and console
clicks — they can't be scripted from here.

1. **Activate Cloud Development.** Open the project in WeChat DevTools (AppID
   `wxa6b778821b3ccbc9` is already set), click **云开发 / Cloud** in the toolbar,
   and create an environment. Note the **env ID**.
2. **Real-name verification (实名认证).** Tencent requires this on the account
   before the env is usable. The miniprogram cloud tier has a free quota.
3. **Put the env ID in `cloudbaserc.json`** (repo root) — replace
   `REPLACE_WITH_YOUR_ENV_ID`. Also set it in `miniprogram/app.js` (or keep
   `DYNAMIC_CURRENT_ENV` if the miniprogram and env are 1:1).
4. **Create the 7 collections** (console → 数据库): `users`, `loan_accounts`,
   `loan_terms`, `change_requests`, `loan_events`, `invite_tokens`,
   `audit_logs`.
5. **Create the unique indexes** below. These are NOT optional — our
   idempotency and single-use guarantees are enforced by the DB, not just code.
6. **Set every collection to deny client writes** (权限设置 → 仅管理端可读写,
   or a custom rule denying client writes). All access goes through the
   `ledger` function.

### Required indexes

| Collection | Field | Type |
|---|---|---|
| `users` | `openid` | **unique** |
| `loan_events` | `idempotencyKey` | **unique** |
| `loan_events` | `sourceRequestId` | **unique, sparse** (repayment apply) |
| `invite_tokens` | `tokenHash` | **unique** |
| `change_requests` | `idempotencyKey` | **unique** (when repayment lands) |

If an index is missing, concurrent double-taps could slip past the code-level
guard. Create them before real use.

## Build & deploy

```bash
# from repo root
npm run build                              # typecheck shared -> calc -> cloud
npm run bundle -w @family-ledger/cloud-ledger   # -> dist-bundle/ (self-contained CJS)
```

`npm run bundle` uses esbuild to inline the workspace packages
(`@family-ledger/calc`, `@family-ledger/shared`, `decimal.js`) into a single
`cloud/functions/ledger/dist-bundle/index.js` that exposes `exports.main`.
`@cloudbase/node-sdk` is left external (the runtime provides it).

Deploy that folder as the `ledger` function with the CloudBase CLI:

```bash
npm i -g @cloudbase/cli      # provides `tcb`
tcb login
tcb fn deploy ledger         # uses cloudbaserc.json
```

(Or deploy `dist-bundle/` via the WeChat DevTools cloud panel by pointing the
`ledger` function at the bundled output.)

## Bootstrapping the first admin

Chicken-and-egg: invites are created by the admin, but the first admin has
no one to invite them. Resolution (decided v1.1): **first-caller-claims**.

1. After deploy, from YOUR phone, call the `bootstrapAdmin` action once
   (`{ action: 'bootstrapAdmin', payload: { displayName: '曾骏' } }`).
2. The first WeChat account to call it becomes the BORROWER/admin, bound to
   your OPENID. The action then permanently refuses (any later caller gets
   `CONFLICT`) — so it can't be used to seize admin afterwards.
3. From then on, use `createInvite` to onboard 妈妈/爸爸/姐姐; each taps their
   invite link once (`bindInvite`), which auto-creates their lender account and
   loan.

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
