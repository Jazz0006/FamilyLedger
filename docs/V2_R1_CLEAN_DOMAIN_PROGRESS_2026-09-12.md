# v2 R1 Clean Domain Rewrite — Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r1-clean-domain`  
**Base:** `main@70604d7c13aaa49e4998e2851456ef67ef54c9da`

## Result

R1 has established the v2 domain as the active TypeScript foundation and intentionally removed the obsolete v1.1 family/admin server business layer instead of adding compatibility adapters.

## Shared domain completed

`packages/shared` now models v2 directly:

- `User` has no global role and no `familyId`;
- `Loan` replaces `LoanAccount`;
- `LedgerRequest` replaces `ChangeRequest`;
- typed payloads exist for CREATE_LOAN, principal add/repay, rate change, correction and close;
- request statuses include `PENDING_INITIATOR_VERIFY` and `EXPIRED`;
- `RateSnapshot` + `RateSource` represent explicit agreed rate snapshots;
- `InviteToken` is request-bound and uses claimed user semantics;
- `LoanEvent` uses schema version 2, request source IDs, stable sequence, RateSnapshot and `LOAN_CLOSED`;
- v2 collections are `users`, `loans`, `ledger_requests`, `loan_events`, `invite_tokens`, `audit_logs`, optional `rate_references`;
- `DEFAULT_FAMILY_ID`, global `UserRole`, `LoanTerm`, old ChangeRequest enums, and the fixed product-level 5% default were removed from active shared code.

## Calculation cleanup completed

`packages/calc` was adapted to the v2 event shape:

- RATE_CHANGE consumes `RateSnapshot.annualEffectiveRate`;
- `LOAN_CLOSED` is lifecycle-only and does not rewrite historical money math;
- balance calculation now requires explicit confirmed rate history;
- the old implicit 5% fallback was removed;
- tests were updated so the headline 5% example uses an explicit initial RATE_CHANGE event/rate period;
- a missing-rate-history test now fails loudly instead of silently applying v1 behavior.

## v1 server layer deliberately removed

The following obsolete v1.1 server concepts were deleted rather than migrated:

- bootstrapAdmin;
- family invite/bind actions;
- admin action context;
- direct recordLodgment;
- unfinished proposeRepayment / confirmChange;
- family getHomeSummary;
- v1 setupCollections;
- v1 LedgerRepo, MemoryRepo and CloudBaseRepo;
- tests/helpers tied to those flows.

The cloud entry point is intentionally a disabled R1 boundary returning `INVALID_STATE` until the v2 application/persistence layer is rebuilt. This prevents accidental deployment of old unilateral-write semantics.

Generic infrastructure retained for reuse:

- CloudBase runtime context;
- crypto/token helpers;
- bundle plumbing;
- a small v2 error envelope.

## Documentation cleanup

- root README now describes the clean rewrite rather than compatibility migration;
- cloud README no longer instructs creation/use of v1 collections/actions;
- obsolete `docs/CLOUDBASE_SETUP.md` was removed;
- miniprogram README explicitly marks the current family/admin pages as temporary v1 reference only.

## Validation status

Static branch audit:

- branch is ahead of `main` and not behind;
- active TypeScript server action/data files containing v1 family/admin logic were removed;
- shared types/constants/collections now reflect the v2 authoritative data model;
- calc code no longer depends on a product-level default annual rate.

This environment does not provide a runnable checkout/npm execution path, so `npm run build`, `npm run typecheck`, and `npm test` have **not** been executed here. Do not mark runtime validation PASS until those commands run in CI or a normal checkout.

Expected commands:

```bash
npm install
npm run build
npm run typecheck
npm test
```

The cloud package temporarily uses `vitest run --passWithNoTests` because all v1 cloud behavior tests were intentionally deleted. R2 must add replacement state-machine/permission/idempotency tests.

## R1 gate assessment

R1 domain objectives are complete. The only outstanding gate is executable build/test confirmation outside this connector-only environment.

The next implementation task is **R2 — request state machine, permissions, and idempotency fingerprint**. Do not restore any v1 family/admin abstraction to accomplish R2.
