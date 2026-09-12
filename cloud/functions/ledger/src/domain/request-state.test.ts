import { describe, expect, it } from 'vitest';
import { LedgerRequestStatus } from '@family-ledger/shared';
import { AppError, ErrorCode } from '../errors.js';
import {
  assertRequestStatusTransition,
  canTransitionRequestStatus,
  isTerminalRequestStatus,
} from './request-state.js';

const S = LedgerRequestStatus;

function expectInvalidState(fn: () => void): void {
  try {
    fn();
    throw new Error('expected INVALID_STATE');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.INVALID_STATE);
  }
}

describe('request state machine', () => {
  it.each([S.APPLIED, S.REJECTED, S.CANCELLED, S.EXPIRED])(
    'allows known-counterparty PENDING -> %s',
    (to) => {
      expect(
        canTransitionRequestStatus({
          from: S.PENDING,
          to,
          requiresInitiatorVerify: false,
        }),
      ).toBe(true);
    },
  );

  it('requires first-contact acceptance before APPLIED', () => {
    expect(
      canTransitionRequestStatus({
        from: S.PENDING,
        to: S.PENDING_INITIATOR_VERIFY,
        requiresInitiatorVerify: true,
      }),
    ).toBe(true);
    expect(
      canTransitionRequestStatus({
        from: S.PENDING,
        to: S.APPLIED,
        requiresInitiatorVerify: true,
      }),
    ).toBe(false);
  });

  it.each([S.APPLIED, S.CANCELLED, S.EXPIRED])(
    'allows PENDING_INITIATOR_VERIFY -> %s',
    (to) => {
      expect(
        canTransitionRequestStatus({
          from: S.PENDING_INITIATOR_VERIFY,
          to,
          requiresInitiatorVerify: true,
        }),
      ).toBe(true);
    },
  );

  it('does not allow initiator-verification state to become REJECTED', () => {
    expectInvalidState(() =>
      assertRequestStatusTransition({
        from: S.PENDING_INITIATOR_VERIFY,
        to: S.REJECTED,
        requiresInitiatorVerify: true,
      }),
    );
  });

  it('does not allow a known-counterparty request to enter initiator verification', () => {
    expectInvalidState(() =>
      assertRequestStatusTransition({
        from: S.PENDING,
        to: S.PENDING_INITIATOR_VERIFY,
        requiresInitiatorVerify: false,
      }),
    );
  });

  it.each([S.APPLIED, S.REJECTED, S.CANCELLED, S.EXPIRED])(
    'treats %s as terminal',
    (from) => {
      expect(isTerminalRequestStatus(from)).toBe(true);
      for (const to of Object.values(S)) {
        expect(
          canTransitionRequestStatus({
            from,
            to,
            requiresInitiatorVerify: true,
          }),
        ).toBe(false);
      }
    },
  );

  it('never allows APPLIED to revert to PENDING', () => {
    expectInvalidState(() =>
      assertRequestStatusTransition({
        from: S.APPLIED,
        to: S.PENDING,
        requiresInitiatorVerify: false,
      }),
    );
  });
});
