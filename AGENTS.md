# AGENTS.md

Engineering guardrails for `Jazz0006/FamilyLedger`.

This file exists to keep the codebase small, understandable, and safe as the product moves from the original family-only model to the v2 general bilateral ledger model.

These rules are intentionally lightweight. Follow them where they protect money semantics, permissions, state transitions, data integrity, or maintainability. Do not introduce enterprise-style ceremony just to satisfy a pattern.

## 1. Source-of-truth hierarchy

When documents disagree, use this order:

1. `docs/来往账_产品规划设计书_v2.0.md` — product/business meaning.
2. `docs/DATA_MODEL_V2.md` — target domain and persistence shape.
3. `AGENTS.md` — engineering boundaries and implementation discipline.
4. `CLAUDE.md` / `README.md` — repository guidance and overview.
5. Existing production code — current implementation, which may still contain v1.1 assumptions during migration.

The v1.1 family specification is historical reference only and must not drive new functionality.

If a proposed code change changes money semantics, permissions, confirmation rules, or authoritative data shape, update the relevant authoritative document in the same change.

## 2. Core product invariants

These are hard constraints.

- A `Loan` is one shared bilateral debt record, not two synchronized per-user copies.
- A user has no global borrower/lender role. Borrower/lender roles belong to a specific `Loan`.
- Formal ledger changes require mutual consent. The initiator's request is their consent; the counterparty confirmation completes normal bilateral consent.
- `loan_events` are append-only. Do not update or delete formal events to fix mistakes; append a correction event.
- Balances, principal, interest, and summaries are derived from formal events. Cached values must never become a second source of truth.
- Money is stored as integer `Fen`. Never use binary floating-point money values.
- Interest and balance math has one source of truth in `packages/calc`.
- Client code never has final write authority for ledger state.
- Server identity and authorization are based on trusted runtime identity such as WeChat `OPENID`, not client-supplied user IDs.
- Confirmation that both changes a request state and creates formal ledger events must be atomic or transactionally equivalent.
- Retried write requests must be idempotent and must not silently reuse an idempotency key for a different payload.

## 3. Architecture and dependency direction

Use this simple dependency direction:

```text
Mini Program UI
      ↓
Application Actions / Use Cases
      ↓
Domain + packages/calc
      ↓
Repository Interfaces
      ↓
CloudBase Repository / Infrastructure
```

Do not create reverse dependencies.

### `packages/shared`

Owns shared domain types, enums, identifiers, small pure domain helpers, and stable cross-layer contracts.

It must not depend on:

- CloudBase SDKs;
- WeChat UI APIs;
- page/controller code;
- persistence implementations.

### `packages/calc`

Owns deterministic money, interest, date-period, and event-to-balance calculations.

It must remain:

- pure where practical;
- independent of CloudBase;
- independent of UI;
- independent of authorization rules.

Do not duplicate money formulas in cloud actions or the mini program.

### `cloud/functions/ledger/src/actions`

Owns application use cases and orchestration.

Prefer one action module per business use case, for example:

```text
createLoanRequest.ts
acceptLoanRequest.ts
createRepaymentRequest.ts
acceptRepaymentRequest.ts
rejectRequest.ts
cancelRequest.ts
getHomeSummary.ts
```

Actions may coordinate domain rules, repositories, transactions, and audit logging. They should not contain duplicated calculation engines or raw UI logic.

### Repository interface

The repository interface defines persistence capabilities required by use cases.

Keep it practical. Add a repository method when a real use case needs it; do not build generic abstraction layers for hypothetical databases.

### CloudBase repository / infrastructure

CloudBase-specific SDK calls belong in infrastructure/persistence code.

Infrastructure may decide how data is fetched or transacted. It must not decide business rules such as who is allowed to confirm a repayment.

### Mini Program

The mini program owns display, input, navigation, and invoking server APIs.

It must not decide authoritative permissions, formal request transitions, ledger event creation, or money truth.

## 4. Domain ownership before implementation

Before adding a meaningful feature, decide where each responsibility belongs.

For example, a repayment feature normally separates into:

```text
State/permission rules     → domain/shared + action
Money effect               → packages/calc
Use-case orchestration     → action
Persistence/transaction    → repository + CloudBase repository
Presentation               → mini program page/component
```

Do not keep adding code to the file that happens to be easiest to edit.

If an existing module would gain a third clearly independent responsibility, review its ownership before expanding it.

## 5. File-size and complexity guardrails

File size is a warning signal, not the root problem. Responsibility count is more important than line count.

Preferred working sizes:

- ordinary source file: usually under ~300 lines;
- page/controller/orchestration module: usually under ~400 lines;
- one action/use-case module: usually under ~200 lines;
- one function: usually under ~60 lines.

Review thresholds:

- over ~500 lines: pause and review whether responsibilities should be split;
- over ~800 lines: do not add another independent feature without first justifying or reducing the module;
- function over ~100 lines: review whether validation, calculation, persistence, or mapping responsibilities should be extracted.

These are not CI-enforced hard limits.

Reasonable exceptions include generated files, schemas, fixture/test vectors, declarative lookup tables, or files whose contents are naturally cohesive despite their length.

