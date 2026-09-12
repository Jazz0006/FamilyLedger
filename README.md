# FamilyLedger · 来往账

A WeChat Mini Program for maintaining **mutually confirmed bilateral loan ledgers** between users.

It is not a bank, payment service, lending marketplace, deposit product, or investment product. It does not move or hold money. It records debt facts that both parties have confirmed after money moves outside the app.

## Authoritative docs

1. [docs/来往账_产品规划设计书_v2.0.md](docs/来往账_产品规划设计书_v2.0.md) — product/business semantics
2. [docs/DATA_MODEL_V2.md](docs/DATA_MODEL_V2.md) — target data/domain shape
3. [docs/V2_CLEAN_REWRITE_ROADMAP.md](docs/V2_CLEAN_REWRITE_ROADMAP.md) — implementation strategy and order
4. [AGENTS.md](AGENTS.md) — engineering guardrails

The v1.1 family-loan implementation is historical reference only. There is no backward-compatibility requirement for its API, collections, UI, or development data.

## v2 model

- Every WeChat identity maps to an ordinary `User`.
- There is no global borrower/lender role, fixed family, or family administrator.
- Borrower/lender roles exist only inside one `Loan`.
- One Loan is one shared ledger viewed from opposite directions by its two parties.
- Every formal ledger change follows **propose → counterparty consent → apply**.
- First-contact invites additionally require the initiator to verify the claimed counterparty before the first Loan becomes formal.
- Existing counterparties can receive direct in-app pending requests.

## Architecture

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

- `packages/shared` — v2 domain types, enums and cross-layer contracts.
- `packages/calc` — deterministic interest/balance engine.
- `cloud/functions/ledger` — server-authoritative CloudBase application boundary.
- `miniprogram` — active v2 WeChat native client.
- `docs` — product/data/rewrite decisions and milestone records.

## Non-negotiable invariants

1. Money is integer Fen and must remain within safe-integer range.
2. Formal `loan_events` are append-only through normal product APIs.
3. Principal, interest and total due are derived from formal history.
4. Both parties read the same Loan/event stream; never maintain duplicated balances.
5. Formal ledger mutation requires both parties' consent.
6. Interest is calculated, not written daily.
7. Every Loan has explicit confirmed rate history; there is no silent global fallback rate.
8. `packages/calc` is the single money-math implementation.
9. OPENID comes from trusted server runtime identity.
10. Mutations are idempotent and transaction/CAS safe.
11. Growing collection reads paginate; reconstruction may not use truncated history.

## Current rewrite status

R1-R11 built the v2 domain, persistence, first-contact CREATE_LOAN, read model, repayment, principal add, rate change, Correction and Close semantics/implementation.

**R12 is now in progress.** The cutover audit is complete and the old family/admin Mini Program pages have been removed. R12A added UI-facing safe profiles plus known-counterparty discovery and direct CREATE_LOAN. R12B now provides the active v2 Mini Program shell for:

- ordinary-user bootstrap;
- bidirectional home summary and Loan lists;
- first-contact and existing-counterparty new Loan proposals;
- first-contact invite preview/acceptance and initiator verification/cancellation;
- pending request accept/reject flows;
- Loan summary and complete formal event history.

The server already supports repayment, principal-add, rate-change, Correction and Close proposals. Dedicated mutation forms from the Loan-detail page remain a subsequent UI slice; real two-account CloudBase/WeChat validation is also still required before production cutover.

## Validation

GitHub Actions runs the workspace gate on every push/PR:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

These checks cover deterministic/domain/application behavior. They do **not** replace real CloudBase validation for runtime OPENID, database indexes, transactions, concurrent invite claims, WeChat sharing and two-account end-to-end flows.

For local work:

```bash
nvm use
npm ci
npm run build
npm run typecheck
npm test
```
