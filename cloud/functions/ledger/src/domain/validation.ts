import {
  LedgerRequestType,
  type CreateLoanPayload,
  type LedgerRequest,
} from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';

function fail(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, message);
}

function assertSafePositiveFen(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} must be a positive safe integer Fen value`);
  }
}

export function assertCreateLoanRequestStructure(
  request: LedgerRequest,
): asserts request is LedgerRequest & { payload: CreateLoanPayload } {
  if (request.type !== LedgerRequestType.CREATE_LOAN) {
    fail('Request is not CREATE_LOAN');
  }
  if (request.loanId !== null) {
    fail('CREATE_LOAN request must not already reference a Loan');
  }

  const payload = request.payload as CreateLoanPayload;
  assertSafePositiveFen(payload.initialPrincipalFen, 'initialPrincipalFen');

  const borrowerKnown = payload.borrowerUserId !== null;
  const lenderKnown = payload.lenderUserId !== null;

  if (request.requiresInitiatorVerify) {
    if (borrowerKnown === lenderKnown) {
      fail('First-contact CREATE_LOAN must have exactly one unknown party');
    }

    if (!borrowerKnown) {
      if (payload.unknownPartyRole !== 'BORROWER') {
        fail('Unknown borrower must declare unknownPartyRole=BORROWER');
      }
      if (payload.lenderUserId !== request.proposerUserId) {
        fail('Known lender must be the proposer for first-contact CREATE_LOAN');
      }
    } else {
      if (payload.unknownPartyRole !== 'LENDER') {
        fail('Unknown lender must declare unknownPartyRole=LENDER');
      }
      if (payload.borrowerUserId !== request.proposerUserId) {
        fail('Known borrower must be the proposer for first-contact CREATE_LOAN');
      }
    }

    if (request.counterpartyUserId === request.proposerUserId) {
      fail('Claimed counterparty cannot equal proposer');
    }
    return;
  }

  if (!borrowerKnown || !lenderKnown) {
    fail('Known-counterparty CREATE_LOAN must identify both Loan parties');
  }
  if (payload.unknownPartyRole !== null) {
    fail('Known-counterparty CREATE_LOAN must not declare an unknown party role');
  }
  if (payload.borrowerUserId === payload.lenderUserId) {
    fail('Borrower and lender must be different users');
  }
  if (request.counterpartyUserId == null) {
    fail('Known-counterparty CREATE_LOAN must identify a counterparty');
  }
  if (request.counterpartyUserId === request.proposerUserId) {
    fail('Counterparty cannot equal proposer');
  }

  const proposerIsBorrower = payload.borrowerUserId === request.proposerUserId;
  const proposerIsLender = payload.lenderUserId === request.proposerUserId;
  if (!proposerIsBorrower && !proposerIsLender) {
    fail('Proposer must be one side of the proposed Loan');
  }

  const expectedCounterparty = proposerIsBorrower
    ? payload.lenderUserId
    : payload.borrowerUserId;
  if (request.counterpartyUserId !== expectedCounterparty) {
    fail('counterpartyUserId must be the other Loan party');
  }
}
