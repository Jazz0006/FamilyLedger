# FamilyLedger · 来往账

A WeChat Mini Program for maintaining **mutually confirmed bilateral loan ledgers** between users.

It is not a bank, payment service, lending marketplace, deposit product, or investment product. It does not move or hold money. It records debt facts that both parties have confirmed after money moves outside the app.

## Authoritative docs

1. [docs/来往账_产品规划设计书_v2.0.md](docs/来往账_产品规划设计书_v2.0.md) — product/business semantics
2. [docs/DATA_MODEL_V2.md](docs/DATA_MODEL_V2.md) — target data/domain shape
3. [docs/V2_CLEAN_REWRITE_ROADMAP.md](docs/V2_CLEAN_REWRITE_ROADMAP.md) — implementation strategy and order
4. [AGENTS.md](AGENTS.md) — engineering guardrails

The v1.1 family-loan implementation is historical reference only. There is no backward-compatibility requirement for its API, collections, UI, or development data.

## v2 domain model

- Every WeChat identity maps to a normal `User`.
- There is no global borrower/lender role, fixed family, or family administrator.
- Borrower/lender roles exist only inside one `Loan`.
- One Loan is one shared ledger viewed from opposite directions by its two parties.
- Every formal ledger change follows **propose → counterparty consent → apply**.
- First-contact invites additionally require the initiator to verify the claimed counterparty before the first Loan becomes formal.
- Existing counterparties can receive direct in-app pending requests; WeChat sharing is an optional reminder channel.

## Architecture

- `packages/shared` — v2 domain types, enums, constants, collection names.
- `packages/calc` — deterministic interest/balance engine.
- `cloud/functions/ledger` — CloudBase server-authoritative boundary.
- `miniprogram` — WeChat native client.
- `docs` — authoritative product/data/rewrite documents.

Dependency direction:

```text
Mini Program UI
      ↓
Application Actions / Use Cases
      ↓
Domain + packages/calc
      ↓
Repository Interfaces
      ↓
CloudBase Repository / Infrastructure
```

## Non-negotiable invariants

1. Money is integer Fen and must remain within safe-integer range.
2. Formal `loan_events` are append-only through normal product APIs.
3. Principal, interest and total due are derived from formal history.
4. Both parties read the same Loan/event stream; never maintain duplicated balances.
5. Formal ledger mutation requires both parties' consent.
6. Interest is calculated, not written daily.
7. An agreed annual rate is an explicit snapshot; no global fallback rate silently fills missing history.
8. `packages/calc` is the single money-math implementation.
9. OPENID comes from trusted server runtime identity.
10. Mutations are idempotent and transaction/CAS safe.
11. Growing collection reads paginate; balance reconstruction may not use truncated history.

## Clean rewrite status

v2 is being implemented as a clean rewrite inside the existing repository, not as a compatibility migration from v1.1.

R1 intentionally removes the old family/admin server action layer rather than adapting it. During R1 the cloud router is explicitly disabled until the v2 state machine/repository/actions are rebuilt. The legacy mini-program UI remains temporarily as a visual/reference artifact and will be replaced when the v2 user flows reach the UI milestones; it must not drive server/domain design.

Development sequence:

1. R1 — clean shared domain + remove obsolete v1 server business layer
2. R2 — request state machine, permissions, idempotency fingerprint
3. R3 — v2 Repo / MemoryRepo / CloudBase persistence and safety primitives
4. R4 — `ensureUser`
5. R5 — `CREATE_LOAN` closed loop
6. R6 — bidirectional home/query flows
7. R7 — repayment
8. R8 — principal add / rate change / correction / close
9. R9 — remove remaining v1 UI/docs/deployment residue
10. R10 — CPI source, export/backup, UI polish, real two-account regression

## Getting started

```bash
nvm use
npm install
npm run build
npm test
```

Unit/domain tests should remain runnable without CloudBase. Real OPENID, transactions, invite claiming, database indexes, sharing, and two-user flows must be tested against a CloudBase development environment before release.
