# v2 R5 Progress — CREATE_LOAN First-Contact Vertical Slice

**Date:** 2026-09-12  
**Branch:** `codex/v2-r5-create-loan`  
**Milestone:** R5 — first formal v2 ledger write path

## Completed flow

```text
createLoanRequest
→ createLoanInvite
→ previewInvite
→ acceptInviteRequest
→ PENDING_INITIATOR_VERIFY
→ verifyFirstCounterparty
→ atomic Loan + genesis events + request APPLIED
```

## Implemented actions

- `createLoanRequest`
  - authenticated proposer only;
  - supports proposer-as-lender or proposer-as-borrower first contact;
  - exactly one initially unknown party;
  - integer Fen principal;
  - explicit agreed `RateSnapshot`;
  - canonical request fingerprint;
  - same idempotency key + same proposal returns the same request;
  - same key + changed proposal conflicts.

- `createLoanInvite`
  - proposer-only;
  - requires a pending first-contact CREATE_LOAN request;
  - caller supplies a 32-byte base64url CSPRNG bearer token;
  - only SHA-256 token hash is persisted;
  - retrying with the same raw token returns the same invite credential state;
  - raw token must never be persisted by the server.

- `previewInvite`
  - read-only;
  - validates token status/expiry and request state;
  - exposes proposal facts needed for informed acceptance;
  - never binds identity or mutates the ledger.

- `acceptInviteRequest`
  - identity comes from runtime OPENID -> ordinary v2 User;
  - proposer cannot claim their own invite;
  - invite claim and request counterparty binding are one transaction;
  - request moves `PENDING -> PENDING_INITIATOR_VERIFY`;
  - no Loan or formal event exists yet;
  - concurrent claim has one winner;
  - same successful claimant may retry safely.

- `verifyFirstCounterparty`
  - proposer-only;
  - verifies the already-bound claimant identity;
  - one transaction creates the Loan and exactly two genesis events;
  - genesis sequence 1 = `PRINCIPAL_ADD`;
  - genesis sequence 2 = `RATE_CHANGE`;
  - both events share `sourceRequestId=request._id` but have distinct deterministic event idempotency keys;
  - request receives `loanId`, moves to APPLIED, and gets `resolvedAt` in the same transaction;
  - concurrent/retried verification converges on the already-applied Loan.

## Important semantic decisions

### requestFingerprint is the original proposal fingerprint

`requestFingerprint` is intentionally immutable after request creation. First-contact acceptance later resolves the previously unknown `counterpartyUserId` and corresponding borrower/lender ID, but does not recompute the proposal fingerprint.

This preserves request-creation idempotency: retrying the original proposal after identity binding still compares against the exact original semantic proposal.

### Invite credential retry

For invite issuance, the raw bearer token is the credential-level retry identity. A real client must generate it with a cryptographically secure RNG and reuse the same raw token if the create-invite call is retried.

Supplying a different raw token means issuing a different credential for the same still-pending request. Only the first successful claimant can move the request out of PENDING; all other credentials then become non-actionable because request state is rechecked transactionally.

### Invite final state

Invite acceptance sets the credential to `CLAIMED`. Final initiator verification does not need to mutate it again; `CLAIMED` is the terminal successful credential state. The formal Loan still does not exist until initiator verification succeeds.

## Tests authored

Coverage includes:

- both first-contact directions;
- request idempotency and changed-payload conflict;
- preview is read-only;
- self-claim forbidden;
- expiry;
- concurrent invite claim single winner;
- same token / same claimant retry;
- no Loan before initiator verification;
- proposer-only final verification;
- exact two-event genesis history;
- shared sourceRequestId with distinct event keys;
- verification retry/concurrency convergence;
- forced second-event failure rolls back Loan/events/request apply state.

## Validation performed in this environment

- strict TypeScript minimal-environment compile of the new R5 production modules: **PASS**;
- compiled-JS runtime smoke of `request → invite → claim → verify → Loan + 2 events`: **PASS**;
- R4→R5 branch diff audit: no v1 family/admin persistence path reintroduced and no R3 Repo expansion retained.

Full dependency-backed workspace validation is still required before merge:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Real CloudBase integration remains required for transaction conflict behavior, unique indexes, duplicate-key shapes, and two-WeChat-account verification.

## Next

R6 builds the read side over the same shared Loan/event truth:

- `getLoan`;
- `listLoans`;
- `listLoanEvents`;
- `listPendingRequests`;
- `getHomeSummary`;
- lender sees the same Loan as receivable;
- borrower sees it as payable;
- no duplicated per-user balance records.
