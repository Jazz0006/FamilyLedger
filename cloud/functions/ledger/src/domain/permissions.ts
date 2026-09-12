import {
  LedgerRequestStatus,
  type LedgerRequest,
  type Loan,
  type UserId,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import { assertLedgerRequestTransition } from './request-state.js';

export function isLoanParticipant(loan: Loan, userId: UserId): boolean {
  return loan.lenderUserId === userId || loan.borrowerUserId === userId;
}

export function assertLoanParticipant(loan: Loan, userId: UserId): void {
  if (!isLoanParticipant(loan, userId)) {
    throw new AppError(ErrorCode.FORBIDDEN, 'User is not a participant in this loan');
  }
}

export function getLoanCounterpartyUserId(loan: Loan, userId: UserId): UserId {
  assertLoanParticipant(loan, userId);
  return loan.lenderUserId === userId ? loan.borrowerUserId : loan.lenderUserId;
}

export function isRequestParticipant(
  request: Pick<LedgerRequest, 'proposerUserId' | 'counterpartyUserId'>,
  userId: UserId,
): boolean {
  return (
    request.proposerUserId === userId || request.counterpartyUserId === userId
  );
}

export function assertRequestParticipant(
  request: Pick<LedgerRequest, 'proposerUserId' | 'counterpartyUserId'>,
  userId: UserId,
): void {
  if (!isRequestParticipant(request, userId)) {
    throw new AppError(ErrorCode.FORBIDDEN, 'User is not a participant in this request');
  }
}

export function assertCanProposeLoanChange(loan: Loan, actorUserId: UserId): void {
  assertLoanParticipant(loan, actorUserId);
}

export function assertCanRespondToKnownCounterpartyRequest(
  request: Pick<
    LedgerRequest,
    | 'status'
    | 'requiresInitiatorVerify'
    | 'proposerUserId'
    | 'counterpartyUserId'
  >,
  actorUserId: UserId,
): void {
  if (request.requiresInitiatorVerify) {
    throw new AppError(
      ErrorCode.INVALID_STATE,
      'First-contact requests are handled through invite acceptance and initiator verification',
    );
  }
  if (request.status !== LedgerRequestStatus.PENDING) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request is not awaiting counterparty response');
  }
  if (request.counterpartyUserId == null) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Known-counterparty request has no counterparty');
  }
  if (actorUserId === request.proposerUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Proposer cannot accept or reject their own request');
  }
  if (actorUserId !== request.counterpartyUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the counterparty may accept or reject this request');
  }
}

export function assertCanCancelRequest(
  request: Pick<
    LedgerRequest,
    'status' | 'requiresInitiatorVerify' | 'proposerUserId'
  >,
  actorUserId: UserId,
): void {
  if (actorUserId !== request.proposerUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the proposer may cancel this request');
  }
  assertLedgerRequestTransition(request, LedgerRequestStatus.CANCELLED);
}

export function assertCanVerifyFirstContact(
  request: Pick<
    LedgerRequest,
    | 'status'
    | 'requiresInitiatorVerify'
    | 'proposerUserId'
    | 'counterpartyUserId'
  >,
  actorUserId: UserId,
): void {
  if (!request.requiresInitiatorVerify) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request does not require initiator verification');
  }
  if (request.status !== LedgerRequestStatus.PENDING_INITIATOR_VERIFY) {
    throw new AppError(ErrorCode.INVALID_STATE, 'Request is not awaiting initiator verification');
  }
  if (actorUserId !== request.proposerUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the original proposer may verify the first counterparty');
  }
  if (
    request.counterpartyUserId == null ||
    request.counterpartyUserId === request.proposerUserId
  ) {
    throw new AppError(ErrorCode.INVALID_STATE, 'No valid claimed counterparty is bound to the request');
  }
  assertLedgerRequestTransition(request, LedgerRequestStatus.APPLIED);
}
