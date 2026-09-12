# Miniprogram (WeChat native)

The active Mini Program UI is now the v2 bilateral-ledger client. The old v1.1 family/admin pages have been removed rather than retained behind compatibility routes.

## Current pages

- `pages/home` — bidirectional summary: 别人欠我的 / 我欠别人的 / 待我确认, plus active Loan lists.
- `pages/create` — create a new Loan proposal in either direction. Existing counterparties use an in-app request; first contacts use a one-time invite.
- `pages/detail` — participant-only Loan summary plus the complete paginated formal event stream.
- `pages/confirm` — accept/reject normal pending changes, accept known-counterparty CREATE_LOAN, or verify/cancel a first-contact claimant.
- `pages/bind` — preview and accept a first-contact bearer invite. Acceptance binds the claimant but does not make the Loan formal until the initiator verifies them.

There is no administrator page, family-wide privileged view, global borrower/lender role, or admin-only ledger write path.

## Client/server boundary

The Mini Program owns display, input, navigation, proposal initiation, and consent gestures. It does **not** own authoritative identity, permissions, request transitions, formal event creation, or balance/interest truth.

- Runtime OPENID is resolved only by the cloud function.
- UI-facing user data uses `UserDisplayProfile`; OPENID is not returned as display data.
- Money sent to the server is integer Fen. `utils/input.js` parses Yuan input without binary-float money conversion.
- `@family-ledger/calc` remains the only balance/interest engine; the Mini Program only renders server-calculated summaries.
- Growing event/request reads are paginated; pages that need a complete set follow `nextCursor` rather than assuming one response is complete.

## First-contact invite security

The raw invite token is a 32-byte bearer credential generated with WeChat's cryptographically secure `wx.getRandomValues`. The client converts it to base64url and reuses the same token when retrying an unchanged submission. The server persists only the SHA-256 token hash.

The request idempotency key and invite raw token are also retained across network-error retries of an unchanged form. Editing any business field clears them so the next submit becomes a new logical mutation.

## Current cutover boundary

R12B provides a usable v2 shell for bootstrap, home/read flows, new Loan creation, first-contact invite acceptance, pending consent, claimant verification/cancellation, and Loan/event detail.

The server already supports Loan-change proposals such as repayment, principal add, rate change, correction, and close, but dedicated mutation forms from the Loan detail page are **not yet implemented in the Mini Program**. Do not interpret the current detail page as the final feature-complete UI.

## Validation

Repository CI runs:

```bash
npm ci
npm run build
npm run typecheck
npm test
```

Those checks validate TypeScript/domain/application code. They do not replace real WeChat/CloudBase two-account testing for runtime OPENID, sharing, transactions, database indexes, and concurrent user flows.
