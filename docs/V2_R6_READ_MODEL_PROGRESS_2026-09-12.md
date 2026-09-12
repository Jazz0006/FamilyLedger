# v2 R6 Progress — Read Model and Bidirectional Home

**Date:** 2026-09-12  
**Branch:** `codex/v2-r6-read-model`  
**Milestone:** R6 — participant-safe read side

## Completed

Added the v2 read actions:

- `getLoan`
- `listLoans`
- `listLoanEvents`
- `listPendingRequests`
- `getHomeSummary`

No new accounting truth or write semantics were introduced.

## Shared projection

`actions/read-model.ts` centralizes the read-side rules:

- all event history is read page-by-page until `nextCursor === null`;
- all active Loan lists used by home are read page-by-page;
- actionable request counting also follows every page;
- cursor loops fail loudly if a repository returns a non-advancing cursor;
- full event streams are converted through `packages/calc/toInterestInput`;
- balances use `packages/calc/computeBalance` only;
- today's interest uses `packages/calc/interestGrowthOn` only;
- current rate display metadata is projected from confirmed RATE_CHANGE/CORRECTION events rather than inventing a separate rate snapshot store.

## Bidirectional semantics

One shared Loan/event stream projects as:

```text
user == lenderUserId   -> receivable
user == borrowerUserId -> payable
```

No per-user balance copies are created.

A single User can have simultaneous receivable and payable totals across different Loans.

## Privacy

Direct Loan-ID reads collapse both nonexistent and unauthorized Loans to `NOT_FOUND`, so unrelated Users cannot probe private bilateral relationships by comparing error codes.

Event history is participant-only.

`listLoans` injects the authenticated User ID server-side and never accepts a client user ID as authority.

## Pagination / reconstruction

The read model deliberately validates the R3 persistence contract rather than bypassing it.

A test creates 103 formal events for one Loan and verifies:

- page 1 returns sequence 1..100;
- page 2 returns sequence 101..103;
- full derived principal includes every event;
- no single CloudBase-style page is treated as complete history.

## Home summary

`getHomeSummary` aggregates only ACTIVE Loans:

- `receivable.principalFen / interestFen / totalFen / loanCount`
- `payable.principalFen / interestFen / totalFen / loanCount`
- `pendingRequestCount`

CLOSED Loans are excluded from active home totals.

## Tests authored

Coverage includes:

- same Loan shown as receivable to lender and payable to borrower;
- same User lender in one Loan and borrower in another;
- unrelated User cannot read Loan/details/events;
- listLoans direction projection;
- >100-event history reconstructs without truncation;
- initial explicit rate is used with no fixed-rate fallback;
- genesis-day today's interest is zero;
- latest effective RateSnapshot metadata is preserved;
- first-contact initiator verification appears in pending count;
- CLOSED Loans do not enter active home totals.

## Validation performed here

- R5 -> R6 diff audit: no persistence/write changes;
- strict TypeScript minimal-environment compile of R6 production read-model/actions: **PASS**.

Full dependency-backed workspace validation remains required before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Next

R7 implements the first post-creation formal mutation: repayment proposal + counterparty acceptance.

The acceptance path must re-read the Loan's complete formal event history **inside the same transaction that applies the repayment**, derive current principal, reject over-repayment, append exactly one PRINCIPAL_REPAY event, and mark the request APPLIED atomically.
