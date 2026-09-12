# Next Development Handoff — v2 R6 Read Model and Bidirectional Home

**Date:** 2026-09-12  
**Base branch:** `codex/v2-r5-create-loan`  
**Next milestone:** R6 — read model / home projection

## Authority

Read first:

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md`
4. `AGENTS.md`
5. `docs/V2_R5_CREATE_LOAN_PROGRESS_2026-09-12.md`

## Objective

Build the first useful read side over v2 shared truth:

- `listLoans`
- `getLoan`
- `listLoanEvents`
- `listPendingRequests`
- `getHomeSummary`

No new accounting truth is persisted. All monetary views are reconstructed from ordered `loan_events` through `packages/calc`.

## Core projection rule

One Loan has one event stream.

For a User:

```text
user == loan.lenderUserId   → receivable
user == loan.borrowerUserId → payable
```

The same Loan must never be copied into separate lender/borrower ledgers or separate balance snapshots.

## Authorization

- `getLoan` and `listLoanEvents`: Loan participants only;
- `listLoans`: authenticated User sees only Loans where they are lender or borrower;
- `listPendingRequests`: only requests actionable/visible to the authenticated User;
- unrelated Users must not infer Loan details from IDs;
- identity comes from runtime OPENID -> User.

## Pagination

- keep the R3 cursor contract;
- Loan lists are paginated by stable createdAt/_id cursor;
- event history is paginated by strictly increasing `sequence`;
- home summary must reconstruct **all** active Loans/events, following pages until completion rather than assuming one `.get()` page is complete;
- add an internal bounded page size (e.g. 100) and loop until `nextCursor === null`;
- never expose an unbounded CloudBase read.

## Balance reconstruction

Use `packages/calc` only.

For each active Loan:

1. load the complete ordered event stream;
2. convert events through the existing event-to-interest input path;
3. compute as of the requested/current ledger date;
4. derive principal / interest / total / today's interest / current rate;
5. project into receivable or payable according to participant direction.

Do not reimplement interest math in actions or UI.

## Required behavior

### `getLoan`
Return participant-safe Loan identity + derived summary. Do not expose unrelated private data.

### `listLoans`
Support lender and borrower direction separately or return a combined participant view with explicit direction. Prefer a concrete API over a generic query language.

### `listLoanEvents`
Participant-only, stable ordered pagination. Formal events remain append-only/read-only here.

### `listPendingRequests`
Expose actionable requests relevant to the User. First-contact initiator verification must appear to the proposer; normal pending counterparty requests will be used by later R7 flows.

### `getHomeSummary`
Return at minimum:

```text
receivable: principal / interest / total / loanCount
payable:    principal / interest / total / loanCount
pendingRequestCount
```

One User may simultaneously have receivable and payable totals.

## Minimum tests

- same User lender in one Loan and borrower in another;
- same underlying Loan projects opposite direction for its two participants;
- unrelated User cannot `getLoan` or read events;
- multi-page event history reconstructs complete balance;
- initial principal + initial rate from R5 reconstruct without default 5% fallback;
- multiple active Loans aggregate correctly;
- closed Loan handling follows product spec and does not silently count as active home debt;
- pending first-contact verification increments proposer pending count;
- event pagination has no duplicate/gap across page boundaries;
- today-interest uses calc engine rather than principal change.

## Non-goals

Do not yet implement:

- repayment proposal/acceptance;
- post-creation principal add;
- rate change/correction/close mutation actions;
- CPI fetching;
- UI visual redesign;
- cached/materialized balances.
