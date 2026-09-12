# V2 R11 — CLOSE_LOAN Implementation Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r11-close-loan`  
**Base:** `codex/v2-r10-correction`

## Status

R11 production scope is implemented: mutually confirmed `CLOSE_LOAN` as the R9-defined final settlement boundary.

The implementation does **not** introduce a generic payment or interest-payment event.

## Shared model

Added:

```ts
interface CloseSettlementSnapshot {
  accruedInterestFen: Fen;
}
```

`LoanEvent` now has optional `closeSettlement` metadata.

`LoanSummary` now exposes:

- `status`;
- `closeEffectiveDate`;
- `settledInterestFen`.

For a CLOSED Loan at/after the close boundary, current contractual money due projects to zero while the pre-close event history remains immutable and mathematically reconstructable.

## Persistence transaction capability

Added one narrow capability:

```ts
LedgerTransaction.putLoan(loan: Loan)
```

MemoryRepo replaces the typed Loan in the transaction snapshot.

CloudBaseTransaction performs a partial typed update so the infrastructure-only `nextEventSequence` field is preserved.

No generic ORM/update framework was introduced.

## Event idempotency

Formal-event semantic comparison now includes:

```ts
closeSettlement.accruedInterestFen
```

Therefore `<requestId>:loan-close` cannot silently treat a changed settlement snapshot as the same event.

## Proposal

Added and routed:

```text
createCloseLoanRequest
```

Rules:

- proposer must be a Loan participant;
- Loan must currently be ACTIVE;
- counterparty is derived from the Loan;
- close effective date is an explicit YYYY-MM-DD calendar date;
- future-dated close is rejected from trusted server time at proposal and rechecked at final acceptance;
- request creation uses the existing canonical idempotency/fingerprint contract.

## Final acceptance transaction

`acceptRequest` now supports `CLOSE_LOAN`.

Inside one transaction it:

1. reloads the Request;
2. verifies counterparty authority;
3. reloads the ACTIVE Loan;
4. verifies request parties still match Loan parties;
5. reads the complete Loan event stream through transaction pagination;
6. requires close date <= trusted ledger today;
7. requires close date >= every existing formal event date;
8. reconstructs the pre-close balance;
9. requires principal exactly zero;
10. requires residual interest >= 0;
11. allocates one event sequence;
12. appends one deterministic `LOAN_CLOSED` event with settlement-interest snapshot;
13. persists Loan `status=CLOSED` and `closedAt=serverNow`;
14. marks the Request APPLIED.

All business writes share the same transaction. A failure after event/Loan mutation but before final request persistence rolls the whole MemoryRepo transaction back; equivalent atomicity is required from CloudBase.

Repeated accept of an already APPLIED close request returns the original close event before attempting any new Loan lifecycle write, so `closedAt` does not drift on retry.

## Read model

`deriveLoanSummary` now validates Loan lifecycle/event consistency.

ACTIVE Loan:

- `closedAt` must be null;
- no `LOAN_CLOSED` event may exist.

CLOSED Loan:

- `closedAt` must be present;
- exactly one `LOAN_CLOSED` event must exist;
- settlement snapshot must contain a non-negative safe-integer accrued-interest value.

For `asOfDate < closeEffectiveDate`, historical money is calculated normally from the immutable event stream.

For `asOfDate >= closeEffectiveDate`:

```text
principal = 0
interest = 0
total = 0
todayInterest = 0
```

The summary still exposes the agreed current rate metadata, close date, and settled-interest snapshot.

`getHomeSummary` continues to query only ACTIVE Loans, so closed debts leave active receivable/payable totals automatically.

## Post-close mutation behavior

Existing known-counterparty proposal/application paths require an ACTIVE Loan.

Tests cover:

- a request created before closure cannot be applied afterward;
- new principal/rate/correction/repayment-style mutations cannot be proposed after closure;
- concurrent close versus principal addition serializes to exactly one valid history.

## R7 repayment safety hardening discovered during R11

The close audit exposed an older edge case: a newly confirmed **backdated repayment** could be valid on its own effective date but, when inserted before an already-applied later repayment, make principal negative on a later historical interval.

R11 therefore extracted a shared principal-timeline invariant:

```text
candidate event + existing principal events
→ order by effectiveDate + sequence
→ group same-day effects
→ require principal >= 0 after every ledger-date boundary
```

This invariant is now used by both:

- PRINCIPAL_REPAY final acceptance;
- principal CORRECTION final acceptance.

A focused regression test covers the previously missed 100k principal → later 80k repayment → attempted earlier 50k repayment case. The second repayment is now rejected rather than producing a -30k later interval.

## Coverage authored

R11 tests cover at least:

- lender and borrower close proposals;
- request retry and changed-payload conflict;
- unrelated-user denial;
- proposer self-confirm denial;
- reject/cancel without close event;
- non-zero principal rejection;
- future-date final revalidation;
- close date before existing later event rejection;
- positive residual accrued interest settlement;
- zero residual interest settlement;
- negative residual interest rejection;
- exact `closeSettlement.accruedInterestFen` snapshot;
- event idempotency comparison including close settlement;
- trusted `closedAt` server timestamp;
- repeated accept returns same close event and preserves original `closedAt`;
- current CLOSED summary is zero due;
- pre-close historical summary remains intact;
- active home totals exclude closed Loan;
- injected final-write failure rolls back close event + Loan lifecycle + Request state;
- pending pre-close mutation cannot apply after close;
- new mutation proposal after close is rejected;
- concurrent close vs principal-add yields one serializable winner;
- event sequence remains unique;
- CloudBase adapter lifecycle update omits infrastructure-only `nextEventSequence` from business payload;
- backdated repayment full-timeline non-negative regression.

## Validation performed in this environment

- R10 -> R11 diff audit: PASS for intended scope; no new collection/index/payment model.
- local TypeScript 5.8 strict synthetic compile of CLOSED summary narrowing, rollback Proxy shape, and principal-timeline invariant: PASS.
- full dependency-backed workspace validation cannot run in this shell because GitHub/npm DNS is unavailable.

Required before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Then run real CloudBase two-identity tests, especially:

- close vs concurrent mutation;
- transaction rollback/retry;
- unique event sequence;
- required indexes;
- closed/read-history projection.

## Next

Proceed to **R12 — v2 cutover / UI / real CloudBase hardening**.

Start with a read-only repository audit before changing Mini Program UI or deleting remaining legacy pages. Confirm what legacy v1 UI/routes/setup assets still survive and map them against the now-complete v2 server action set.
