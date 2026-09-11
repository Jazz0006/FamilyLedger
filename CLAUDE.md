# CLAUDE.md

Guidance for working in this repo.

## What this is

家庭借款账本 — a WeChat Mini Program tracking transparent family loans. The
authoritative spec is `docs/家庭借款账本_产品规划设计书_v1.1.md`. **The spec
wins over code.** Any change to money or permission semantics must update the
spec (its §23 Definition of Done).

## Non-negotiable invariants

1. Money is integer **分** (cents). Never floats. (spec Rule G)
2. `loan_events` is **append-only** — never UPDATE/DELETE. Corrections are new
   events. (Rule C)
3. Balances are **derived** from events, never stored as truth. (spec §12)
4. Interest is **calculated, not written daily**. Annual effective 5%, daily
   compounding `r = 1.05^(1/365) - 1`. (Rule D/E)
5. **One calc module** (`packages/calc`) is the source of truth for all money
   math. Frontend, backend, and tests must produce byte-identical 分. (spec §18)
6. Day boundaries use **Asia/Shanghai**. Changing tz invalidates golden vectors.
7. The client has **no write authority**. Identity (OPENID), permission checks,
   dual-confirmation, and interest calc all run server-side. (spec §14–§15)

## Layout

- `packages/shared` — domain types, enums, collection names, constants.
- `packages/calc` — interest/balance engine + golden-vector tests. Start here.
- `cloud/functions/ledger` — single router cloud function; actions in `src/actions`.
- `miniprogram` — WeChat native pages (display only).

## Commands

```bash
npm install        # workspaces
npm run build      # tsc project references: shared -> calc -> cloud
npm test           # calc golden vectors (vitest)
```

## Confirmation model (spec v1.1, Rule B) — direction-based

The single rule: **operations that INCREASE 曾骏's debt are admin-only and
apply immediately; operations that DECREASE it require the lender to confirm.**

| Operation | Initiator | Confirm? | Effective date |
|---|---|---|---|
| PRINCIPAL_ADD | admin | no | today |
| RATE_CHANGE | admin | no | today |
| PRINCIPAL_REPAY | admin | lender confirms | confirmation day |
| CORRECTION | admin | only if it lowers the debt | — |

So `change_requests` / the confirm flow exist ONLY for repayments (and
debt-lowering corrections). Adds and rate changes are direct single-event
inserts (still idempotent — guard double-taps). Known residual: a rate
*decrease* technically disadvantages the lender but is admin-only for
simplicity — accepted for a single trusted family.

## Development order (spec §19)

规则引擎 → 身份绑定 → 只读首页 → 双确认写账 → 管理员 → 审计/备份 → UI 打磨.
Lock money + permissions with tests before visuals.
