# Next Development Handoff — v2 R7 Repayment

**Date:** 2026-09-12  
**Base branch:** `codex/v2-r6-read-model`  
**Next milestone:** R7 — repayment proposal / mutual consent / atomic apply

## Authority

Read first:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md`
4. `AGENTS.md`
5. `docs/V2_R5_CREATE_LOAN_PROGRESS_2026-09-12.md`
6. `docs/V2_R6_READ_MODEL_PROGRESS_2026-09-12.md`

## Objective

Implement the first post-creation formal ledger mutation:

```text
participant proposes PRINCIPAL_REPAY
→ request PENDING
→ counterparty accepts
→ transaction re-derives current principal
→ reject if repayment > principal
→ append one PRINCIPAL_REPAY event
→ request APPLIED
```

Also support counterparty reject and proposer cancel for the repayment request using the R2 state/permission rules.

## Critical concurrency rule

Proposal-time balance validation is only advisory.

The **accept** transaction must re-read the complete formal event history and derive current principal inside the same transaction that appends the repayment event. This prevents two concurrently accepted repayments from both validating against the same stale pre-repayment principal.

Do not introduce an authoritative stored current-balance/current-principal field on Loan merely to simplify this check.

## Persistence extension

R3 transaction capabilities may be extended narrowly so an apply transaction can page through formal Loan events, for example:

```text
LedgerTransaction.listLoanEvents(...)
```

or an equally concrete transaction-scoped event-read capability.

It must preserve sequence ordering and bounded reads. Avoid a generic query abstraction.

## Actions

Recommended concrete actions:

- `createRepaymentRequest`
- `acceptRequest` (R7 may initially support PRINCIPAL_REPAY only, but structure it so later request types can be added without duplicating state/permission checks)
- `rejectRequest`
- `cancelRequest`

Do not create a generic workflow engine.

## Request creation rules

- authenticated actor must be one Loan participant;
- Loan must be ACTIVE;
- counterparty is derived from Loan, never supplied as authority by client;
- amountFen positive safe integer;
- effective date valid;
- request type PRINCIPAL_REPAY;
- requiresInitiatorVerify=false;
- status PENDING;
- canonical fingerprint includes Loan, proposer, derived counterparty, amount/date/note;
- same key/same proposal returns same request;
- same key/different proposal conflicts;
- proposal should reject obviously excessive repayment based on the current read model, but final acceptance must revalidate transactionally.

## Accept rules

- only request counterparty can accept;
- proposer cannot self-accept;
- request must be PENDING and known-counterparty;
- request must refer to an ACTIVE Loan;
- both request participants must still match the Loan parties;
- transaction reads all events in sequence order;
- derive current principal from formal history;
- reject if `amountFen > currentPrincipalFen`;
- allocate exactly one next sequence;
- append exactly one PRINCIPAL_REPAY event;
- deterministic event idempotency key `<requestId>:principal-repay`;
- event `createdBy=proposer`, `confirmedBy=accepting counterparty`;
- request -> APPLIED with resolvedAt in same transaction;
- retry/concurrent accept converges to one applied event.

## Reject / cancel

- counterparty may reject PENDING request;
- proposer may cancel their own PENDING request;
- rejected/cancelled requests create no events;
- terminal requests cannot be revived.

## Minimum tests

- lender may propose repayment request;
- borrower may propose repayment request;
- unrelated User cannot propose;
- counterparty derived correctly in either direction;
- same idempotency key retry stable;
- changed payload conflicts;
- proposer cannot accept own request;
- unrelated User cannot accept/reject;
- counterparty accept appends one repayment event;
- repayment reduces derived principal for both Loan projections;
- over-repayment rejected;
- two pending repayments whose sum exceeds principal: concurrent accepts result in at most the valid amount being applied;
- concurrent duplicate accept yields exactly one event;
- accept transaction forced failure rolls back event/request status;
- reject produces no event;
- cancel produces no event;
- APPLIED/REJECTED/CANCELLED cannot transition again.

## Non-goals

Do not yet implement:

- post-creation principal add;
- rate change;
- correction;
- close Loan;
- CPI lookup;
- UI visual redesign;
- materialized balance storage.
