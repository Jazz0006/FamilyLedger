import { createHash } from 'node:crypto';
import type {
  LedgerRequestPayload,
  LedgerRequestType,
  LoanId,
  UserId,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';

export interface RequestFingerprintInput {
  type: LedgerRequestType;
  loanId: LoanId | null;
  proposerUserId: UserId;
  counterpartyUserId: UserId | null;
  payload: LedgerRequestPayload;
  requiresInitiatorVerify: boolean;
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | {
  [key: string]: CanonicalJson;
};

function canonicalize(value: unknown): CanonicalJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Fingerprint input contains a non-finite number',
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        continue;
      }
      result[key] = canonicalize(child);
    }
    return result;
  }

  throw new AppError(
    ErrorCode.VALIDATION_ERROR,
    `Unsupported fingerprint value type: ${typeof value}`,
  );
}

export function canonicalRequestSemanticJson(
  input: RequestFingerprintInput,
): string {
  const semanticOnly = {
    type: input.type,
    loanId: input.loanId,
    proposerUserId: input.proposerUserId,
    counterpartyUserId: input.counterpartyUserId,
    requiresInitiatorVerify: input.requiresInitiatorVerify,
    payload: input.payload,
  };
  return JSON.stringify(canonicalize(semanticOnly));
}

export function computeRequestFingerprint(
  input: RequestFingerprintInput,
): string {
  return createHash('sha256')
    .update(canonicalRequestSemanticJson(input), 'utf8')
    .digest('hex');
}

export function assertMatchingRequestFingerprint(params: {
  storedFingerprint: string;
  incomingFingerprint: string;
}): void {
  if (params.storedFingerprint !== params.incomingFingerprint) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Idempotency key was reused with a different semantic request',
    );
  }
}
