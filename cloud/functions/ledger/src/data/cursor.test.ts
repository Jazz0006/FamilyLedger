import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode } from '../errors.js';
import {
  decodeCreatedAtCursor,
  decodeSequenceCursor,
  encodeCreatedAtCursor,
  encodeSequenceCursor,
  validatePageInput,
} from './cursor.js';

function expectValidationError(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected validation error');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
  }
}

describe('persistence cursors', () => {
  it('round-trips createdAt/_id cursor', () => {
    const cursor = encodeCreatedAtCursor({ createdAt: 123, _id: 'doc-9' });
    expect(decodeCreatedAtCursor(cursor)).toEqual({ createdAt: 123, _id: 'doc-9' });
  });

  it('round-trips event sequence cursor', () => {
    expect(decodeSequenceCursor(encodeSequenceCursor(42))).toBe(42);
  });

  it.each([0, -1, 101, 1.5])('rejects invalid page size %s', (limit) => {
    expectValidationError(() => validatePageInput({ limit }));
  });

  it('accepts the bounded CloudBase page-size range', () => {
    expect(() => validatePageInput({ limit: 1 })).not.toThrow();
    expect(() => validatePageInput({ limit: 100 })).not.toThrow();
  });

  it('rejects malformed cursors', () => {
    expectValidationError(() => decodeCreatedAtCursor('not-base64-json'));
    expectValidationError(() => decodeSequenceCursor('not-base64-json'));
  });

  it('rejects a cursor of the wrong kind', () => {
    expectValidationError(() =>
      decodeSequenceCursor(encodeCreatedAtCursor({ createdAt: 1, _id: 'x' })),
    );
  });
});
