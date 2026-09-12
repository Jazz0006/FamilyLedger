# Miniprogram (WeChat native)

## Rewrite status

The files currently under `miniprogram/pages/` are the old v1.1 family/admin UI and are **temporary reference only** during the v2 clean rewrite.

Do not extend their assumptions:

- no fixed administrator;
- no family-wide privileged view;
- no global borrower/lender role;
- no admin-only direct ledger writes;
- no v1 bind/bootstrap flow.

They will be replaced when the v2 server flows reach the UI milestones. Until then the active source of truth for product behavior is `docs/来往账_产品规划设计书_v2.0.md`, not the existing page structure.

## Target v2 responsibilities

The Mini Program will own display, input, navigation, proposal initiation, and consent actions. It must not own authoritative identity, permissions, request transitions, formal event creation, or money truth.

Target user-facing flows include:

- normal user entry / account bootstrap;
- bidirectional home summary: 别人欠我的 / 我欠别人的 / 待我确认;
- create record: 我借给别人 / 我向别人借;
- first-contact invite acceptance and initiator verification;
- Loan details and formal event history;
- repayment / principal-add / rate-change / correction requests;
- accept / reject / cancel pending requests.

`@family-ledger/calc` remains the single source of truth for money math. Do not reimplement interest formulas in page code.

## Development note

During R1 the cloud router is deliberately disabled while the v2 server foundation is rebuilt, so the legacy pages are not expected to form a working end-to-end product on the rewrite branch.
