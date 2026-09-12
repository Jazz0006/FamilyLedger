# NEXT DEVELOPMENT HANDOFF — V2 R11 CLOSE_LOAN

**Date:** 2026-09-12  
**Base checkpoint:** `codex/v2-r10-correction`

## Goal

Implement the R9-authorized **final settlement boundary** for `CLOSE_LOAN`.

Do not introduce a generic payment/interest-allocation model. `PRINCIPAL_REPAY` remains principal-only.

Authoritative semantics:

- `docs/来往账_产品规划设计书_v2.0.md` §14
- `docs/DATA_MODEL_V2.md`
- `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md` §7–11
- `docs/V2_R10_CORRECTION_PROGRESS_2026-09-12.md`

## Shared model changes

Add:

```ts
export interface CloseSettlementSnapshot {
  accruedInterestFen: Fen;
}
```

Extend `LoanEvent`:

```ts
closeSettlement?: CloseSettlementSnapshot;
```

For `LOAN_CLOSED`:

- `amountFen = null`;
- no rate;
- `closeSettlement.accruedInterestFen` is required;
- `effectiveDate` is the agreed close date.

Extend `LoanSummary` enough to represent closed current state truthfully:

```ts
status: LoanStatus;
closeEffectiveDate: IsoDate | null;
settledInterestFen: Fen | null;
```

For ACTIVE Loans close fields are null.

For CLOSED Loans at/after close:

- principal = 0;
- interest = 0;
- total = 0;
- todayInterest = 0;
- `settledInterestFen` comes from close event snapshot.

Historical as-of dates before close still use normal event replay.

## Event idempotency — mandatory update

`cloud/functions/ledger/src/data/event-idempotency.ts` currently normalizes amount/rate/target/date/etc. It must be extended to include normalized `closeSettlement`.

Without this, the same event idempotency key could incorrectly treat a different settlement snapshot as equivalent.

Close event key:

```text
<requestId>:loan-close
```

## Repository transaction capability

R11 needs one narrow Loan lifecycle write inside the existing transaction abstraction.

Add a transaction-scoped operation such as:

```ts
putLoan(loan: Loan): Promise<void>
```

Implement consistently in MemoryRepo and CloudBaseTransaction.

Do not add a generic repository update framework. The capability exists to atomically persist the typed Loan lifecycle projection (`status`, `closedAt`) with the close event/request transition.

## Proposal action

Add:

```text
createCloseLoanRequest
```

Input:

```text
loanId
proposedEffectiveDate
note?
idempotencyKey
```

Rules:

- current User must be lender or borrower;
- Loan must be ACTIVE;
- counterparty derived from Loan;
- date uses YYYY-MM-DD;
- optional early UX validation may reject a future close date, but final acceptance must re-check from trusted server time;
- idempotent through canonical request fingerprint.

## Acceptance transaction

Expand `acceptRequest/rejectRequest/cancelRequest` to support `CLOSE_LOAN`.

For first application, in one transaction:

1. reload Request;
2. require known-counterparty `PENDING` workflow;
3. reload ACTIVE Loan;
4. verify proposer/counterparty still match Loan parties;
5. read the complete Loan event history from the same transaction snapshot;
6. derive `ledgerToday(ctx.now)` using the fixed Loan ledger timezone semantics;
7. require `proposedEffectiveDate <= ledgerToday`;
8. require close date >= every existing formal event `effectiveDate`;
9. reconstruct balance at close date from pre-close events;
10. require `principalFen === 0`;
11. require `interestFen >= 0`;
12. allocate one event sequence;
13. append one `LOAN_CLOSED` event containing `closeSettlement.accruedInterestFen = interestFen`;
14. set `Loan.status = CLOSED` and `Loan.closedAt = ctx.now`;
15. mark Request APPLIED;
16. commit atomically.

Any failure must leave Loan ACTIVE, Request PENDING and no close event.

## Why interest may remain positive

Closing is not a fabricated `INTEREST_PAYMENT`.

The recorded meaning of mutual close acceptance is:

> Both parties agree principal is fully repaid and all accrued interest through the close date has been settled, waived, rounded, or otherwise handled offline. No amount remains due under this Loan after that boundary.

The close event snapshots the calculator's residual accrued interest immediately before settlement for audit/display.

## No backdated close

A close date before any existing formal event date is invalid.

This prevents a Loan from being declared settled while already containing applied events after the settlement boundary.

Future-dated close is also invalid in MVP.

## Post-close mutation behavior

All existing formal change actions already require `Loan.status === ACTIVE` at proposal/application boundaries.

R11 tests must prove:

- a pending request created before close cannot apply after close;
- no new principal/rate/correction/repayment request can be proposed after close;
- repeated close accept by the same authorized counterparty returns the same close event and does not rewrite `closedAt`.

## Read model behavior

Update `deriveLoanSummary` / `getLoan` behavior:

- locate the formal `LOAN_CLOSED` event when Loan is CLOSED;
- before close effective date: calculate historical money normally;
- at/after close date: project settled zero balance;
- preserve current/latest agreed rate metadata for display unless product UI later decides otherwise;
- expose close date and settlement-interest snapshot;
- `getHomeSummary` continues to exclude CLOSED Loans because it reads ACTIVE Loan lists.

`packages/calc` should continue to ignore `LOAN_CLOSED` for historical mathematical replay. Settlement zeroing belongs in the read-model/lifecycle projection, not by mutating historical principal/rate events.

## Concurrency

Close and another formal mutation both touch the same Loan transaction state/event sequence.

Required outcome under concurrent close vs repayment/add/rate/correction accept:

- only an ordering consistent with one transaction winner is allowed;
- if close commits first, retried competing mutation sees CLOSED and fails;
- if another mutation commits first, close retry must re-read the new event stream and revalidate close date/balance;
- event sequence remains unique.

MemoryRepo should model this deterministically; real CloudBase two-client concurrency must be validated before production.

## Required tests

At minimum:

1. lender and borrower can propose close;
2. unrelated User cannot propose/accept;
3. proposer cannot self-confirm;
4. same key same payload is idempotent;
5. same key changed close date/note conflicts;
6. future close date rejected at final acceptance;
7. close date before latest formal event rejected;
8. non-zero principal rejects close;
9. zero principal + positive accrued interest may close;
10. negative residual interest rejects close;
11. close event snapshots exact pre-close accrued interest;
12. event idempotency comparison includes closeSettlement;
13. Loan status becomes CLOSED and `closedAt` uses trusted server time;
14. Request and Loan/event writes roll back together on injected failure;
15. repeated accept returns same event and does not change closedAt;
16. current summary at/after close is all-zero money due;
17. historical summary before close remains unchanged;
18. home active totals exclude the closed Loan;
19. pending pre-close mutation cannot apply after close;
20. new mutation proposal after close is rejected;
21. concurrent close/other mutation produces a serializable single history;
22. R7/R8/R10 regression tests remain green.

## Non-goals

- generic interest payment event;
- partial interest settlement tracking;
- reopening a closed Loan;
- deleting/rewriting pre-close history;
- UI redesign;
- CloudBase SDK migration.

## Validation gate

Before merge in a dependency-enabled checkout:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Then run real CloudBase two-identity/concurrent close tests before production cutover.
