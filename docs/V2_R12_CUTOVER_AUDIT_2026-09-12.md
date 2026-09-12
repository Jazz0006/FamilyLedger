# V2 R12 — Cutover / UI / CloudBase Audit

**Date:** 2026-09-12  
**Branch:** `codex/v2-r12-cutover-audit`  
**Base:** R11 close-loan checkpoint / Draft PR #11

## 1. Audit conclusion

The v2 server/domain core is substantially complete through R11, but the repository is **not yet a coherent end-to-end product**.

The main cutover gap is now the client and the UI-facing server contract:

- the active Cloud Function router is v2;
- `packages/shared`, `packages/calc`, Repo/CloudBase and formal mutation flows are v2;
- the Mini Program page tree is still almost entirely v1.1 family/admin UI;
- several old pages call actions that no longer exist;
- some v2 server reads expose IDs but not enough human-readable counterparty information for a safe consent UI;
- known-counterparty CREATE_LOAN from product spec §7.2 is not yet implemented;
- schema/index requirements are encoded in `schema-contract.ts`, but no repository provisioning/verification workflow currently completes the real CloudBase cutover.

Therefore R12 should **not** patch the v1 pages in place. It should close the missing UI-facing server contracts, then replace the page layer in reviewable slices.

---

## 2. Mini Program inventory

### KEEP

#### `miniprogram/utils/api.js`

Generic thin `wx.cloud.callFunction` wrapper around the `ledger` router. It has no family/admin authority semantics.

#### `miniprogram/utils/money.js`

Display-only Fen formatter. It deliberately does not compute balances and remains consistent with `packages/calc` as the money source of truth.

#### `miniprogram/app.wxss`

Generic styling shell unless a later visual redesign makes replacement simpler.

#### `miniprogram/project.config.json`

Project tooling configuration; no product-domain ownership.

#### `miniprogram/sitemap.json`

Keep structurally, update only if the new page set requires it.

### REWRITE

#### `miniprogram/app.js`

Cloud initialization is reusable, but the v1 product comment/name is stale. Keep initialization, rewrite product-facing wording if needed.

#### `miniprogram/app.json`

Current registered pages are:

```text
home
detail
confirm
bind
admin-family
admin-account
admin-invites
```

and the title is `家庭借款账本`.

R12 must replace this with the v2 page graph and title `来往账` (or the final chosen product name).

#### `pages/home/*`

The current implementation expects the v1 response:

```text
summary.mine
summary.family
summary.familyTotalDueFen
```

but the v2 server returns:

```text
receivable
payable
pendingRequestCount
```

Rewrite fully for the bilateral home model.

#### `pages/detail/*`

Current code calls non-existent `getMyLedger` and models one user's private family account history.

Rewrite as a specific `Loan` view using:

```text
getLoan
listLoanEvents
```

and v2 proposal actions.

#### `pages/confirm/*`

Current code calls non-existent v1 actions:

```text
getPendingRequests
confirmChange
```

Rewrite around:

```text
listPendingRequests
acceptRequest
rejectRequest
cancelRequest
verifyFirstCounterparty
```

with type-specific consent copy.

#### `pages/bind/*`

Current code is a family-account bind flow and calls removed `bindInvite`.

Rewrite as the first-contact request invite page using:

```text
previewInvite({ rawToken })
acceptInviteRequest({ rawToken, displayName, avatarUrl? })
```

The page must explain whether the claimant will become BORROWER or LENDER and must not imply a global account role.

### DELETE

The following pages are pure v1.1 concepts and should not survive the cutover:

```text
pages/admin-family/*
pages/admin-account/*
pages/admin-invites/*
```

Reasons:

- fixed product administrator does not exist in v2;
- family-wide privileged overview does not exist;
- direct admin principal writes are forbidden by v2 mutual-consent rules;
- invites belong to a specific CREATE_LOAN request, not family membership.

Git history is sufficient preservation.

---

## 3. Confirmed old-client API breakage

The current client cannot work against the v2 router as written.

Examples:

