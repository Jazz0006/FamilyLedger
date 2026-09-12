# V2 R12D CloudBase / Two-Account Hardening Runbook — 2026-09-12

## Purpose

R12D is the boundary between a green repository implementation and a product that has actually been proven against Tencent CloudBase + real WeChat identities.

Workspace CI and `MemoryRepo` are necessary but **not sufficient**. R12D is not complete until the checks below are executed in a disposable CloudBase development environment with two real WeChat test accounts.

Use fresh v2 test data. Do not reinterpret v1 family/admin development data as v2 confirmed history.

---

## 1. Local prerequisites

Required:

```bash
node --version        # Node 20+ for repository tooling
tcb --version         # CloudBase CLI v3+
```

Install/login if needed:

```bash
npm i -g @cloudbase/cli
tcb login
```

Create local configuration:

```bash
cp .env.example .env.local
```

Set only the development environment ID in `.env.local`:

```text
CLOUDBASE_ENV_ID=<development-env-id>
```

`.env.local` is Git-ignored. Never commit SecretId, SecretKey, session tokens, API keys, OPENIDs, bearer invite tokens, or production environment identifiers.

---

## 2. Repository gate before touching CloudBase

From repository root:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run bundle -w @family-ledger/cloud-ledger
```

Expected deployment bundle:

```text
cloud/functions/ledger/dist-bundle/index.js
cloud/functions/ledger/dist-bundle/package.json
```

`cloudbaserc.json` is the deploy contract:

```text
function: ledger
handler: index.main
runtime: Nodejs20.19
source dir: ./cloud/functions/ledger/dist-bundle
```

Do not deploy `cloud/functions/ledger/src` directly.

---

## 3. Provision core collections

Core runtime collections:

```text
users
loans
ledger_requests
loan_events
invite_tokens
audit_logs
```

`rate_references` is optional/future and must not be created merely to satisfy the core ledger.

Create any missing core collection using the CloudBase development console or the official manager SDK `createCollectionIfNotExists` API.

Do not recreate legacy v1 collections as v2 dependencies:

```text
loan_accounts
loan_terms
change_requests
```

---

## 4. Generate the authoritative index plan

The single source of truth is:

```text
cloud/functions/ledger/src/data/schema-contract.ts
```

Generate CloudBase CLI commands from that contract:

```bash
npm run schema:plan -w @family-ledger/cloud-ledger -- --env <development-env-id>
```

Machine-readable form:

```bash
npm run schema:plan -w @family-ledger/cloud-ledger -- --env <development-env-id> --json
```

The generated `tcb db nosql execute` commands use Mongo-style `createIndexes` payloads. Execute them only against the disposable development environment.

After provisioning, verify in CloudBase collection/index management that every index has the exact:

- name;
- ordered field list;
- ASC/DESC direction;
- uniqueness flag.

Required index names:

```text
users
  uniq_openid                         UNIQUE

loans
  uniq_created_from_request           UNIQUE
  lender_status_created_cursor
  borrower_status_created_cursor

ledger_requests
  uniq_idempotency_key                UNIQUE
  counterparty_status_created_cursor
  proposer_status_created_cursor
  loan_created_cursor

loan_events
  uniq_event_idempotency_key          UNIQUE
  uniq_loan_sequence                  UNIQUE
  source_request_lookup               NON-UNIQUE

invite_tokens
  uniq_token_hash                     UNIQUE
