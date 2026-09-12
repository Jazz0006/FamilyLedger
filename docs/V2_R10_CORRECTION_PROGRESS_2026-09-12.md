# V2 R10 — Correction Implementation Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r10-correction`  
**Base:** `codex/v2-r9-correction-close-semantics`

## Status

R10 production scope is implemented: mutually confirmed append-only `CORRECTION` requests for principal compensation and rate replacement.

`CLOSE_LOAN` remains deliberately unavailable.

## Implemented domain shape

The old loose Correction payload was replaced with a discriminated union:

- `PRINCIPAL` — target event + signed non-zero `principalDeltaFen` + optional reason;
- `RATE` — target event + replacement `RateSnapshot` + optional reason.

Client-supplied Correction effective dates are rejected. Formal Correction `effectiveDate` is derived from the target event at acceptance.

## Request fingerprint

Correction fingerprints now include only client/business semantics:

Principal:

- correction kind;
- target event id;
- signed principal delta;
- reason.

Rate:

- correction kind;
- target event id;
- normalized replacement rate snapshot;
- reason.

The server-derived effective date is intentionally absent from the fingerprint.

## Application flow

Added `createCorrectionRequest` and exposed it through the v2 router.

Existing `acceptRequest`, `rejectRequest`, and `cancelRequest` were extended narrowly to support CORRECTION alongside the previously implemented known-counterparty change types.

Final acceptance:

1. reloads Request and ACTIVE Loan inside the transaction;
2. verifies actor/counterparty/Loan participant consistency;
3. loads the complete Loan event stream through transaction pagination;
4. resolves the target only inside that Loan;
5. derives the Correction effective date from the target;
6. validates the correction dimension and history invariant;
7. allocates one Loan sequence;
8. appends exactly one deterministic `<requestId>:correction` event;
9. transitions Request to APPLIED atomically.

## Principal correction rules implemented

Allowed targets:

- `PRINCIPAL_ADD`;
- `PRINCIPAL_REPAY`;
- principal-kind `CORRECTION`.

The candidate compensation is replayed with all existing principal-affecting events ordered by effective date + sequence. Same-day changes are grouped; outstanding principal must be non-negative after every distinct ledger-date boundary.

This specifically prevents a later principal addition from hiding an invalid negative historical interval caused by a backdated correction.

## Rate correction rules implemented

Allowed targets:

- `RATE_CHANGE`;
- rate-kind `CORRECTION`.

The target must be the highest-sequence rate-affecting event for its effective date. An obsolete same-day rate event cannot be corrected over a newer same-day agreement.

The newly appended Correction becomes the new same-day winner through the existing sequence-aware calc/read-model rule.

## Append-only guarantees

R10 does not add any LoanEvent update/delete API.

The target event is never modified. A correction-of-correction is supported only inside the same dimension.

## Coverage authored

Tests cover:

- lender and borrower proposal authority for both correction dimensions;
- idempotent request retry and changed-payload conflict;
- rejection of client-supplied Correction effective date;
- cross-dimension payload rejection;
- counterparty-only confirmation;
- unrelated-user denial;
- target event from another Loan rejection;
- principal correction of principal event;
- rate correction of rate event;
- same-dimension correction-of-correction;
- cross-dimension target rejection;
- historical negative-principal interval rejection even when later balance is positive;
- rate correction of obsolete same-day event rejection;
- repeated accept returning the same formal event;
- reject/cancel producing no Correction event;
- target event bytes remaining unchanged;
- full one-year calculation reflecting the corrected historical rate interval.

Existing R7 repayment and R8 rate ordering code paths were not structurally replaced.

## Validation performed in this environment

- R9 -> R10 branch diff audit: PASS; no persistence/schema or Close implementation changes.
- local TypeScript 5.8 strict synthetic compile of the Correction discriminated-union, event candidate, and historical-principal scan shapes: PASS.
- repository shell cannot resolve GitHub/npm DNS, so dependency-backed workspace tests were not run here.

Required before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Then validate against real CloudBase with two identities, including concurrent accepts and target/sequence behavior.

## Next

Proceed to **R11 — CLOSE_LOAN implementation** using the semantics fixed in `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md`.