Never split a cohesive module into meaningless tiny files just to satisfy a line count.

## 6. Keep routers thin

A cloud-function entry point/router may map an action name to a use-case function, normalize the response envelope, and handle top-level errors.

It should not accumulate business implementations.

Bad direction:

```text
index.ts
  routing
  validation
  authorization
  calculations
  request state machine
  CloudBase queries
  audit logic
  response formatting
```

Preferred direction:

```text
index.ts             → thin dispatch
src/actions/*        → use cases
src/domain/*         → rules where useful
src/data/repo.ts     → persistence contract
src/data/cloudbase-* → CloudBase implementation
packages/calc        → money math
```

## 7. State machines are server-owned

Request lifecycle rules must be explicit and tested.

Typical states include:

```text
PENDING
PENDING_INITIATOR_VERIFY
APPLIED
REJECTED
CANCELLED
EXPIRED
```

The server decides which transitions are legal.

The UI may hide or show buttons based on server data, but client state must never be the authority for whether a transition is valid.

## 8. Transaction boundaries

Keep transaction rules simple.

Use a transaction when one user action must either fully succeed or leave no partial formal state, especially:

- accepting a request and creating formal `loan_events`;
- first-contact acceptance/finalization where identity binding and ledger creation must stay consistent;
- consuming a one-time invite where a partial bind would leave an unusable account.

Do not introduce distributed transaction frameworks, queues, sagas, or event buses unless a demonstrated production need appears.

## 9. Error semantics

Use a small, consistent set of machine-readable application error codes rather than inventing new free-form strings per action.

Prefer codes such as:

```text
VALIDATION_ERROR
NOT_FOUND
FORBIDDEN
CONFLICT
INVALID_STATE
ALREADY_APPLIED
ALREADY_BOUND
INVITE_INVALID
INVITE_EXPIRED
```

Add a new code only when callers genuinely need to distinguish the condition.

## 10. Testing policy

Do not chase a coverage percentage for its own sake.

Tests are mandatory for code that can materially affect:

- money calculations;
- interest periods/rates;
- authorization and participant checks;
- request state transitions;
- idempotency;
- transaction/concurrency-sensitive flows;
- event-to-balance reconstruction.

Prefer tests-first for those areas.

UI styling and trivial rendering do not require exhaustive unit tests.

Use pure unit tests and `MemoryRepo`-style tests for most behavior. Use CloudBase integration testing for behavior that depends on real runtime identity, indexes, transactions, or CloudBase semantics.

## 11. Privacy and authorization boundary

A user may see detailed loan information only for loans in which that user is a participant, unless a future product specification explicitly introduces another permission model.

Do not expose another pair of users' debt relationship through summaries, contact lists, search, logs, or convenience queries.

Queries should be designed from the current authenticated user outward, not from unrestricted client-supplied user IDs inward.

## 12. Audit vs tamper evidence

For v2, the required baseline is:

- append-only business event APIs;
- server-authoritative writes;
- audit logs for sensitive actions;
- correction by new events rather than editing history.

Do not describe this as blockchain-level immutability.

Hash chains, signatures, external anchoring, or stronger tamper-evidence may be added later, but must not complicate the current MVP without a concrete requirement.

## 13. Rate model

Do not hard-code 5% as a permanent business rule.

The model should be able to represent a rate source such as CPI plus the concrete rate value agreed by both parties.

Historical ledger results must use the confirmed rate snapshot for the applicable period. A later CPI update must not silently rewrite old debt calculations.

Automatic CPI retrieval and annual adjustment are lower priority and should remain outside the core architecture until implemented deliberately.

## 14. Schema evolution

Keep schema/version metadata where useful, but do not build a general migration framework now.

During the v1.1 → v2 migration:

- prefer a clean one-time migration over permanent dual-model compatibility;
- do not spread long-lived `if (familyId)` / legacy-role branches through production code;
- back up real data before any destructive migration;
- keep historical v1.1 documentation as reference rather than making production code support both models indefinitely.

## 15. Deliberate non-goals for engineering complexity

Do not introduce these without a demonstrated need:

- microservices;
- CQRS/event-sourcing frameworks beyond the simple append-only ledger already used;
- message queues;
- complex dependency-injection containers;
- generic multi-database repository frameworks;
- mandatory abstractions around every function;
- strict line-count CI gates;
- arbitrary test-coverage targets;
- premature multi-currency, KYC, enterprise-account, or multi-country architecture.

Choose the simplest design that preserves the product invariants.

## 16. Refactor-before-expand rule

When a feature would make an already mixed module own another independent responsibility, refactor ownership first, then add the feature.

Do not refactor unrelated code merely because a file is being touched.

The goal is controlled evolution, not continuous architecture churn.

## 17. Definition of a healthy change

A normal change should make it easy to answer:

1. Which product rule or use case is changing?
2. Which module owns that responsibility?
3. Are money/permission/state semantics covered by tests when relevant?
4. Does the change preserve append-only ledger and server-authoritative writes?
5. Did we avoid creating a second source of truth?
6. Did we keep CloudBase details out of domain/calculation code?
7. Did we avoid adding an unrelated responsibility to an already broad file?

If those answers are clear, do not add more process simply for process's sake.
