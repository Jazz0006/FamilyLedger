# V2 R9 — Correction / Close Semantics Decision

**Status:** design decision for authoritative-doc consolidation before production implementation  
**Date:** 2026-09-12  
**Branch:** `codex/v2-r9-correction-close-semantics`

## 1. Decision summary

R9 resolves two previously under-specified areas without writing production mutation code yet.

### Correction

A Correction is one explicit compensating fact appended to the Loan event stream. It never edits or deletes the target event.

MVP Correction has exactly one dimension:

- principal compensation; or
- rate replacement.

One Correction request creates exactly one `CORRECTION` LoanEvent.

### Close

`CLOSE_LOAN` is a mutually confirmed **final settlement boundary**, not proof that ChatGPT/WeChat/the app moved money.

MVP closure rule:

1. principal must be exactly zero at the agreed close effective date;
2. the server calculates remaining accrued interest at that date;
3. both parties accepting `CLOSE_LOAN` means they jointly acknowledge that this remaining interest has been settled, waived, rounded, or otherwise handled offline and that no further claim remains in this Loan;
4. the close event snapshots that accrued-interest amount for audit/display;
5. after the close effective date, the current Loan projection is settled at zero and no further interest accrues;
6. historical calculations before the close date remain reconstructable and unchanged.

This is deliberately different from inventing an `INTEREST_PAYMENT` event when the system did not observe a payment.

---

## 2. Why this direction

FamilyLedger records mutually acknowledged facts about an external/offline debt relationship. It is not a payment processor, bank ledger, or loan servicer.

A normal loan payoff amount includes accrued interest through the payoff date, so principal balance alone is not enough to describe full settlement. At the same time, the current v2 event model intentionally uses `PRINCIPAL_REPAY` for principal reduction and does not model cash-payment allocation between interest and principal.

Therefore the MVP should not silently redefine `PRINCIPAL_REPAY` as a generic payment. Doing so would make the event name and existing calculation semantics dishonest.

Instead, closure is the explicit point where both parties say: **this Loan is finished; no balance remains between us under this record.**

---

## 3. Correction payload — narrowed MVP shape

Replace the loose all-optional Correction payload with a discriminated union:

```ts
export interface PrincipalCorrectionPayload {
  correctionKind: 'PRINCIPAL';
  targetEventId: EventId;
  /** Signed, non-zero compensation in Fen. */
  principalDeltaFen: Fen;
  reason?: string | null;
}

export interface RateCorrectionPayload {
  correctionKind: 'RATE';
  targetEventId: EventId;
  replacementRate: RateSnapshot;
  reason?: string | null;
}

export type CorrectionPayload =
  | PrincipalCorrectionPayload
  | RateCorrectionPayload;
```

`proposedEffectiveDate` is deliberately removed from Correction input.

The formal Correction event's `effectiveDate` is derived server-side from the target event. A client must not be allowed to say it is correcting one historical event while applying the compensation on an unrelated date.

If users need a new principal change today, they use `PRINCIPAL_ADD` / `PRINCIPAL_REPAY`. If they need a new rate from a new date, they use `RATE_CHANGE`.

Changing an event's historical effective date is **not part of MVP Correction**. Date correction would require deterministic reverse-and-reapply semantics and should be a later feature.

---

## 4. Principal Correction rules

A principal Correction may target:

- `PRINCIPAL_ADD`;
- `PRINCIPAL_REPAY`;
- an earlier principal-kind `CORRECTION`.

It must not target a rate-only event or `LOAN_CLOSED`.

The compensation is signed:

```text
original +100, should have been +80  -> principalDeltaFen = -20
original -30,  should have been -20  -> principalDeltaFen = +10
```

The original event remains unchanged.

### Transaction validation

At acceptance, the server must:

1. reload the request and Loan;
2. load the complete formal event stream in the same transaction snapshot;
3. verify `targetEventId` belongs to that Loan and is an allowed principal-affecting event;
4. derive Correction `effectiveDate` from the target event;
5. replay the principal timeline with the candidate compensation inserted;
6. reject if outstanding principal would become negative at any ledger-day boundary after that effective date;
7. append one `CORRECTION` event and mark the request `APPLIED` atomically.

This is stronger than checking only today's principal because a backdated compensation can make a historical interval invalid even if a later addition makes the current balance positive again.

---

## 5. Rate Correction rules

A rate Correction may target:

- `RATE_CHANGE`;
- an earlier rate-kind `CORRECTION`.

It must not target principal-only events or `LOAN_CLOSED`.

The Correction event:

- inherits the target event's `effectiveDate`;
- stores the agreed replacement `RateSnapshot`;
- uses its later formal `sequence` as the same-day tie-break.

### Avoiding ambiguous same-day corrections

At acceptance, the target must be the **current winning rate-affecting event for that effective date** (highest sequence among rate-affecting events on that date).

This prevents a user from selecting an obsolete same-day rate event and accidentally overriding a newer same-day agreement.

If a previous rate Correction itself was wrong, the new Correction targets that latest Correction event.

---

## 6. Correction formal event shape

One Correction request creates exactly one event with deterministic key:

```text
<requestId>:correction
```

Principal Correction event:

```ts
{
  eventType: 'CORRECTION',
  targetEventId,
  amountFen: principalDeltaFen,
  rate: undefined,
  effectiveDate: target.effectiveDate,
  ...
}
```

