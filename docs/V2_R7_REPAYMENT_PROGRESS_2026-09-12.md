# V2 R7 — Repayment Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r7-repayment`  
**Base:** `codex/v2-r6-read-model`

## Scope completed

R7 implements the first post-genesis bilateral ledger mutation: `PRINCIPAL_REPAY`.

Implemented server actions:

- `createRepaymentRequest`
- `acceptRequest` (currently supports `PRINCIPAL_REPAY` only)
- `rejectRequest` (currently supports `PRINCIPAL_REPAY` only)
- `cancelRequest` (currently supports `PRINCIPAL_REPAY` only)

Either Loan participant may propose that principal was repaid. The other participant must accept before a formal `PRINCIPAL_REPAY` event is appended.

## Important correctness rule

Proposal-time balance is never authoritative.

Final acceptance runs inside one repository transaction and:

1. reloads the request;
2. reloads the Loan;
3. verifies the actor is the request counterparty and both request parties still match the Loan;
4. reads the complete formal event stream through transaction-scoped sequence pagination;
5. reconstructs principal as of the proposed effective date with `packages/calc`;
6. rejects the apply if repayment would exceed current principal;
7. allocates the next event sequence;
8. appends one deterministic-idempotency `PRINCIPAL_REPAY` event;
9. moves the request to `APPLIED`.

This protects against two stale/concurrent repayments both being accepted against the same old balance.

## Persistence changes

`LedgerTransaction` now exposes bounded `listLoanEvents(...)` using the same sequence cursor contract as the outer repository.

Both implementations support it:

- `MemoryRepo`
- `CloudBaseRepo`

CloudBase acceptance still updates the Loan infrastructure `nextEventSequence` counter in the same transaction, which gives concurrent mutations on one Loan a shared write-conflict point in addition to the unique `(loanId, sequence)` invariant.

## Idempotency

- proposal retries use existing request `idempotencyKey + requestFingerprint` semantics;
- accepted repayment event key is deterministic: `<requestId>:principal-repay`;
- repeated acceptance by the same counterparty returns the already-applied request/event;
- repeated rejection by the same counterparty returns the rejected request;
- repeated cancellation by the proposer returns the cancelled request.

Same idempotency key with changed proposal semantics still conflicts.

## Tests authored

R7 tests cover:

- lender can propose repayment;
- borrower can propose repayment;
- request creation retry idempotency;
- changed-payload idempotency-key conflict;
- successful confirmation creates exactly one formal repayment event;
- repeated confirmation returns the same formal event;
- rejection produces no formal event;
- cancellation produces no formal event;
- proposer cannot self-confirm;
- unrelated User cannot respond;
- non-proposer cannot cancel;
- stale proposal is revalidated at apply time;
- two concurrent 70% repayments against 100% principal cannot both succeed;
- final principal never becomes negative in that race;
- CloudBase transaction adapter exposes the same bounded event pagination contract as non-transaction reads.

## Validation performed in this environment

- R6 → R7 branch diff audit: PASS
- authoritative product-spec check for repayment semantics: PASS
- strict TypeScript 5.8 minimal-environment compile of `repaymentActions.ts`: PASS
- CloudBase SDK transaction API remains based on the locked `@cloudbase/node-sdk 3.18.3` / `@cloudbase/database 1.4.3` boundary audited in R3.

Full workspace validation is still required in a dependency-enabled checkout before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Real CloudBase two-client concurrency testing is still required before production deployment.

## Deliberate limits

R7 does not yet generalize `acceptRequest/rejectRequest/cancelRequest` to every request type. The public action names are generic, but R7 fails closed unless the request type is `PRINCIPAL_REPAY`.

This avoids claiming that principal-add/rate/correction/close semantics are implemented before their own validation rules exist.

## Tooling cleanup note

During R7, several accidental empty safety/working branches were created by the GitHub connector. They contain no unique development work and are not part of the stacked PR chain:

- `tmp-do-not-use`
- `codex/v2-r7-ignore-me`
- `codex/v2-r7-repayment-actions`
- `codex/v2-r7-repayment-safety-copy`
- `codex/v2-r7-repayment-working`

The current connector does not expose delete-ref. They may be deleted manually later. The authoritative R7 branch is only `codex/v2-r7-repayment`.
