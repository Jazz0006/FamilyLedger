import { AppError, ErrorCode } from '../errors.js';
import { MAX_PAGE_SIZE, type PageInput } from './repo.js';

export interface CreatedAtCursor {
  createdAt: number;
  _id: string;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid pagination cursor');
  }
}

export function validatePageInput(page: PageInput): void {
  if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_SIZE) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `page.limit must be an integer between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
}

export function encodeCreatedAtCursor(value: CreatedAtCursor): string {
  return encode({ kind: 'createdAt', createdAt: value.createdAt, _id: value._id });
}

export function decodeCreatedAtCursor(cursor: string): CreatedAtCursor {
  const value = decode(cursor) as Partial<CreatedAtCursor> & { kind?: unknown };
  if (
    value.kind !== 'createdAt' ||
    !Number.isFinite(value.createdAt) ||
    typeof value._id !== 'string' ||
    value._id.length === 0
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid createdAt pagination cursor');
  }
  return { createdAt: value.createdAt as number, _id: value._id };
}

export function encodeSequenceCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid event sequence cursor');
  }
  return encode({ kind: 'sequence', sequence });
}

export function decodeSequenceCursor(cursor: string): number {
  const value = decode(cursor) as { kind?: unknown; sequence?: unknown };
  if (
    value.kind !== 'sequence' ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0
  ) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid event sequence cursor');
  }
  return value.sequence as number;
}
