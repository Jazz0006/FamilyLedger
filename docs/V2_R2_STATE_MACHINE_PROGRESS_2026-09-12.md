# V2 R2 — State Machine / Permissions / Idempotency Progress

**Date:** 2026-09-12  
**Branch:** `codex/v2-r2-state-machine`  
**Base:** `codex/v2-r1-clean-domain`

## Completed

R2 adds pure, CloudBase-independent rules under `cloud/functions/ledger/src/domain/`:

- `request-state.ts`
  - known-counterparty request transitions;
  - first-contact `PENDING_INITIATOR_VERIFY` flow;
  - terminal-state protection;
  - centralized transition assertion.
- `permissions.ts`
  - Loan participant checks;
  - counterparty derivation from `Loan`;
  - normal request responder permission;
  - proposer-only cancellation;
  - proposer-only first-contact verification.
- `validation.ts`
  - structural validation for `CREATE_LOAN`;
  - exactly one unknown party for first-contact requests;
  - proposer must occupy the known side;
  - known-counterparty identity consistency;
  - positive safe-integer initial principal.
- `request-fingerprint.ts`
  - deterministic canonical JSON;
  - SHA-256 request fingerprint;
  - semantic-field projection by request type;
  - ignores server/transport-only fields;
  - normalizes optional null-like fields;
  - same-key/different-fingerprint conflict assertion.

Focused tests cover the required state, permission, first-contact, direction, rate metadata, correction target, and idempotency cases.

## Validation performed

The current execution environment cannot resolve GitHub/npm network access, so the full repository commands have not been run here:

```bash
npm install
npm run build
npm run typecheck
npm test
```

To reduce risk despite that limitation, the R2 production modules and tests were copied into a local strict TypeScript harness with minimal dependency declarations.

Results:

- strict TypeScript compile: **PASS**;
- compiled-JS runtime smoke checks for state transitions, participant permissions, first-contact verification, CREATE_LOAN validation, fingerprint stability, and fingerprint conflicts: **PASS**.

This is useful evidence but does not replace the real repository build/Vitest run.

## Non-goals preserved

R2 did not add:

- CloudBase repositories;
- database transactions;
- `ensureUser`;
- invite persistence/claiming;
- CREATE_LOAN application writes;
- Mini Program UI changes.

## Next

Proceed to **R3 — v2 persistence contract and safety foundation**.

R3 must define a new v2 `LedgerRepo`, a deterministic `MemoryRepo`, and CloudBase persistence primitives with pagination, transaction/CAS semantics, stable event ordering, and v2 index assumptions. It must not resurrect the v1 family/admin repository interface.
