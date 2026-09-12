import { createHash } from 'node:crypto';
import {
  LedgerRequestType,
  type CloseLoanPayload,
  type CorrectionPayload,
  type CreateLoanPayload,
  type LedgerRequestPayload,
  type LedgerRequestType as LedgerRequestTypeValue,
  type LoanId,
  type PrincipalAddPayload,
  type PrincipalRepayPayload,
  type RateChangePayload,
  type RateSnapshot,
  type UserId,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';

export interface RequestFingerprintInput {
  type: LedgerRequestTypeValue;
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
      if (child === undefined) continue;
      result[key] = canonicalize(child);
    }
    return result;
  }

  throw new AppError(
    ErrorCode.VALIDATION_ERROR,
    `Unsupported fingerprint value type: ${typeof value}`,
  );
}

function semanticRate(rate: RateSnapshot): object {
  return {
    annualEffectiveRate: rate.annualEffectiveRate,
    rateSource: rate.rateSource,
    rateReferenceYear: rate.rateReferenceYear ?? null,
    rateReferenceLabel: rate.rateReferenceLabel ?? null,
  };
}

function semanticPayload(
  type: LedgerRequestTypeValue,
  payload: LedgerRequestPayload,
): object {
  switch (type) {
    case LedgerRequestType.CREATE_LOAN: {
      const value = payload as CreateLoanPayload;
      return {
        borrowerUserId: value.borrowerUserId,
        lenderUserId: value.lenderUserId,
        unknownPartyRole: value.unknownPartyRole,
        initialPrincipalFen: value.initialPrincipalFen,
        rate: semanticRate(value.rate),
        proposedEffectiveDate: value.proposedEffectiveDate,
        note: value.note ?? null,
      };
    }
    case LedgerRequestType.PRINCIPAL_ADD: {
      const value = payload as PrincipalAddPayload;
      return {
        amountFen: value.amountFen,
        proposedEffectiveDate: value.proposedEffectiveDate,
        note: value.note ?? null,
      };
    }
    case LedgerRequestType.PRINCIPAL_REPAY: {
      const value = payload as PrincipalRepayPayload;
      return {
        amountFen: value.amountFen,
        proposedEffectiveDate: value.proposedEffectiveDate,
        note: value.note ?? null,
      };
    }
    case LedgerRequestType.RATE_CHANGE: {
      const value = payload as RateChangePayload;
      return {
        rate: semanticRate(value.rate),
        proposedEffectiveDate: value.proposedEffectiveDate,
        note: value.note ?? null,
      };
    }
    case LedgerRequestType.CORRECTION: {
      const value = payload as CorrectionPayload;
      return value.correctionKind === 'PRINCIPAL'
        ? {
            correctionKind: value.correctionKind,
            targetEventId: value.targetEventId,
            principalDeltaFen: value.principalDeltaFen,
            reason: value.reason ?? null,
          }
        : {
            correctionKind: value.correctionKind,
            targetEventId: value.targetEventId,
            replacementRate: semanticRate(value.replacementRate),
            reason: value.reason ?? null,
          };
    }
    case LedgerRequestType.CLOSE_LOAN: {
      const value = payload as CloseLoanPayload;
      return {
        proposedEffectiveDate: value.proposedEffectiveDate,
        note: value.note ?? null,
      };
    }
  }
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
    payload: semanticPayload(input.type, input.payload),
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
