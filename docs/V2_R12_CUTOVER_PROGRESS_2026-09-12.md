# V2 R12 Cutover Progress — 2026-09-12

## Status

R12 audit, R12A UI-facing server contract, R12B active Mini Program cutover, and R12C Loan mutation proposal UI are implemented on `codex/v2-r12-cutover-audit`.

R12 is **not production-complete**. R12D real CloudBase / real WeChat two-account hardening remains a mandatory production gate.

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

## R12B completed

### Active Mini Program pages

`app.json` registers only:

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
- exposes actionable pending count;
- keeps a permanent “待确认与已发起” entry so proposer-side pending requests remain discoverable.

### Create

Supports:

- 我借给别人;
- 我向别人借;
- first-contact invite path;
- existing-counterparty direct request path.

Money input is parsed from Yuan text to integer Fen without binary-float money arithmetic. Annual percentage input is normalized into an annual decimal-string snapshot.

For first contact, the raw bearer token is generated client-side from WeChat cryptographically secure randomness, encoded base64url, and sent to the server; the server persists only SHA-256.

For unchanged network-error retries, the form preserves both the request idempotency key and invite raw token. Editing business fields clears that retry identity and starts a new logical mutation.

### Detail baseline

- participant-safe `getLoan` summary;
- follows `listLoanEvents.nextCursor` through the complete formal history;
- renders principal/rate/Correction/Close events;
- never computes authoritative balance/interest client-side.

### Confirm baseline

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

## R12C completed

### Loan-detail proposal panel

The active Loan detail page now exposes proposal-only UI for:

```text
PRINCIPAL_REPAY
PRINCIPAL_ADD
RATE_CHANGE
CORRECTION (PRINCIPAL)
CORRECTION (RATE)
CLOSE_LOAN
```

The client does not apply formal accounting effects. Every form creates a `LedgerRequest`; the server remains authoritative for permission, state transition, history reconstruction, event validation and formal append.

### Retry semantics

Each unchanged mutation form preserves one idempotency key across network retry. Editing a business field clears that key so a changed proposal becomes a new logical mutation.

### Correction UX

Principal Correction target options are derived only from principal-affecting formal events.

Rate Correction target options are reduced to the current highest-sequence rate event for each effective date. The client does not submit a Correction effective date; the server derives it from the selected target event.

The counterparty confirmation view loads the shared formal event history and shows the exact target event context before consent, including date/type/original value.

### Close UX

The Mini Program only enables the close proposal surface when the current projection has zero principal and no future formal event blocks the settlement boundary. Its date picker is constrained to the legal client-visible range.

These are convenience checks only. Final close validity is always re-evaluated server-side inside the application transaction.

The UI explicitly describes Close as a mutually confirmed settlement boundary, not an in-app payment.

### Proposer pending-request visibility

Added the read path:

```text
listProposedRequests
```

Backed by the existing `proposerUserId + status + createdAt + _id` request index shape.

It returns only authenticated-user proposals still in `PENDING`, with a safe counterparty display profile when one is already bound. An unclaimed first-contact request remains displayable with no counterparty profile.

The confirmation center now separates:

```text
待我处理
我发起的 · 等待对方确认
```

The proposer can cancel their own still-PENDING requests. Regression coverage verifies that cancellation removes the request from this list.

## CI checkpoint

GitHub Actions runs:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

R12C code checkpoint `57d6626d2fabfbda07f007a985cfcb1245a9e83f` completed CI run #73 successfully.

The authoritative roadmap update head `dc3924b60945afbeaebe5041b19c010b1878ed92` also completed CI run #74 successfully.

The install step has previously reported dependency audit findings. They have intentionally not been force-fixed; R12D should identify the affected dependency path before deciding whether a CloudBase SDK/dependency upgrade belongs in this release.

## R12D — required before production

Still required against a real CloudBase/WeChat development environment:

- provision and verify all required v2 collections/indexes from `schema-contract.ts`;
- verify runtime OPENID identity behavior;
- verify actual CloudBase transaction commit/rollback semantics;
- verify duplicate-key/error shapes against repository assumptions;
- run concurrent invite-claim and request-application races;
- validate Mini Program share/invite paths on actual devices;
- run real two-account first-contact flows in both debt directions;
- run real two-account known-counterparty and mutation-confirmation flows;
- run Close/Correction device-level regression;
- perform final obsolete setup/runtime residue audit;
- review dependency/security findings without blindly applying breaking `npm audit fix --force` changes.

Workspace CI and MemoryRepo tests do not substitute for R12D.
