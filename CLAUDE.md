# CLAUDE.md

Guidance for working in this repo.

## What this is

`FamilyLedger` is migrating from a family-specific debt tracker to a general WeChat Mini Program for **mutually confirmed bilateral loan ledgers**.

Authoritative v2.0 docs:

- `docs/来往账_产品规划设计书_v2.0.md`
- `docs/DATA_MODEL_V2.md`

The old `docs/家庭借款账本_产品规划设计书_v1.1.md` is historical only.

**The v2.0 product spec wins over existing code.** During migration, do not copy or extend legacy family/admin assumptions unless v2.0 explicitly retains them.

## v2.0 domain rules

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
7. v2 migration initially keeps `Asia/Shanghai` as the fixed ledger day boundary unless the spec is changed explicitly.
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

Legacy `loan_accounts`, `loan_terms`, and `change_requests` are migration targets, not the desired final model.

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
- `docs` — product/data/deployment docs.

## Commands

```bash
npm install
npm run build
npm test
```

Keep ordinary domain/unit tests independent of live CloudBase. Use CloudBase integration tests for OPENID identity, transactions, unique indexes, invite claiming, and real two-user flows.

## Migration warning

Current code still contains v1.1 concepts including:

- `UserRole`
- `familyId`
- `DEFAULT_FAMILY_ID`
- `bootstrapAdmin`
- admin-only actions
- direct PRINCIPAL_ADD / RATE_CHANGE application
- family-oriented home/admin pages
- direction-based confirmation

Do not implement new features on top of those assumptions. Migrate domain types/state machine first, then rebuild cloud actions and UI against v2.

## Development order

1. shared v2 types/enums/collection names
2. request state-machine + permission tests
3. safety fixes: pagination, rate-history regression, transactional writes, idempotency fingerprint
4. normal `ensureUser` bootstrap
5. CREATE_LOAN invite/accept/verify/apply closed loop
6. bidirectional home summary
7. repayment closed loop
8. add principal / rate change / correction
9. audit/export/backup
10. CPI reference source
11. UI polish + two-account real-device regression

Money/permission/state-machine changes are not complete until the authoritative docs and tests agree.
