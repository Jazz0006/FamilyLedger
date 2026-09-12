import {
  LedgerRequestStatus,
  type LedgerRequest,
  type LedgerRequestStatus as LedgerRequestStatusValue,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';

const TERMINAL_STATUSES = new Set<LedgerRequestStatusValue>([
  LedgerRequestStatus.APPLIED,
  LedgerRequestStatus.REJECTED,
  LedgerRequestStatus.CANCELLED,
  LedgerRequestStatus.EXPIRED,
]);

export function isTerminalRequestStatus(
  status: LedgerRequestStatusValue,
): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function allowedNextRequestStatuses(
  status: LedgerRequestStatusValue,
  requiresInitiatorVerify: boolean,
): readonly LedgerRequestStatusValue[] {
  if (status === LedgerRequestStatus.PENDING) {
    return requiresInitiatorVerify
      ? [
          LedgerRequestStatus.PENDING_INITIATOR_VERIFY,
          LedgerRequestStatus.REJECTED,
          LedgerRequestStatus.CANCELLED,
          LedgerRequestStatus.EXPIRED,
        ]
      : [
          LedgerRequestStatus.APPLIED,
          LedgerRequestStatus.REJECTED,
          LedgerRequestStatus.CANCELLED,
          LedgerRequestStatus.EXPIRED,
        ];
  }

  if (status === LedgerRequestStatus.PENDING_INITIATOR_VERIFY) {
    return requiresInitiatorVerify
      ? [
          LedgerRequestStatus.APPLIED,
          LedgerRequestStatus.CANCELLED,
          LedgerRequestStatus.EXPIRED,
        ]
      : [];
  }

  return [];
}

export function canTransitionRequestStatus(params: {
  from: LedgerRequestStatusValue;
  to: LedgerRequestStatusValue;
  requiresInitiatorVerify: boolean;
}): boolean {
  return allowedNextRequestStatuses(
    params.from,
    params.requiresInitiatorVerify,
  ).includes(params.to);
}

export function assertRequestStatusTransition(params: {
  from: LedgerRequestStatusValue;
  to: LedgerRequestStatusValue;
  requiresInitiatorVerify: boolean;
}): void {
  if (!canTransitionRequestStatus(params)) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      `Illegal request transition ${params.from} -> ${params.to}`,
    );
  }
}

export function assertLedgerRequestTransition(
  request: Pick<LedgerRequest, 'status' | 'requiresInitiatorVerify'>,
  to: LedgerRequestStatusValue,
): void {
  assertRequestStatusTransition({
    from: request.status,
    to,
    requiresInitiatorVerify: request.requiresInitiatorVerify,
  });
}
