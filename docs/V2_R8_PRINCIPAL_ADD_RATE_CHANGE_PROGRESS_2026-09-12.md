# V2 R8 — Principal Add + Rate Change Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r8-principal-add-rate-change`  
**Base:** `codex/v2-r7-repayment`

## Scope completed

R8 extends the known-counterparty bilateral request workflow to:

- `PRINCIPAL_ADD`
- `RATE_CHANGE`

Proposal actions:

- `createPrincipalAddRequest`
- `createRateChangeRequest`

Existing shared actions now support all three implemented known-counterparty request types:

- `PRINCIPAL_REPAY`
- `PRINCIPAL_ADD`
- `RATE_CHANGE`

Shared actions:

- `acceptRequest`
- `rejectRequest`
- `cancelRequest`

Unsupported request types (`CORRECTION`, `CLOSE_LOAN`) still fail closed.

## Shared request creation

R8 adds a deliberately small `known-change-common.ts` helper for:

- Loan ID normalization;
- positive Fen validation;
- optional note normalization;
- idempotency-key normalization;
- Loan participant verification;
- counterparty derivation;
- ACTIVE Loan enforcement;
- canonical request fingerprint creation;
- creation of a normal known-counterparty `PENDING` LedgerRequest.

This is not a generic workflow framework. It exists only to avoid duplicating the same participant/idempotency logic across repayment, principal-add and rate-change proposals.

## PRINCIPAL_ADD semantics

Either lender or borrower may propose additional principal.

Acceptance is atomic:

1. reload request and Loan;
2. verify counterparty authority;
3. verify ACTIVE Loan and participant consistency;
4. allocate one event sequence;
5. append one `PRINCIPAL_ADD` event with deterministic key `<requestId>:principal-add`;
6. mark request `APPLIED`.

There is no v1 unilateral debt-increase path.

## RATE_CHANGE semantics

Either participant may propose a full `RateSnapshot` and effective date.

Rate validation reuses CREATE_LOAN rules:

- explicit decimal-string `annualEffectiveRate`;
- `MANUAL` or `CPI_REFERENCE` source;
- optional reference year/label metadata;
- no implicit default 5%;
- no live CPI pointer that mutates existing Loans later.

Acceptance appends one deterministic `RATE_CHANGE` event and atomically marks the request `APPLIED`.

## Same-effective-date rate ordering

R8 makes the tie-break explicit in the calculator.

`RatePeriod` can carry formal event `sequence`. Rate periods are ordered by:

1. `effectiveFrom`;
2. formal `sequence` when present;
3. original input order only for hand-authored calculator inputs with no sequence.

`toInterestInput` now carries `LoanEvent.sequence` into RATE_CHANGE/CORRECTION rate periods.

Therefore, when two confirmed rate changes have the same effective date, the later formal event sequence wins both:

- for `currentRateSnapshot` display projection;
- for interest calculation.

## Tests authored

R8 coverage includes:

- lender and borrower can both propose principal additions;
- principal-add request retry idempotency;
- changed payload with reused key conflicts;
- confirmed principal addition updates both participants' view of the same Loan;
- applied-event retry returns the same event;
- borrower can propose rate change and lender can confirm;
- RateSnapshot metadata survives into formal event/current-rate projection;
- same-effective-date confirmed rate changes resolve to the later sequence;
- calc-level reversed-input test proves rate precedence is sequence-driven, not array-order driven;
- rejected/cancelled R8 requests create no LoanEvent;
- proposer/unrelated User cannot self-confirm/confirm;
- concurrent distinct principal additions serialize with distinct event sequences and both apply safely.

R7 repayment concurrency protection remains in the same `acceptRequest` implementation and was not weakened.

## Validation performed in this environment

- R7 → R8 diff audit: PASS
- strict TypeScript 5.8 minimal compile of R8 production action modules: PASS
- strict TypeScript 5.8 minimal compile of modified calc modules: PASS
- shared enum/type export audit: PASS

Full dependency-backed validation is still required before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Explicit non-goals

R8 deliberately does not implement:

- `CORRECTION`
- `CLOSE_LOAN`
- direct event edits/deletes
- materialized authoritative balances
- family/admin compatibility
- SDK migration
- Mini Program UI redesign

The authoritative data model explicitly says Correction's exact subtype/compensation shape must be narrowed when implementation begins. That becomes the next audit target rather than being guessed inside R8.
