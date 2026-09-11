# 家庭借款账本 · FamilyLedger

A WeChat Mini Program for tracking transparent loans between family members.
It is **not** a bank, deposit, or investment product — it records how much
曾骏 currently owes each family member, with an append-only event ledger and
dual-party confirmation for every change.

The authoritative product spec lives in
[docs/家庭借款账本_产品规划设计书_v1.0.md](docs/家庭借款账本_产品规划设计书_v1.0.md).
When code and spec disagree, the spec wins — and any change to money or
permission semantics must update the spec (see its §23 Definition of Done).

## Architecture

- **WeChat native Mini Program** frontend (display + request initiation only).
- **Tencent CloudBase** serverless: database, auth (OPENID), cloud functions.
- The frontend never has final write authority. Event creation, permission
  checks, dual-confirmation state, and interest calculation run server-side.

## Monorepo layout

This is an npm workspaces monorepo.

| Path | What it is |
|---|---|
| `packages/calc` | Shared, dependency-light interest & balance engine (TypeScript). The single source of truth for money math, imported by both cloud functions and the miniprogram. Golden test vectors live here. |
| `packages/shared` | Shared domain types, enums, and collection names used across cloud + client. |
| `cloud/functions/*` | CloudBase cloud functions (server-side authority). |
| `miniprogram` | WeChat Mini Program (pages per spec §17). |
| `docs` | Product spec (baseline). |

## Key invariants (do not violate)

1. **Money is stored as integer 分 (cents).** Never use floats for money.
2. **The ledger is append-only.** `loan_events` are never updated or deleted;
   corrections are new events (spec Rule C).
3. **Balances are derived**, not stored as truth. Any cached snapshot must be
   rebuildable from events.
4. **Interest is calculated, never written daily** (spec Rule E). Annual
   effective rate 5.00%, daily compounding: `r = 1.05^(1/365) - 1`.
5. **One calc module.** Frontend, backend, and tests must produce byte-identical
   amounts from the same events (spec §18). All math goes through
   `packages/calc`.
6. **Day boundaries use `Asia/Shanghai`.** Changing the timezone invalidates the
   golden vectors.

## Getting started

```bash
nvm use          # Node 24 (see .nvmrc)
npm install      # installs all workspaces
npm run build    # typecheck + build all packages
npm test         # run the calc golden-vector suite
```

Deploying cloud functions and previewing the miniprogram requires the
[WeChat Developer Tools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
and the [CloudBase CLI](https://docs.cloudbase.net/) — see `cloud/README.md`.

## Development order (spec §19)

规则引擎 → 身份绑定 → 只读首页 → 双确认写账 → 管理员 → 审计/备份 → UI 打磨.
Lock down money and permissions with tests first; polish visuals last.