Rate Correction event:

```ts
{
  eventType: 'CORRECTION',
  targetEventId,
  amountFen: null,
  rate: replacementRate,
  effectiveDate: target.effectiveDate,
  ...
}
```

The event must never contain both principal compensation and a replacement rate.

---

## 7. Close semantics — final settlement boundary

MVP `CLOSE_LOAN` remains a normal mutually confirmed LedgerRequest.

Proposed payload remains intentionally small:

```ts
export interface CloseLoanPayload {
  proposedEffectiveDate: IsoDate;
  note?: string | null;
}
```

The UI and API contract must make the acceptance meaning explicit:

> By confirming closure, both parties agree that the principal is fully repaid and any remaining accrued interest through the close date has been settled, waived, rounded, or otherwise handled offline. No amount remains due under this Loan after that date.

The app does not claim which external payment/waiver caused that settlement.

---

## 8. Close acceptance validation

`CLOSE_LOAN` acceptance must run in one transaction and:

1. reload the request and ACTIVE Loan;
2. verify actor/counterparty permissions;
3. load the complete Loan event stream;
4. require `proposedEffectiveDate <= ledgerToday(serverNow)` — no future-dated closure in MVP;
5. require the close date to be **on or after every existing formal event effectiveDate** — no backdated close that leaves later applied events after the settlement boundary;
6. reconstruct balance at the close date;
7. require `principalFen === 0`;
8. require `interestFen >= 0`; a negative residual requires Correction before close;
9. snapshot `interestFen` into the formal close event;
10. append one `LOAN_CLOSED` event;
11. set `Loan.status = CLOSED` and `closedAt = serverNow`;
12. mark the request `APPLIED`.

All writes are atomic.

A pending principal/rate/correction request that is later accepted after Loan closure must fail because formal changes require an ACTIVE Loan.

---

## 9. Close event settlement snapshot

Do not overload generic `amountFen` with an ambiguous meaning.

Add an explicit optional snapshot:

```ts
export interface CloseSettlementSnapshot {
  /** Server-calculated accrued interest outstanding immediately before close. */
  accruedInterestFen: Fen;
}

export interface LoanEvent {
  // existing fields...
  closeSettlement?: CloseSettlementSnapshot;
}
```

For `LOAN_CLOSED`:

- `amountFen = null`;
- `rate` absent;
- `closeSettlement.accruedInterestFen` is required;
- `effectiveDate` is the mutually agreed close date.

This field is an audit snapshot of what the calculator showed immediately before settlement. It is **not** a claim that this exact amount was transferred through the app.

Deterministic event key:

```text
<requestId>:loan-close
```

---

## 10. Derived balance behavior after close

The immutable pre-close event history remains mathematically reconstructable.

For a CLOSED Loan:

- querying a historical as-of date **before** close uses normal event replay;
- at/after the close effective date, the product's current settlement projection is:

```text
principal = 0
interest = 0
total due = 0
today interest = 0
```

No further interest accrues after closure.

The UI may separately show:

- close effective date;
- `closeSettlement.accruedInterestFen`;
- close note;
- complete pre-close event history.

This distinction is important: historical calculated accrued interest is preserved for audit, while the current contractual balance is zero because both parties explicitly closed the Loan.

`UserHomeSummary` continues to exclude CLOSED Loans from active receivable/payable totals.

---

## 11. LoanSummary follow-up shape

Before implementing close UI/read behavior, extend the derived summary enough to avoid showing a CLOSED Loan with a positive current amount due.

Recommended shape:

```ts
export interface LoanSummary {
  // existing money/rate fields...
  status: LoanStatus;
  closeEffectiveDate?: IsoDate | null;
  settledInterestFen?: Fen | null;
}
```

For an ACTIVE Loan these close fields are null.

For a CLOSED Loan current projection, money due is zero and `settledInterestFen` comes from the close event snapshot.

---

## 12. Why not add INTEREST_PAYMENT now

A richer future model may record actual payments and allocate them between accrued interest and principal. That would be appropriate if the product evolves toward payment-ledger/accounting behavior.

It is intentionally not part of this MVP because it would require:

- a generic payment event rather than `PRINCIPAL_REPAY`;
- an allocation rule (interest first, principal first, or explicit split);
- treatment of partial interest payments;
- effect of paid/unpaid interest on compounding;
- migration of existing repayment semantics;
- substantially more UI complexity.

The settlement-boundary model gives the current product a truthful and testable way to finish a Loan without pretending to observe external money movement.

---

## 13. Implementation sequence after this decision is authoritative

Recommended next production milestones:

1. **R10 — Correction implementation**
   - shared discriminated Correction payload;
   - target validation;
   - historical principal invariant validation;
   - rate target winner validation;
   - deterministic single CORRECTION event.

2. **R11 — Close implementation**
   - close request proposal;
   - transaction balance validation;
   - Loan update capability in repository transaction;
   - `LOAN_CLOSED` settlement snapshot;
   - closed read-model projection;
   - no post-close mutations.

3. **R12 — UI / real CloudBase end-to-end validation**
   - two-account flows;
   - invite/share;
   - all request types;
   - closed/history display;
   - concurrency and index validation.

Production code for Correction/Close must not begin until the product spec and data-model document incorporate these rules.
