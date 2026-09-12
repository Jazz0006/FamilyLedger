# V2 R12 Cutover Progress — 2026-09-12

## Status

R12 audit, R12A UI-facing server contract, and the first R12B Mini Program cutover slice are implemented on `codex/v2-r12-cutover-audit`.

R12 is **not production-complete**. R12C detail mutation proposal UI and R12D real CloudBase/two-account hardening remain.

## R12 audit result

The backend had already been rewritten around the bilateral v2 model, but the Mini Program was still an entire v1 family/admin client. The correct cutover strategy was therefore rewrite/delete, not a v1 compatibility adapter.

Audit record: `docs/V2_R12_CUTOVER_AUDIT_2026-09-12.md`.

## R12A completed

### Safe UI identity projection

Added `UserDisplayProfile` so relationship-facing UI data contains only:

```text
userId
displayName
avatarUrl
```

OPENID remains server-internal and is not used as display data.

### Known counterparties

Added `listKnownCounterparties`, derived from Loans in which the authenticated User already participated. There is no public user directory and knowing an arbitrary internal user ID does not make that person a valid known counterparty.

### Subsequent CREATE_LOAN

Added:

```text
createKnownLoanRequest
acceptKnownLoanRequest
```

This supports a new Loan with an already-known counterparty without repeating the bearer-invite identity ceremony. It still uses bilateral propose/confirm semantics and the same atomic genesis writer as first-contact CREATE_LOAN.

### First-contact cancellation

The original proposer may cancel after an invitee claims the request but before final verification. This is the explicit “wrong person claimed the invite” escape path and creates no Loan/formal event.

Regression coverage verifies that the claimant cannot perform that proposer-only cancellation and that verification cannot proceed after cancellation.

## R12B completed so far

### Active Mini Program pages

`app.json` now registers only:

```text
pages/home/home
pages/create/create
pages/detail/detail
pages/confirm/confirm
pages/bind/bind
```

All former `admin-*` page files were physically removed.

### Home

- calls `ensureUser`;
- renders “别人欠我的 / 我欠别人的” totals;
- lists active Loans in both directions;
- exposes pending count;
- navigates to create/detail/confirm.

### Create

Supports:

- 我借给别人;
- 我向别人借;
- first-contact invite path;
- existing-counterparty direct request path.

Money input is parsed from Yuan text to integer Fen without binary-float money arithmetic. Annual percentage input is normalized into an annual decimal-string snapshot.

For first contact, the raw bearer token is generated client-side from WeChat cryptographically secure randomness, encoded base64url, and sent to the server; the server persists only SHA-256.

For unchanged network-error retries, the form preserves both the request idempotency key and invite raw token. Editing business fields clears that retry identity and starts a new logical mutation.

### Detail

- participant-safe `getLoan` summary;
- follows `listLoanEvents.nextCursor` through the complete formal history;
- renders principal/rate/Correction/Close events;
- never computes authoritative balance/interest client-side.

### Confirm

Explicitly distinguishes:

```text
VERIFY          → verifyFirstCounterparty
ACCEPT_CREATE   → acceptKnownLoanRequest
ACCEPT_CHANGE   → acceptRequest
```

Normal pending requests can be rejected. A first-contact initiator verification can be cancelled when the claimant is not the intended person.

### Bind

- bearer-token invite preview;
- human-readable proposer / principal / rate / effective date;
- invite acceptance binds runtime-authenticated claimant identity;
- clearly states that acceptance alone does not create the formal Loan.

## CI

A repository GitHub Actions workflow now runs:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

A successful full-workspace checkpoint was recorded at `ce52a3621d36bc7d8ea9b8f2f33572e9e35543b9`, which already included the R12B client code, secure-token/retry behavior and first-contact cancellation regression. Later documentation commits still require their own current-head CI completion before that exact head is described as green.

The install step currently reports dependency audit findings. They have not been force-fixed because the affected dependency chain must be identified before deciding whether a CloudBase SDK upgrade is appropriate.

## Deliberately not complete yet

### R12C — next

The server supports the following proposals, but the Loan detail UI does not yet expose dedicated forms:

- PRINCIPAL_REPAY;
- PRINCIPAL_ADD;
- RATE_CHANGE;
- CORRECTION;
- CLOSE_LOAN.

R12C should add those proposal surfaces without moving any authority into the client.

### R12D — required before production

Still required against a real CloudBase/WeChat development environment:

- collection/index provisioning verification;
- runtime OPENID behavior;
- actual transaction commit/rollback semantics;
- duplicate-key/error shape verification;
- concurrent invite claim/application races;
- real share path behavior;
- two-account first-contact and known-counterparty flows in both debt directions;
- device-level end-to-end regression.

Workspace CI/MemoryRepo tests do not substitute for these checks.
