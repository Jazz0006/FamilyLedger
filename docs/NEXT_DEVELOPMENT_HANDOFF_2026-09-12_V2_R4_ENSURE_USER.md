# Next Development Handoff — v2 R4 ensureUser

**Date:** 2026-09-12  
**Repository:** `Jazz0006/FamilyLedger`  
**Base checkpoint:** R3 persistence foundation  
**Next milestone:** `R4 — ensureUser`

## Objective

Restore the first real v2 server action: an ordinary WeChat user can enter the Mini Program and be resolved to exactly one v2 `User` using trusted runtime OPENID.

This replaces the obsolete v1 `bootstrapAdmin` / bind-first model.

## Required behavior

`ensureUser` must:

1. obtain identity only from `ActionContext.openid`, which ultimately comes from CloudBase runtime context;
2. query `users.openid`;
3. return the existing User when found;
4. if absent, create one ordinary User with server timestamps;
5. rely on unique `users.openid` + `createUserIfOpenidFree` for concurrent idempotency;
6. return the created/existing User to the client.

## Input

Keep input minimal. Suggested shape:

```ts
interface EnsureUserInput {
  displayName?: string;
  avatarUrl?: string | null;
}
```

Do not accept OPENID, role, familyId or admin flags from the client.

If no display name is supplied, use a neutral product default such as `微信用户`; do not recreate hard-coded owner/admin identity.

## Action context

Reintroduce a small v2 `ActionContext` containing only:

```ts
interface ActionContext {
  repo: LedgerRepo;
  openid: string;
  now: number;
}
```

No `requireAdmin`, global roles, family context or binding status.

## Router

Replace the temporary R1 all-actions-disabled boundary only for:

```text
ensureUser
```

All other product actions may continue returning `INVALID_STATE` / unknown action until their own milestone.

`setupCollections` must not be revived as a normal client-facing action.

## Tests

At minimum:

- new OPENID creates one ordinary User;
- retry returns same User id;
- concurrent same-OPENID calls result in one User identity;
- existing User is returned without overwriting profile unexpectedly;
- client cannot supply another OPENID to impersonate a User;
- no `role` / `familyId` exists in returned domain object.

MemoryRepo tests should be sufficient for pure action behavior. Real CloudBase unique-index concurrency should later be checked in integration tests.

## Non-goals

Do not yet implement:

- home summary;
- create Loan request;
- invite generation/claiming;
- profile editing semantics beyond initial optional display name/avatar;
- UI redesign;
- legacy account binding.

## Completion gate

R4 is complete when a new authenticated OPENID can safely and idempotently become a normal v2 User and the router exposes that one action without restoring any v1 family/admin concept.
