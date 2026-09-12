# CLAUDE.md

Guidance for working in this repo.

## What this is

`FamilyLedger` is being rewritten from a short-lived family-specific proof of concept into a general WeChat Mini Program for **mutually confirmed bilateral loan ledgers**.

Authoritative v2 docs:

- `docs/来往账_产品规划设计书_v2.0.md` — product/business meaning
- `docs/DATA_MODEL_V2.md` — target domain and persistence shape
- `docs/V2_CLEAN_REWRITE_ROADMAP.md` — authoritative implementation strategy and sequencing
- `AGENTS.md` — engineering guardrails

The old `docs/家庭借款账本_产品规划设计书_v1.1.md` and the v1.1 production code are historical/reference material only.

**The v2 product spec wins over existing code.** Do not copy or extend legacy family/admin assumptions unless v2 explicitly retains the underlying behavior.

## Rewrite policy

v2 is a **clean rewrite of product/domain/application code inside the existing repository**, not a compatibility migration.

Hard rules:

1. Do not build a backward-compatible v1.1 API layer.
2. Do not dual-write v1.1 and v2 collections.
3. Do not add permanent `familyId`, legacy-role, or compatibility branches to v2 code.
4. Do not finish unfinished v1.1 features before building their v2 replacement.
5. Assume v1.1 development/test data is disposable unless a concrete preservation requirement is identified.
6. Keep old implementation history in Git rather than in production code.
7. Reuse technical assets only when their semantics remain correct under v2.

If real v1.1 data later needs preservation, handle it with a separate one-shot conversion after backup. Do not distort the v2 model to accommodate legacy records.

## v2 domain rules

1. Every WeChat identity is a normal `User`.
2. There is no global `BORROWER/LENDER` user role.
3. There is no `familyId`, fixed family, or product-level admin.
4. Borrower/lender roles belong to a specific `Loan` only.
5. A Loan is one shared ledger viewed from opposite directions by its two parties.
6. Never model the lender and borrower as separate synchronized balance copies.
7. Any formal ledger change follows propose → counterparty consent → apply.
8. First-contact invite flow additionally requires the initiator to verify the claimed counterparty before the first Loan becomes formal.
9. Existing counterparties need only normal counterparty acceptance.

## Non-negotiable invariants

1. Money is integer **Fen / 分** and must satisfy `Number.isSafeInteger`.
2. `loan_events` is append-only through normal product APIs. Corrections append compensating events.
3. Principal/interest/total are derived, never stored as authoritative truth.
4. Interest is calculated, not written daily.
5. The numeric annual effective rate is an agreed snapshot. CPI may prefill a proposal, but external CPI updates must never silently change an existing Loan.
6. `packages/calc` is the single source of truth for money math.
7. v2 initially keeps `Asia/Shanghai` as the fixed ledger day boundary unless the spec is changed explicitly.
8. Client code has no formal write authority. OPENID, user identity, permissions, state transitions, and final event creation are validated server-side.
9. Writes are idempotent. The same idempotency key with a different semantic payload is a conflict.
10. Request application and the corresponding formal writes must be transaction/CAS safe.
11. Reads that can exceed one CloudBase page must paginate. Never reconstruct a balance from a potentially truncated event stream.

## Target v2 collections

- `users`
- `loans`
- `ledger_requests`
- `loan_events`
- `invite_tokens`
- `audit_logs`
- optional future `rate_references`

Legacy `loan_accounts`, `loan_terms`, and `change_requests` are not part of the v2 target model.

## Request model

Target request types:

- `CREATE_LOAN`
- `PRINCIPAL_ADD`
- `PRINCIPAL_REPAY`
- `RATE_CHANGE`
- `CORRECTION`
- `CLOSE_LOAN`

Target statuses:

- `PENDING`
- `PENDING_INITIATOR_VERIFY`
- `APPLIED`
- `REJECTED`
- `CANCELLED`
- `EXPIRED`

Known-counterparty flow:

```text
PENDING -> APPLIED | REJECTED | CANCELLED | EXPIRED
```

First-contact flow:

```text
PENDING
  -> PENDING_INITIATOR_VERIFY
      -> APPLIED | CANCELLED | EXPIRED
  -> REJECTED | CANCELLED | EXPIRED
```

`APPLIED` must be atomic with all Loan/LoanEvent changes created by that request.

## CREATE_LOAN application

When a new Loan becomes formal, one transaction must create:

- the `Loan`;
- initial `PRINCIPAL_ADD` event;
- initial `RATE_CHANGE` event;
- request `APPLIED` state;
- invite finalization/consumption where applicable.

`sourceRequestId` is therefore **not unique** in v2: one CREATE_LOAN request intentionally creates more than one event. Keep event-level `idempotencyKey` unique instead.

## Layout

- `packages/shared` — domain types, enums, collection names, constants.
- `packages/calc` — interest/balance engine + deterministic tests.
- `cloud/functions/ledger` — server authority and action router.
- `miniprogram` — WeChat native client.
- `docs` — product/data/deployment/roadmap docs.

## Reuse vs rewrite

Good reuse candidates:

- valid `packages/calc` math and tests;
- Fen/Decimal conventions;
- date/timezone helpers with unchanged semantics;
- OPENID server boundary;
- crypto/token-hash utilities;
- CloudBase build/deploy plumbing;
- audit/idempotency concepts;
- MemoryRepo testing technique.

Rewrite rather than migrate:

- shared domain types tied to family/admin semantics;
- repository contract;
- CloudBase persistence API shape;
- actions/use cases;
- invite flow;
- router API set;
- family/admin mini-program pages and data model.

## Commands

```bash
npm install
npm run build
npm test
```

Keep ordinary domain/unit tests independent of live CloudBase. Use CloudBase integration tests for OPENID identity, transactions, unique indexes, invite claiming, and real two-user flows.

## Development order

Follow `docs/V2_CLEAN_REWRITE_ROADMAP.md`.

Current sequence:

1. **R0 — Freeze v1.1**
2. **R1 — Clean v2 domain rewrite**
3. **R2 — Request state machine, permissions, idempotency tests**
4. **R3 — v2 LedgerRepo/MemoryRepo/CloudBase persistence + safety foundation**
5. **R4 — `ensureUser`**
6. **R5 — CREATE_LOAN invite/accept/verify/apply vertical slice**
7. **R6 — read model + bidirectional home summary**
8. **R7 — repayment vertical slice**
9. **R8 — principal add / rate change / correction / close**
10. **R9 — delete obsolete v1.1 production code and cut over**
11. **R10 — audit/export/CPI/UI polish + two-account real-device regression**

The immediate next task is **R1 — Clean v2 domain rewrite**. Do not begin by editing the mini-program UI or completing v1.1 cloud actions.

Money/permission/state-machine changes are not complete until the authoritative docs and tests agree.
