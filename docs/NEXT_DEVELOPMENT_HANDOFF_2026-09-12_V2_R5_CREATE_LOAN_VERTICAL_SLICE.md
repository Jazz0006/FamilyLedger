# Next Development Handoff — v2 R5 CREATE_LOAN Vertical Slice

**Date:** 2026-09-12  
**Base branch:** `codex/v2-r4-ensure-user`  
**Next milestone:** R5 — CREATE_LOAN first-contact closed loop

## Read first

1. `docs/来往账_产品规划设计书_v2.0.md`
2. `docs/DATA_MODEL_V2.md`
3. `docs/V2_CLEAN_REWRITE_ROADMAP.md`
4. `AGENTS.md`
5. `docs/V2_R2_STATE_MACHINE_PROGRESS_2026-09-12.md`
6. `docs/V2_R3_PERSISTENCE_PROGRESS_2026-09-12.md`
7. `docs/V2_R4_ENSURE_USER_PROGRESS_2026-09-12.md`

## Objective

Build the first complete v2 formal-ledger path:

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ invitee accept/claim
→ PENDING_INITIATOR_VERIFY
→ initiator verifies claimed identity
→ atomic apply
   ├─ create Loan
   ├─ append PRINCIPAL_ADD genesis event
   ├─ append RATE_CHANGE genesis event
   ├─ mark request APPLIED
   └─ finalize invite
```

The first-contact path is the primary target because it exercises identity, mutual consent, invite claim, state machine, idempotency, transaction boundaries, and two genesis events.

## Non-negotiable rules

- request proposer is a normal v2 User;
- exactly one CREATE_LOAN party may be unknown for first contact;
- proposer must occupy the known party side in the payload;
- initial principal and rate are proposal snapshots and cannot change silently during invite flow;
- invite token contains no authority-bearing family/role/display-name fields;
- claimant identity comes only from trusted runtime OPENID -> User;
- claimant cannot equal proposer;
- first-contact invitee acceptance does **not** create a Loan;
- acceptance binds the counterparty and moves the request to `PENDING_INITIATOR_VERIFY`;
- only the original proposer can perform final verification;
- final apply is one repository transaction;
- the transaction creates exactly one Loan and exactly two genesis events;
- both genesis events share `sourceRequestId` but have distinct deterministic event idempotency keys;
- request becomes APPLIED only in the same atomic transaction as the Loan/events;
- retrying any mutation with the same idempotency semantics must not duplicate formal state;
- same idempotency key with changed semantic payload is `CONFLICT`.

## Recommended actions

Keep actions concrete and thin:

- `createLoanRequest`
- `createLoanInvite`
- `previewInvite`
- `acceptInviteRequest`
- `verifyFirstCounterparty`

Small helpers are acceptable for token hashing / CREATE_LOAN payload narrowing / deterministic event construction. Do not build a generic workflow engine.

## Repository changes likely needed

R3 intentionally kept the contract small. R5 may add narrowly-scoped transaction capabilities if required, for example:

- find Loan by `createdFromRequestId` inside transaction;
- bind/update request counterparty in transaction;
- claim/finalize invite atomically;

Add only capabilities demanded by the use case.

## Minimum tests

### Request creation
- first-contact borrower unknown;
- first-contact lender unknown;
- proposer must be the known party;
- invalid both-known/both-unknown combinations rejected for this action;
- retry same idempotency input returns same request;
- same key/different semantic payload conflicts.

### Invite
- only proposer may create invite for own first-contact CREATE_LOAN request;
- preview does not mutate state;
- expired/revoked/claimed token cannot be accepted;
- proposer cannot claim own invite;
- invite claim under concurrent attempts has one winner.

### Acceptance
- acceptance moves PENDING -> PENDING_INITIATOR_VERIFY;
- binds runtime-authenticated claimant as the formerly unknown party/counterparty;
- no Loan/events exist yet;
- repeated acceptance by same successful claimant is safe or returns a stable already-completed result; never duplicates state.

### Verification / atomic apply
- only original proposer may verify;
- claimant identity is visible to proposer before verification;
- creates one Loan with correct lender/borrower IDs;
- creates genesis sequences 1 and 2;
- principal event uses initial amount;
- rate event uses the agreed RateSnapshot;
- both sourceRequestId values equal request ID;
- request becomes APPLIED;
- invite is finalized;
- forced failure after any partial staged mutation rolls back all business state;
- concurrent verification creates only one Loan/event pair.

## Non-goals

Do not yet implement:

- home summary;
- repayment;
- principal add/rate/correction after Loan creation;
- UI redesign;
- CPI fetching;
- SDK migration away from the currently locked CloudBase SDK.
