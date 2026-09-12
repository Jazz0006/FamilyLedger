import { Collections } from '@family-ledger/shared';

export type IndexOrder = 'asc' | 'desc';

export interface IndexField {
  field: string;
  order: IndexOrder;
}

export interface IndexSpec {
  collection: string;
  name: string;
  fields: readonly IndexField[];
  unique: boolean;
  purpose: string;
}

export const V2_REQUIRED_INDEXES: readonly IndexSpec[] = [
  {
    collection: Collections.USERS,
    name: 'uniq_openid',
    fields: [{ field: 'openid', order: 'asc' }],
    unique: true,
    purpose: 'one WeChat OPENID maps to at most one User',
  },
  {
    collection: Collections.LOANS,
    name: 'uniq_created_from_request',
    fields: [{ field: 'createdFromRequestId', order: 'asc' }],
    unique: true,
    purpose: 'one CREATE_LOAN request creates at most one Loan',
  },
  {
    collection: Collections.LOANS,
    name: 'lender_status_created_cursor',
    fields: [
      { field: 'lenderUserId', order: 'asc' },
      { field: 'status', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
      { field: '_id', order: 'desc' },
    ],
    unique: false,
    purpose: 'stable cursor pagination of receivable Loans',
  },
  {
    collection: Collections.LOANS,
    name: 'borrower_status_created_cursor',
    fields: [
      { field: 'borrowerUserId', order: 'asc' },
      { field: 'status', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
      { field: '_id', order: 'desc' },
    ],
    unique: false,
    purpose: 'stable cursor pagination of payable Loans',
  },
  {
    collection: Collections.LEDGER_REQUESTS,
    name: 'uniq_idempotency_key',
    fields: [{ field: 'idempotencyKey', order: 'asc' }],
    unique: true,
    purpose: 'request retry idempotency',
  },
  {
    collection: Collections.LEDGER_REQUESTS,
    name: 'counterparty_status_created_cursor',
    fields: [
      { field: 'counterpartyUserId', order: 'asc' },
      { field: 'status', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
      { field: '_id', order: 'desc' },
    ],
    unique: false,
    purpose: 'pending requests awaiting counterparty response',
  },
  {
    collection: Collections.LEDGER_REQUESTS,
    name: 'proposer_status_created_cursor',
    fields: [
      { field: 'proposerUserId', order: 'asc' },
      { field: 'status', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
      { field: '_id', order: 'desc' },
    ],
    unique: false,
    purpose: 'first-contact requests awaiting initiator verification',
  },
  {
    collection: Collections.LEDGER_REQUESTS,
    name: 'loan_created_cursor',
    fields: [
      { field: 'loanId', order: 'asc' },
      { field: 'createdAt', order: 'desc' },
      { field: '_id', order: 'desc' },
    ],
    unique: false,
    purpose: 'future paginated request history for one Loan',
  },
  {
    collection: Collections.LOAN_EVENTS,
    name: 'uniq_event_idempotency_key',
    fields: [{ field: 'idempotencyKey', order: 'asc' }],
    unique: true,
    purpose: 'formal event retry idempotency',
  },
  {
    collection: Collections.LOAN_EVENTS,
    name: 'uniq_loan_sequence',
    fields: [
      { field: 'loanId', order: 'asc' },
      { field: 'sequence', order: 'asc' },
    ],
    unique: true,
    purpose: 'stable gap-free event ordering within one Loan',
  },
  {
    collection: Collections.LOAN_EVENTS,
    name: 'source_request_lookup',
    fields: [{ field: 'sourceRequestId', order: 'asc' }],
    unique: false,
    purpose: 'lookup all formal events created by one request',
  },
  {
    collection: Collections.INVITE_TOKENS,
    name: 'uniq_token_hash',
    fields: [{ field: 'tokenHash', order: 'asc' }],
    unique: true,
    purpose: 'one bearer invite token maps to one invite record',
  },
] as const;
