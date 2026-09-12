# v2 R4 Progress — ensureUser

**Date:** 2026-09-12  
**Branch:** `codex/v2-r4-ensure-user`  
**Milestone:** R4 — normal User bootstrap

## Completed

- added v2 `ActionContext` carrying only `repo`, trusted runtime `openid`, and trusted server `now`;
- implemented `ensureUser` as the first restored v2 server action;
- existing OPENID returns the existing normal `User` unchanged;
- first call creates a normal v2 `User` through `createUserIfOpenidFree`;
- concurrent/retried first calls converge through the repository's unique-OPENID semantics;
- client payload never proves identity and cannot supply authoritative `openid`, role, family, or admin state;
- router now exposes only `ensureUser`; other product actions remain unavailable until their v2 implementations exist.

## Explicitly absent

R4 does not introduce:

- admin/bootstrap semantics;
- `UserRole` or `familyId`;
- automatic Loan creation;
- invite creation/claiming;
- profile mutation on every login;
- any formal `loan_events` write.

## Validation coverage

The focused unit tests cover:

- new user creation;
- existing user retry;
- concurrent first calls returning one logical User;
- existing profile not being silently overwritten by bootstrap;
- client-supplied legacy/identity-looking fields having no authority.

Full workspace build/test still requires a normal dependency-enabled checkout before merge.

## Next milestone

R5 builds the first formal ledger vertical slice: CREATE_LOAN request + first-contact invite + invitee acceptance + initiator verification + one atomic Loan/genesis-event application.