| Old page | Old expectation | v2 reality |
|---|---|---|
| home | `summary.mine/family` | `receivable/payable/pendingRequestCount` |
| detail | `getMyLedger` | action does not exist |
| confirm | `getPendingRequests` | `listPendingRequests` |
| confirm | `confirmChange` | `acceptRequest` / `rejectRequest` |
| bind | `bindInvite` | `acceptInviteRequest` |
| admin-family | `getFamilyOverview` | intentionally removed |
| admin-account | `getAccountLedger`, unilateral writes | intentionally removed |
| admin-invites | `createInvite({displayName})` | invite is request-bound `createLoanInvite` |

There is no value in restoring compatibility aliases for these calls.

---

## 4. UI-facing server contract blockers

These should be solved before building the final v2 pages.

### 4.1 Counterparty display identity

Current `LoanView` exposes:

```text
counterpartyUserId
```

but not the counterparty display name/avatar.

Likewise a pending request carries User IDs but the client has no normal API to resolve those IDs to display profiles.

This blocks a safe human consent screen because users should see **who** they are accepting/rejecting, not an opaque database ID.

Recommended narrow change:

```ts
interface UserDisplayProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}
```

Enrich participant-authorized read results with only the profile required for display. Do not expose OPENID.

### 4.2 Invite preview lacks proposer display profile

`previewInvite` currently returns `proposerUserId` but not the proposer's display name/avatar.

The invitee needs a human-readable statement such as:

> Alice 邀请你确认：Alice 借给你 ¥10,000

or the reverse direction.

Add proposer display profile to preview without changing bearer-token authorization semantics.

### 4.3 Initiator verification lacks claimant display profile

After invite claim, the proposer must verify the claimant. `listPendingRequests` exposes the bound `counterpartyUserId`, but not a display profile.

The verification UI therefore cannot meaningfully present “确认这就是我邀请的人”.

Enrich the actionable-request read model with the other participant's display profile.

### 4.4 Known-counterparty CREATE_LOAN is missing

Product spec §7.2 allows a user to select an existing/known counterparty and send a normal pending CREATE_LOAN request without bearer invite + initiator re-verification.

The current server only implements first-contact:

```text
createLoanRequest
→ createLoanInvite
→ claim
→ initiator verify
```

There is currently no action equivalent to:

```text
createKnownCounterpartyLoanRequest
```

R12 must add this before the “最近往来人 / 已有交易对象” UI can be truthful.

Recommended semantics:

- proposer supplies an existing counterparty `userId` selected from a server-authorized list;
- server verifies that the selected user is a legitimate known counterparty for the proposer;
- request has both borrower/lender IDs bound from creation;
- `requiresInitiatorVerify=false`;
- counterparty accepts through normal `acceptRequest`;
- application atomically creates Loan + initial principal + initial rate + request APPLIED;
- no invite token required.

Do not accept arbitrary client user IDs as proof of a valid relationship.

### 4.5 Known-counterparty discovery is missing

There is no current v2 action to list recent/known counterparties.

Add a narrow read model derived from Loans the current user already participates in. Do not expose a global user directory or WeChat friend list.

Suggested result:

```ts
interface KnownCounterparty {
  user: UserDisplayProfile;
  lastLoanAt: number;
}
```

Deduplicate by user ID and order by recent shared Loan activity.

---

## 5. Client security/utility blockers

### Idempotency keys

All write UI actions need a client-generated idempotency key that remains stable across a retry of the same user action.

Add one Mini Program utility and generate the key **once per logical submission**, not once per retry callback.

### Invite raw token

`createLoanInvite` requires a 32-byte base64url raw token and stores only its SHA-256 hash server-side.

Before implementing the invite creator UI, verify and use a cryptographically secure Mini Program random API. Do not use `Math.random()` for bearer invite credentials.

### Money input

UI may parse a decimal Yuan input into integer Fen, but must never calculate balances/interest locally. Input conversion needs strict two-decimal validation and safe-integer checks.

---

## 6. CloudBase / deployment audit

### KEEP

- `cloudbaserc.json` structure and single `ledger` function model;
- CloudBase runtime OPENID authority boundary;
- `cloud/functions/ledger/scripts/bundle.mjs`;
- `LedgerRepo` / `CloudBaseRepo` abstraction;
- `schema-contract.ts` as the code-level index contract.

### REWRITE / VERIFY

#### `cloud/README.md`

Persistence/index material is useful, but milestone text still says the router is disabled and R4/R5 are future work. Rewrite for the completed R11 server.

#### Real collection/index provisioning

