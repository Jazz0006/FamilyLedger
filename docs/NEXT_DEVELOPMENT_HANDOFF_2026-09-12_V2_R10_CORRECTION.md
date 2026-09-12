# NEXT DEVELOPMENT HANDOFF — V2 R10 Correction Implementation

**Date:** 2026-09-12  
**Base checkpoint:** `codex/v2-r9-correction-close-semantics`

## Goal

Implement the R9-authorized `CORRECTION` workflow only.

Do **not** implement CLOSE_LOAN in R10.

Authoritative semantics:

- `docs/来往账_产品规划设计书_v2.0.md` §13
- `docs/DATA_MODEL_V2.md` §7, §9–12, §18–20
- `docs/V2_R9_CORRECTION_CLOSE_SEMANTICS_DECISION_2026-09-12.md`

## Shared type change

Replace the old loose Correction interface with:

```ts
interface PrincipalCorrectionPayload {
  correctionKind: 'PRINCIPAL';
  targetEventId: EventId;
  principalDeltaFen: Fen; // signed, non-zero safe integer
  reason?: string | null;
}

interface RateCorrectionPayload {
  correctionKind: 'RATE';
  targetEventId: EventId;
  replacementRate: RateSnapshot;
  reason?: string | null;
}

type CorrectionPayload =
  | PrincipalCorrectionPayload
  | RateCorrectionPayload;
```

No client-supplied `proposedEffectiveDate`.

## Request fingerprint

Update canonical semantic projection for CORRECTION:

Principal:

```text
correctionKind
targetEventId
principalDeltaFen
reason
```

Rate:

```text
correctionKind
targetEventId
replacementRate
reason
```

The derived effective date must not enter the client request fingerprint.

## Proposal action

Add:

```text
createCorrectionRequest
```

Rules:

- current User must be one Loan participant;
- Loan must be ACTIVE;
- counterparty is derived from Loan;
- payload must be exactly one valid correction union member;
- proposal may validate obvious target existence/type for UX, but final acceptance must repeat every authoritative check inside the transaction;
- request creation remains idempotent through requestFingerprint.

## Acceptance — common rules

Expand existing `acceptRequest/rejectRequest/cancelRequest` to support CORRECTION.

At acceptance:

1. reload request and ACTIVE Loan;
2. verify counterparty authority and participant consistency;
3. read complete Loan event history in transaction snapshot;
4. locate `targetEventId` in that same Loan;
5. derive Correction event effectiveDate from target;
6. apply kind-specific validation;
7. allocate one sequence;
8. append exactly one `CORRECTION` event with key `<requestId>:correction`;
9. request -> APPLIED atomically.

## Principal correction validation

Allowed target:

- PRINCIPAL_ADD
- PRINCIPAL_REPAY
- principal-kind CORRECTION (CORRECTION with amountFen != null and no rate)

Candidate event:

```text
eventType = CORRECTION
amountFen = signed principalDeltaFen
rate = absent
targetEventId = payload.targetEventId
effectiveDate = target.effectiveDate
```

Historical invariant:

- combine existing principal-affecting events plus candidate;
- order by effectiveDate then sequence;
- group same-day changes and apply all changes for the day;
- after every distinct effectiveDate boundary, outstanding principal must be >= 0;
- check through the latest relevant event date, not only today.

A later principal addition must not hide a negative interval caused by a backdated correction.

## Rate correction validation

Allowed target:

- RATE_CHANGE
- rate-kind CORRECTION (CORRECTION with rate != null and amountFen == null)

Target must be the current winning rate-affecting event for its effectiveDate:

```text
among all RATE_CHANGE / rate-CORRECTION events
with event.effectiveDate == target.effectiveDate,
target.sequence must be the maximum sequence
```

Candidate event:

```text
eventType = CORRECTION
amountFen = null
rate = replacementRate
targetEventId = payload.targetEventId
effectiveDate = target.effectiveDate
```

Its newly allocated sequence becomes the new same-day winner.

## Correction-of-correction

Allowed only within the same dimension:

- principal Correction may target principal Correction;
- rate Correction may target rate Correction.

Never cross dimensions.

## Event idempotency

Add/confirm event purpose:

```text
correction
```

Key:

```text
<requestId>:correction
```

Retry acceptance by the same authorized counterparty returns the same applied Correction event.

## Read model

Existing calc already consumes CORRECTION:

- signed amount as principal segment;
- replacement rate as rate period;
- sequence-aware same-date rate ordering.

R10 should add tests proving this using real request/application flows, not only manually seeded events.

## Required tests

At minimum:

1. lender and borrower can propose principal Correction;
2. lender and borrower can propose rate Correction;
3. unrelated User cannot propose/accept;
4. proposer cannot self-confirm;
5. same idempotency key + same payload returns original;
6. same key + changed correction payload conflicts;
7. target from another Loan rejected;
8. principal Correction cannot target rate event;
9. rate Correction cannot target principal event;
10. correction-of-correction works only in same dimension;
11. principal Correction that would make any historical day negative is rejected;
12. later principal addition does not hide an earlier negative interval;
13. valid backdated principal compensation changes reconstructed balance correctly;
14. rate Correction of current winning event changes historical rate interval correctly;
15. rate Correction of obsolete same-day event is rejected;
16. retry accept returns same Correction event;
17. reject/cancel creates no event;
18. target event bytes remain unchanged after Correction;
19. R7 repayment concurrency tests remain green;
20. R8 same-day rate-order tests remain green.

## Non-goals

- effective-date correction
- CLOSE_LOAN
- generic cash payment / interest-payment allocation
- event UPDATE/DELETE
- UI redesign
- CloudBase SDK migration

## Validation gate

Before merge in a dependency-enabled checkout:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Then perform real CloudBase tests for target lookup, event sequence uniqueness and concurrent accepts.
