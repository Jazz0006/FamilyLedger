/**
 * CloudBase collection (table) names. Single source of truth so cloud
 * functions and any admin tooling never disagree on a string literal.
 *
 * See spec §16. Write-access rules are enforced server-side, not here.
 */
export const Collections = {
  /** WeChat identity <-> family role binding. Restricted writes. */
  USERS: 'users',
  /** Loan relationship metadata (one lender <-> borrower). Restricted writes. */
  LOAN_ACCOUNTS: 'loan_accounts',
  /** Interest rate / term versions. Append-mostly. */
  LOAN_TERMS: 'loan_terms',
  /** Change proposals awaiting dual confirmation. State-machine updates. */
  CHANGE_REQUESTS: 'change_requests',
  /** Immutable ledger. NEVER update or delete (spec Rule C, §16). */
  LOAN_EVENTS: 'loan_events',
  /** One-time first-bind invite tokens (hash only). Invalidated after use. */
  INVITE_TOKENS: 'invite_tokens',
  /** Append-only management / security audit trail. */
  AUDIT_LOGS: 'audit_logs',
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];
