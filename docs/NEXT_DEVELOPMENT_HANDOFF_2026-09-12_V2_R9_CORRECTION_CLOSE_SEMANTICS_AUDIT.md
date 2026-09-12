# NEXT DEVELOPMENT HANDOFF — V2 R9 Correction / Close Semantics Audit

**Date:** 2026-09-12  
**Base checkpoint:** `codex/v2-r8-principal-add-rate-change`

## Goal

Do **not** immediately code `CORRECTION` or `CLOSE_LOAN`.

First resolve two business-model ambiguities that are now visible only because CREATE_LOAN, repayment, principal-add, rate-change and derived balances are implemented together.

## Finding 1 — Correction payload is intentionally under-specified

`DATA_MODEL_V2.md` currently says:

```ts
export interface CorrectionPayload {
  targetEventId: EventId;
  /**
   * Compensating change, not replacement of the original event.
   * Exact subtype should be narrowed further when implementation begins.
   */
  principalDeltaFen?: Fen;
  replacementRate?: RateSnapshot;
  proposedEffectiveDate: IsoDate;
  reason?: string | null;
}
```

Before implementation, decide at minimum:

1. whether one Correction may contain both principal and rate compensation, or exactly one;
2. which target LoanEvent types may be corrected;
3. whether a Correction may target another Correction;
4. how rate correction effective dates work;
5. whether principal compensation that would produce negative principal is forbidden with the same transaction-snapshot rule as repayment;
6. deterministic event-idempotency shape when one request could create more than one compensating event.

Recommended MVP direction: **one correction request = one explicit compensation dimension**.

- principal correction → signed `principalDeltaFen`, no replacement rate;
- rate correction → replacement `RateSnapshot`, no principal delta;
- target event must belong to the same Loan;
- the formal target event remains unchanged;
- the Correction event stores `targetEventId` plus only the agreed compensating effect;
- server revalidates balance-sensitive principal corrections inside the acceptance transaction.

Do not finalize this recommendation without checking the product UX implication.

## Finding 2 — Current model has no way to settle accrued interest

This is the more serious issue.

Current formal money events are:

- `PRINCIPAL_ADD`
- `PRINCIPAL_REPAY`
- `RATE_CHANGE`
- `CORRECTION`
- `LOAN_CLOSED`

R7 correctly enforces:

```text
PRINCIPAL_REPAY amount <= current principal
```

The calculator treats repayment as a negative principal segment. Example:

```text
Day 0: +100 principal at 5%
1 year later: total due ≈ 105
Then: -100 PRINCIPAL_REPAY
Result:
  principal = 0
  accrued interest ≈ 5 remains
```

Because repayment cannot exceed principal, there is currently **no normal formal event that can settle/pay the remaining interest**.

But the product specification says CLOSE_LOAN should occur when principal and interest satisfy close conditions, and LoanSummary exposes `principal + interest = total due`.

Therefore CLOSE_LOAN semantics cannot be implemented safely until interest settlement is defined.

## Required product decision before CLOSE_LOAN

Choose one explicit model. Candidate directions:

### Option A — Introduce explicit interest settlement

Add a request/event such as `INTEREST_SETTLEMENT` / `INTEREST_PAYMENT`.

Pros:
- accounting meaning is explicit;
- principal remains principal;
- closure can require principal == 0 and unsettled interest == 0.

Cons:
- calculator/event model becomes more complex because accrued interest becomes partly realizable/settleable state.

### Option B — Redefine repayment as payment against total due

A payment first settles accrued interest, then reduces principal (or uses another documented allocation rule).

Pros:
- natural user concept: “I paid ¥X”.

Cons:
- `PRINCIPAL_REPAY` is no longer an accurate name;
- event reconstruction becomes materially more complex;
- requires careful allocation/history semantics.

### Option C — Close explicitly settles/waives residual interest

Keep repayments principal-only. `CLOSE_LOAN` means both parties agree that any remaining calculated interest is settled or waived as of the close date.

Pros:
- smallest MVP change;
- no new payment-allocation engine.

Cons:
- closure carries financial meaning beyond lifecycle state;
- current statement that `LOAN_CLOSED` “changes lifecycle state, not historical math” becomes incomplete;
- Loan detail after close must clearly distinguish historical calculated amount from agreed settled state.

## Recommended MVP direction for audit

Evaluate **Option C first** because this product is a mutually acknowledged private ledger, not a payment processor or accounting system.

A possible clear rule would be:

> A Loan may be closed only when principal is zero. By accepting CLOSE_LOAN, both parties explicitly acknowledge that any accrued interest through the close effective date has been settled, waived, or otherwise handled offline. The close event does not rewrite prior history; it terminates future accrual and active balance presentation from the agreed close date.

However, this requires calculator/read-model changes: after `LOAN_CLOSED`, future “current due” cannot continue accumulating as if the debt remained active.

Do not code this until the product/data-model documents explicitly adopt or reject it.

## Audit deliverables

R9 read-only/design audit should produce:

1. correction subtype recommendation;
2. interest-settlement/close recommendation;
3. exact event semantics;
4. exact derived-balance behavior before/at/after close;
5. transaction validation rules;
6. minimal data-model changes;
7. tests required before implementation.

Then update both authoritative documents together:

- `docs/来往账_产品规划设计书_v2.0.md`
- `docs/DATA_MODEL_V2.md`

Only after those docs agree should production code for correction/close begin.
