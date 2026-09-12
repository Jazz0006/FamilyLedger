# FamilyLedger · 来往账

A WeChat Mini Program for maintaining **mutually confirmed bilateral loan ledgers** between users.

It is not a bank, payment service, lending marketplace, deposit product, or investment product. It does not move or hold money. It records debt facts that both parties have confirmed after money moves outside the app.

## Authoritative docs

The current product baseline is:

- [docs/来往账_产品规划设计书_v2.0.md](docs/来往账_产品规划设计书_v2.0.md)
- [docs/DATA_MODEL_V2.md](docs/DATA_MODEL_V2.md)

The old [v1.1 family-loan specification](docs/家庭借款账本_产品规划设计书_v1.1.md) is retained only as history.

**The v2.0 product spec wins over existing code.** The repository is currently migrating from the v1.1 single-family/admin model to the v2.0 general bilateral-ledger model. Existing family/admin assumptions must not be extended simply because they are already implemented.

Any change to money, permission, confirmation, identity, invite, or event semantics must update the authoritative docs and tests.

## v2.0 domain model

- Every WeChat identity maps to a normal `User`.
- There is no global borrower/lender role and no family administrator.
- Borrower/lender roles exist only inside one `Loan`.
- One Loan is one shared ledger. Both parties view the same Loan from opposite directions; the system never maintains duplicated per-user balances.
- Every formal ledger change follows **propose → counterparty consent → apply**.
- First-contact invites use a one-time share token; after the invitee accepts, the initiator verifies the claimed identity before the first Loan becomes formal.
- Existing counterparties can receive direct in-app pending requests; WeChat sharing is an optional reminder channel.

## Architecture

- **WeChat native Mini Program** frontend for display, proposal initiation, and consent actions.
- **Tencent CloudBase** serverless backend: OPENID identity, database, transactions, and cloud functions.
- The frontend has no final write authority.
- `packages/calc` remains the single money/interest calculation implementation.
- Repository interfaces keep business logic testable without requiring CloudBase for every unit test.

## Monorepo layout

| Path | What it is |
|---|---|
| `packages/calc` | Shared deterministic interest & balance engine (TypeScript). |
| `packages/shared` | Shared domain types, enums, constants, and collection names. |
| `cloud/functions/ledger` | CloudBase server-side authority and action router. |
| `miniprogram` | WeChat Mini Program client. |
| `docs` | Product, data model, and deployment documentation. |

## Non-negotiable invariants

1. **Money is integer 分 (Fen).** Persist only safe integers; never use floating-point yuan as accounting truth.
2. **Formal history is append-only.** `loan_events` are never edited/deleted through normal product APIs; corrections append compensating events.
3. **Balances are derived.** Principal, interest, and total due must be reconstructable from Loan + ordered events.
4. **One shared ledger, not two synchronized copies.** Lender and borrower read the same Loan/event stream.
5. **Shared ledger → shared consent.** Creating a proposal is the proposer's consent; the counterparty must accept before a formal event is applied.
6. **Interest is calculated, not written daily.** The numeric annual rate is stored as an agreed snapshot. v2.0 plans CPI-reference as the default proposal source, but CPI must never silently rewrite an existing Loan.
7. **One calc module.** Frontend/backend/tests must not implement independent money formulas.
8. **OPENID is server authority.** Never trust a client-supplied OPENID or userId as identity proof.
9. **Writes are idempotent and concurrency-safe.** Reusing an idempotency key with a different semantic payload is a conflict.
10. **Growing reads paginate.** Balance reconstruction must never assume one CloudBase `.get()` returned all events.

## Migration status

The current production code still contains v1.1 concepts such as:

- `UserRole.BORROWER/LENDER`
- `familyId` / `DEFAULT_FAMILY_ID`
- `bootstrapAdmin`
- admin-only writes
- family-oriented UI
- direction-based confirmation

Treat these as migration targets, not desired v2 behavior.

See [DATA_MODEL_V2.md](docs/DATA_MODEL_V2.md) for the exact target collections, state machine, indexes, atomic transaction boundaries, and v1.1 → v2 field mapping.

## Development order

1. v2 shared domain types / collections
2. request state machine + permission tests
3. safety fixes: pagination, historical-rate regression, transactional onboarding/apply, idempotency fingerprinting
4. normal user bootstrap
5. CREATE_LOAN invite/accept/verify/apply closed loop
6. bidirectional home summary
7. repayment closed loop
8. add-principal / rate-change / correction flows
9. audit/export/backup
10. CPI default-rate source
11. UI polish + real two-account regression

Do not continue expanding v1.1 family/admin APIs before the domain migration.

## Getting started

```bash
nvm use
npm install
npm run build
npm test
```

Unit/domain tests should remain runnable without CloudBase. Real OPENID, transactions, invite claiming, database indexes, sharing, and two-user flows must also be tested against a CloudBase development environment before release.