`V2_REQUIRED_INDEXES` defines the required indexes, but the repository currently has no active v2 setup/provisioning script equivalent to the deleted v1 `setupCollections` flow.

R12 must provide either:

1. an explicit, version-controlled CloudBase setup/verification script; or
2. a precise manual provisioning checklist plus a verification command.

Do not recreate the v1 collection setup code.

Required collections:

```text
users
loans
ledger_requests
loan_events
invite_tokens
audit_logs
```

Optional/future:

```text
rate_references
```

Required indexes remain those in `src/data/schema-contract.ts`; especially:

```text
users.openid                         UNIQUE
loans.createdFromRequestId           UNIQUE
ledger_requests.idempotencyKey       UNIQUE
loan_events.idempotencyKey           UNIQUE
loan_events.(loanId, sequence)        UNIQUE
loan_events.sourceRequestId          NON-UNIQUE
invite_tokens.tokenHash              UNIQUE
```

### Runtime/deployment verification

Before release, verify the configured CloudBase Node runtime, bundle output, dependency installation behavior and transaction/index behavior in the actual development environment. Do not infer production readiness from MemoryRepo tests.

---

## 7. Documentation audit

### REWRITE CURRENT GUIDANCE

#### `README.md`

Domain overview is correct, but rewrite-status and milestone list still describe R1-era router disablement and the old R1–R10 sequence.

#### `CLAUDE.md`

Severely stale operational status: it still says R1 is current and the router is deliberately disabled. Rewrite to R11 complete / R12 cutover.

#### `cloud/README.md`

Same stale R3-era milestone status; keep technical persistence material but refresh operational state.

#### `miniprogram/README.md`

Correctly labels pages as legacy, but still says the router is disabled during R1. Rewrite when the first v2 UI slice lands.

### KEEP AS HISTORY

Milestone handoff/progress documents R1–R11 remain useful historical audit records and should not be rewritten to pretend they were written later.

`docs/家庭借款账本_产品规划设计书_v1.1.md` may remain explicitly historical because the authoritative docs already demote it. It must not be linked as current guidance.

Existing screenshots (`ApplicationConfirm.png`, `MainInterface.png`, etc.) may remain as historical/reference artifacts until the final UI replaces them; do not treat them as v2 UX authority.

---

## 8. R12 implementation slices

### R12A — UI-facing server contract

Before final page work:

1. add participant display profiles to Loan/request/invite reads;
2. add known-counterparty discovery;
3. add known-counterparty CREATE_LOAN proposal/application path;
4. test privacy: only counterparties reachable through the caller's own Loans are discoverable;
5. keep OPENID private.

### R12B — v2 client shell + read-only UI

Replace page graph with:

```text
home
loan-detail
pending-requests
```

plus required loading/error/empty states.

Implement:

- `ensureUser` bootstrap;
- bidirectional home totals;
- active/closed Loan lists;
- Loan summary and formal event history;
- pending request list with readable counterparties.

Delete the three `admin-*` pages in this slice.

### R12C — create/invite/consent UI

Add:

```text
new-loan
invite-preview / invite-accept
initiator-verify
request-detail / consent
```

Support both:

- first-contact invite flow;
- known-counterparty direct pending flow.

### R12D — mutation forms

Add Loan-scoped actions:

```text
repayment
principal add
rate change
principal/rate correction
close loan
```

All screens submit proposals only; no client direct formal write.

### R12E — CloudBase hardening

- provision/verify collections and indexes;
- deploy real `ledger` bundle;
- two real WeChat identities;
- first-contact invite race;
- duplicate request retries;
- concurrent accepts;
- close/change race;
- transaction rollback fault checks where practical;
- >100-event pagination reconstruction.

### R12F — final cleanup

- delete remaining v1 page/runtime residue;
- refresh README / CLAUDE / cloud / miniprogram guidance;
- verify no active client calls removed v1 action names;
- final product regression.

---

## 9. Immediate next step

Implement **R12A — UI-facing server contract** before rewriting final pages.

The minimum first checkpoint should add display-profile-safe reads plus known-counterparty discovery. Then implement known-counterparty CREATE_LOAN using the same transaction/event rules as first-contact CREATE_LOAN.

Do not start by adding compatibility aliases for `getMyLedger`, `confirmChange`, `bindInvite`, `getFamilyOverview`, or any other v1 action.
