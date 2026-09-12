import {
  LedgerRequestType,
  RateSource,
  type CreateLoanPayload,
  type LedgerRequest,
  type RateSnapshot,
  type UserId,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';

const MAX_NOTE_LENGTH = 500;
const MAX_REFERENCE_LABEL_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface FirstContactCreateLoanInput {
  unknownPartyRole: 'BORROWER' | 'LENDER';
  initialPrincipalFen: number;
  rate: RateSnapshot;
  proposedEffectiveDate: string;
  note: string | null;
  idempotencyKey: string;
}

function validation(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    validation(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertIsoDate(value: unknown, field = 'proposedEffectiveDate'): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    validation(`${field} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    validation(`${field} is not a valid calendar date`);
  }
  return value;
}

export function normalizeRateSnapshot(value: unknown): RateSnapshot {
  const raw = requireObject(value, 'rate');
  if (
    typeof raw.annualEffectiveRate !== 'string' ||
    !DECIMAL.test(raw.annualEffectiveRate)
  ) {
    validation('rate.annualEffectiveRate must be a decimal string');
  }
  const numericRate = Number(raw.annualEffectiveRate);
  if (!Number.isFinite(numericRate) || numericRate <= -1) {
    validation('rate.annualEffectiveRate must be greater than -1');
  }
  if (
    raw.rateSource !== RateSource.MANUAL &&
    raw.rateSource !== RateSource.CPI_REFERENCE
  ) {
    validation('rate.rateSource is invalid');
  }

  let rateReferenceYear: number | null = null;
  if (raw.rateReferenceYear !== undefined && raw.rateReferenceYear !== null) {
    if (!Number.isSafeInteger(raw.rateReferenceYear)) {
      validation('rate.rateReferenceYear must be an integer or null');
    }
    rateReferenceYear = raw.rateReferenceYear as number;
  }

  let rateReferenceLabel: string | null = null;
  if (raw.rateReferenceLabel !== undefined && raw.rateReferenceLabel !== null) {
    if (typeof raw.rateReferenceLabel !== 'string') {
      validation('rate.rateReferenceLabel must be a string or null');
    }
    const trimmed = raw.rateReferenceLabel.trim();
    if (trimmed.length > MAX_REFERENCE_LABEL_LENGTH) {
      validation(
        `rate.rateReferenceLabel must be at most ${MAX_REFERENCE_LABEL_LENGTH} characters`,
      );
    }
    rateReferenceLabel = trimmed.length > 0 ? trimmed : null;
  }

  return {
    annualEffectiveRate: raw.annualEffectiveRate,
    rateSource: raw.rateSource,
    rateReferenceYear,
    rateReferenceLabel,
  };
}

export function normalizeFirstContactCreateLoanInput(
  input: unknown,
): FirstContactCreateLoanInput {
  const raw = requireObject(input, 'createLoanRequest payload');
  if (
    raw.unknownPartyRole !== 'BORROWER' &&
    raw.unknownPartyRole !== 'LENDER'
  ) {
    validation('unknownPartyRole must be BORROWER or LENDER');
  }
  if (!Number.isSafeInteger(raw.initialPrincipalFen) || Number(raw.initialPrincipalFen) <= 0) {
    validation('initialPrincipalFen must be a positive safe integer Fen value');
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== 'string') validation('note must be a string or null');
    const trimmed = raw.note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) {
      validation(`note must be at most ${MAX_NOTE_LENGTH} characters`);
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  if (typeof raw.idempotencyKey !== 'string') {
    validation('idempotencyKey must be a string');
  }
  const idempotencyKey = raw.idempotencyKey.trim();
  if (
    idempotencyKey.length === 0 ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    validation(
      `idempotencyKey must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }

  return {
    unknownPartyRole: raw.unknownPartyRole,
    initialPrincipalFen: raw.initialPrincipalFen as number,
    rate: normalizeRateSnapshot(raw.rate),
    proposedEffectiveDate: assertIsoDate(raw.proposedEffectiveDate),
    note,
    idempotencyKey,
  };
}

/**
 * Validate the post-claim first-contact shape. Unlike R2 creation validation,
 * both Loan parties are known here and counterpartyUserId is bound.
 */
export function assertBoundFirstContactCreateLoanRequest(
  request: LedgerRequest,
): asserts request is LedgerRequest & {
  payload: CreateLoanPayload & {
    borrowerUserId: UserId;
    lenderUserId: UserId;
    unknownPartyRole: 'BORROWER' | 'LENDER';
  };
  counterpartyUserId: UserId;
} {
  if (request.type !== LedgerRequestType.CREATE_LOAN) {
    validation('Request is not CREATE_LOAN');
  }
  if (!request.requiresInitiatorVerify) {
    validation('Request is not a first-contact CREATE_LOAN');
  }
  if (request.counterpartyUserId == null) {
    validation('First-contact request has no bound counterparty');
  }
  if (request.counterpartyUserId === request.proposerUserId) {
    validation('Counterparty cannot equal proposer');
  }

  const payload = request.payload as CreateLoanPayload;
  if (payload.borrowerUserId == null || payload.lenderUserId == null) {
    validation('Both Loan parties must be bound after invite acceptance');
  }
  if (payload.borrowerUserId === payload.lenderUserId) {
    validation('Borrower and lender must be different users');
  }
  if (
    payload.unknownPartyRole !== 'BORROWER' &&
    payload.unknownPartyRole !== 'LENDER'
  ) {
    validation('Bound first-contact request must retain its unknown party role');
  }

  if (payload.unknownPartyRole === 'BORROWER') {
    if (
      payload.lenderUserId !== request.proposerUserId ||
      payload.borrowerUserId !== request.counterpartyUserId
    ) {
      validation('Bound borrower/lender identities do not match the accepted invite');
    }
  } else if (
    payload.borrowerUserId !== request.proposerUserId ||
    payload.lenderUserId !== request.counterpartyUserId
  ) {
    validation('Bound borrower/lender identities do not match the accepted invite');
  }

  if (!Number.isSafeInteger(payload.initialPrincipalFen) || payload.initialPrincipalFen <= 0) {
    validation('initialPrincipalFen must remain a positive safe integer');
  }
  assertIsoDate(payload.proposedEffectiveDate);
  normalizeRateSnapshot(payload.rate);
}

export function bindFirstContactCounterparty(
  request: LedgerRequest,
  claimantUserId: UserId,
  now: number,
): LedgerRequest {
  if (request.type !== LedgerRequestType.CREATE_LOAN) {
    validation('Request is not CREATE_LOAN');
  }
  const payload = request.payload as CreateLoanPayload;
  if (
    payload.unknownPartyRole !== 'BORROWER' &&
    payload.unknownPartyRole !== 'LENDER'
  ) {
    validation('First-contact request has no valid unknown party role');
  }

  const boundPayload: CreateLoanPayload = {
    ...payload,
    borrowerUserId:
      payload.unknownPartyRole === 'BORROWER'
        ? claimantUserId
        : payload.borrowerUserId,
    lenderUserId:
      payload.unknownPartyRole === 'LENDER'
        ? claimantUserId
        : payload.lenderUserId,
  };

  return {
    ...request,
    counterpartyUserId: claimantUserId,
    payload: boundPayload,
    updatedAt: now,
  };
}
