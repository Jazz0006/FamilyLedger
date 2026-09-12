# Ledger scripts

These scripts support build/deployment validation for the v2 `ledger` CloudBase function.

## `bundle.mjs`

Builds the TypeScript entry into:

```text
dist-bundle/index.js
dist-bundle/package.json
```

Run:

```bash
npm run bundle -w @family-ledger/cloud-ledger
```

`cloudbaserc.json` deploys this generated directory, not `src/`.

## `schema-plan.mjs`

Reads the compiled authoritative schema contract and generates required collection/index provisioning information.

```bash
npm run schema:plan -w @family-ledger/cloud-ledger -- --env <development-env-id>
```

JSON form:

```bash
npm run schema:plan -w @family-ledger/cloud-ledger -- --env <development-env-id> --json
```

The script itself does not authenticate to CloudBase and does not mutate resources.

## `deployment-contract.mjs`

CI-safe check for repository deployment assumptions:

- dynamic, non-committed CloudBase environment ID;
- ledger deploy directory;
- handler;
- Node runtime;
- generated bundle files;
- external CloudBase SDK dependency declaration.

Run after bundling:

```bash
npm run deployment:check -w @family-ledger/cloud-ledger
```

## `cloudbase-smoke.mjs`

**Mutating R12D development-environment integration test. Never run casually.**

It uses the real `CloudBaseRepo` and real application actions with synthetic identities to verify:

- concurrent unique-OPENID convergence;
- first-contact request/invite/claim/verify against real CloudBase;
- one Loan + two genesis events;
- idempotent final verification retry;
- forced transaction rollback of event append;
- rollback of `nextEventSequence` reservation;
- rollback of request update.

It does **not** prove real WeChat OPENID/runtime context or device sharing. Those remain separate two-account Mini Program gates.

Prerequisites:

1. schema/index provisioning completed in a disposable CloudBase development environment;
2. `npm ci` completed;
3. admin authentication available only in the current shell via either:
   - `CLOUDBASE_APIKEY`, or
   - `TENCENTCLOUD_SECRETID` + `TENCENTCLOUD_SECRETKEY`;
4. explicit mutation guard set to the same development environment ID.

Example shell shape (placeholders only):

```bash
export CLOUDBASE_ENV_ID='<development-env-id>'
export R12D_ALLOW_MUTATION="$CLOUDBASE_ENV_ID"
# export CLOUDBASE_APIKEY='<temporary/server credential>'
# OR export TENCENTCLOUD_SECRETID=... and TENCENTCLOUD_SECRETKEY=...

npm run r12d:smoke -w @family-ledger/cloud-ledger
```

The script never prints credentials or synthetic OPENIDs. By default it deletes the documents it created. Set `R12D_KEEP_DATA=1` only when deliberately preserving one failed/successful run for manual inspection; clean those records afterwards.

For the full release gate see `docs/V2_R12D_CLOUDBASE_HARDENING_RUNBOOK_2026-09-12.md`.
