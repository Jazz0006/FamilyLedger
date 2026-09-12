# NEXT DEVELOPMENT HANDOFF — V2 R8 Principal Add + Rate Change

**Date:** 2026-09-12  
**Base checkpoint:** `codex/v2-r7-repayment`

## Goal

Extend the known-counterparty mutual-consent workflow from R7 `PRINCIPAL_REPAY` to the two next straightforward formal mutations:

- `PRINCIPAL_ADD`
- `RATE_CHANGE`

Do not implement `CORRECTION` or `CLOSE_LOAN` in this milestone. They require additional target-event / close-condition rules and should remain explicit later work.

## Reuse, do not duplicate

R7 already established the important shared mechanics:

- runtime OPENID → current User;
- Loan participant / counterparty derivation;
- canonical request fingerprints;
- request idempotency;
- known-counterparty `PENDING` workflow;
- counterparty-only accept/reject;
- proposer-only cancel;
- transaction-scoped event reads;
- event sequence allocation;
- deterministic event idempotency keys;
- terminal retry behavior.

R8 should refactor only enough shared known-counterparty request/application code to avoid copy-pasting an entire second and third workflow. Do not introduce a generic framework/DI abstraction.

## PRINCIPAL_ADD

Either Loan participant may propose a positive principal addition.

Proposal payload:

- `amountFen` — positive safe integer;
- `proposedEffectiveDate` — valid ledger date;
- optional note.

Accept transaction must:

1. reload request and Loan;
2. verify actor is request counterparty;
3. verify Loan is ACTIVE and request parties match Loan participants;
4. allocate one event sequence;
5. append one `PRINCIPAL_ADD` event with deterministic key `<requestId>:principal-add`;
6. mark request `APPLIED`.

No v1 rule may allow unilateral debt increase.

## RATE_CHANGE

Either Loan participant may propose a complete `RateSnapshot` plus effective date.

Use the same rate validation already used for CREATE_LOAN:

- explicit `annualEffectiveRate` decimal string;
- `rateSource` (`MANUAL` / `CPI_REFERENCE`);
- optional reference year/label metadata;
- no implicit 5% fallback;
- CPI metadata is explanatory, not a live mutable reference.

Accept transaction must append one `RATE_CHANGE` event with deterministic key `<requestId>:rate-change` and mark the request APPLIED atomically.

## Same-effective-date rate changes

Preserve deterministic event sequence order. If two confirmed rate changes have the same effective date, later formal event sequence must win for projection/current-rate purposes. Add a test that locks this behavior rather than relying on accidental ordering.

## Generic action surface

Keep the existing router actions:

- `acceptRequest`
- `rejectRequest`
- `cancelRequest`

Expand them from R7's fail-closed `PRINCIPAL_REPAY` support to the implemented R8 request types only.

Add proposal actions with explicit names:

- `createPrincipalAddRequest`
- `createRateChangeRequest`

Unsupported request types must still fail closed.

## Required tests

At minimum:

- both participants can propose principal add;
- both participants can propose rate change;
- proposer cannot self-confirm;
- unrelated User cannot respond;
- idempotency retry returns original request/event;
- changed semantic payload with same key conflicts;
- rejection/cancellation create no LoanEvent;
- principal add acceptance changes both users' shared Loan projection identically;
- rate change acceptance updates currentRate and interest calculation from effective date;
- same-date successive confirmed rate changes resolve to later event sequence;
- concurrent distinct principal additions both serialize safely and receive unique sequences;
- R7 repayment concurrency behavior remains green.

## Explicit non-goals

- `CORRECTION`
- `CLOSE_LOAN`
- direct LoanEvent edits/deletes
- materialized authoritative balances
- global borrower/lender roles
- family/admin compatibility
- SDK migration
- Mini Program UI redesign

## Validation gate

Before merging R8, run in a dependency-enabled checkout:

```bash
npm install
npm run build
npm run typecheck
npm test
```

The current tool environment still cannot resolve npm/GitHub hosts from the shell, so connector-authored code must remain draft until those commands run elsewhere.
