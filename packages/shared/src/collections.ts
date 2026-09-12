/**
 * v2 CloudBase collection names. Client code never has authoritative write
 * access to these collections; writes go through server actions.
 */
export const Collections = {
  USERS: 'users',
  LOANS: 'loans',
  LEDGER_REQUESTS: 'ledger_requests',
  LOAN_EVENTS: 'loan_events',
  INVITE_TOKENS: 'invite_tokens',
  AUDIT_LOGS: 'audit_logs',
  RATE_REFERENCES: 'rate_references',
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];