```

`source_request_lookup` must remain non-unique because one CREATE_LOAN request creates two genesis events.

---

## 5. Deploy the ledger function

After the bundle exists and `.env.local` identifies the development environment:

```bash
tcb deploy --yes
```

Verify in CloudBase:

```text
name       ledger
handler    index.main
runtime    Nodejs20.19
timeout    20s
memory     256MB
```

Do not treat successful upload as proof that database/runtime behavior is correct. Continue with the tests below.

---

## 6. Runtime identity smoke test

Use two real WeChat accounts, called A and B below.

For each account:

1. open the development Mini Program;
2. allow `ensureUser` to run;
3. confirm exactly one `users` document exists for that runtime OPENID;
4. reopen/retry and confirm no duplicate User is created;
5. confirm Mini Program responses/display objects do not expose OPENID.

Pass condition: runtime identity comes only from the CloudBase/WeChat context; client-supplied identity-like fields never change the authenticated User.

---

## 7. First-contact CREATE_LOAN — A lends to B

A:

1. 新建一笔往来;
2. select 新联系人;
3. select 我借给别人;
4. enter principal/rate/date;
5. generate/share invite.

B:

1. open the shared invite;
2. verify proposer/amount/rate/date preview;
3. accept invite.

Before A verifies claimant:

- request must be `PENDING_INITIATOR_VERIFY`;
- no Loan may exist;
- no genesis formal events may exist.

A:

1. open 待确认与已发起;
2. verify B's displayed identity;
3. confirm claimant.

After confirmation, atomically expect:

- exactly one ACTIVE Loan;
- A = lender;
- B = borrower;
- exactly one initial `PRINCIPAL_ADD` event;
- exactly one initial `RATE_CHANGE` event;
- both events share the same `sourceRequestId`;
- sequences are 1 and 2;
- request is `APPLIED`.

Retry final confirmation and verify no duplicate Loan/event is created.

---

## 8. Reverse first-contact direction — B lends to A

Repeat first contact with B selecting 我借给别人 and A accepting.

Pass condition: the same physical User can be borrower in one Loan and lender in another. There is no global user role.

---

## 9. Wrong claimant escape path

Create another first-contact invite from A.

Have an unintended test account C claim it before B.

Expected:

- only C is bound to the request;
- B cannot also claim it;
- A can see C in `PENDING_INITIATOR_VERIFY`;
- A can cancel instead of verifying;
- cancellation creates no Loan and no formal events.

---

## 10. Concurrent invite-claim race

Against one ACTIVE invite, cause B and C to accept as close together as practical.

Pass condition:

- exactly one claimant wins;
- the losing claimant receives an error;
- request has one counterparty;
- invite has one `claimedByUserId`;
- no Loan exists before proposer verification.

Capture CloudBase logs and final documents for the test record.

---

## 11. Known-counterparty subsequent Loan

After A and B have one established Loan:

1. A creates another Loan using 已有往来人;
2. select either debt direction;
3. B sees the pending CREATE_LOAN;
4. B accepts.

Expected:

- no bearer invite is required;
- relationship validation succeeds only because A/B already share a Loan;
- one new Loan + two genesis events are applied atomically;
- arbitrary unrelated User C cannot be targeted merely by knowing a user ID.

---

## 12. Loan mutation consent matrix

On an ACTIVE A/B Loan, test both sides as proposer where applicable.

### Principal add

- proposer creates request;
- counterparty sees amount/date/note;
- accept creates exactly one `PRINCIPAL_ADD` event;
- reject creates no event;
- proposer cancellation creates no event.

### Principal repay

- accept creates exactly one `PRINCIPAL_REPAY` event;
- principal cannot become negative at any historical date;
- retry does not duplicate the event.

### Rate change

- accept creates exactly one `RATE_CHANGE` event;
- same-effective-date winner follows formal event sequence.

### Principal Correction

- UI target points to an existing principal-affecting formal event;
- counterparty confirmation shows the target event date/type/original value;
- accepted Correction appends one compensating event;
- target bytes remain unchanged.

### Rate Correction

- only the current same-day rate winner is accepted as a target;
- correction inherits target effective date;
- old target event remains unchanged.

### Close

- non-zero principal cannot close;
- after principal reaches zero, close can be proposed;
- counterparty confirms settlement boundary;
- one `LOAN_CLOSED` event snapshots residual accrued interest;
- Loan becomes CLOSED atomically with request/event;
- current projection at/after close is zero;
- pre-close historical projection remains reconstructable;
- later mutation requests cannot apply.

---

## 13. Proposer pending visibility / cancellation

For a normal still-PENDING proposal:

- proposer sees it under `我发起的 · 等待对方确认`;
- counterparty sees it under `待我处理`;
- proposer cancellation removes it from both actionable paths;
- cancellation appends no formal event.

For a first-contact PENDING request whose invite has not yet been claimed:

- proposer can still see the request;
- display must not invent a counterparty identity;
- losing the plaintext invite token does not justify storing plaintext token server-side; cancel/recreate instead.

---

## 14. Transaction rollback checks

Real CloudBase must prove the assumptions already covered by MemoryRepo.

At minimum verify in the development environment that a failed formal application does not leave a partial set such as:

```text
Loan created but request not APPLIED
only one of the two CREATE_LOAN genesis events
Loan CLOSED without LOAN_CLOSED event
formal event appended while request remains PENDING
nextEventSequence advanced without the corresponding committed event set
```

If a deterministic failure-injection harness is added, it must be development-only and must never be routable from the production Mini Program API.

---

## 15. Duplicate-key / uniqueness behavior

Exercise the real database constraints and capture actual SDK error shapes for:

- duplicate `users.openid`;
- duplicate request `idempotencyKey`;
- duplicate Loan `createdFromRequestId`;
- duplicate event `idempotencyKey`;
- duplicate `(loanId, sequence)`;
- duplicate invite `tokenHash`.

Confirm `CloudBaseRepo.isDuplicateKeyError` recognizes the actual duplicate forms needed by product retry paths. Do not broaden duplicate detection based on guesses.

---

## 16. Device/share regression

On actual WeChat devices/accounts verify:

- invite share opens `pages/bind/bind` with the correct token;
- preview works before account bootstrap;
- acceptance works after bootstrap;
- reopening a claimed/expired/cancelled invite fails safely;
- navigating home → detail → proposal → confirmation refreshes correctly;
- both lender and borrower projections show the same formal history;
- closed Loan does not expose normal mutation entry points.

---

## 17. Security/dependency review

The current runtime adapter remains isolated behind `LedgerRepo` and still uses the locked `@cloudbase/node-sdk` path. Do not mix an SDK migration into R12D merely to silence an audit report.

Before release:

1. record `npm audit` findings and exact dependency chains;
2. distinguish runtime-reachable issues from build/dev-only issues;
3. patch compatible direct/transitive versions where safe;
4. evaluate a CloudBase SDK migration separately if a high/critical issue is runtime-relevant and cannot be safely patched in place;
5. never run `npm audit fix --force` blindly on the release branch.

---

## Exit criteria

R12D is complete only when all of the following are recorded with a real development environment:

- required collections present;
- required index definitions exactly match `schema-contract.ts`;
- ledger function deployed with intended runtime/handler;
- two-account identity flow passes;
- both debt directions pass;
- first-contact and known-counterparty flows pass;
- concurrent invite claim has one winner;
- formal mutation consent matrix passes;
- rollback/uniqueness assumptions match CloudBase behavior;
- device share path passes;
- no v1 family/admin runtime dependency is required;
- dependency/security findings have an explicit disposition.

Until then, PR #12 remains Draft and production cutover remains blocked.
