/** Stable machine-readable application errors for the v2 server boundary. */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  ALREADY_APPLIED: 'ALREADY_APPLIED',
  ALREADY_BOUND: 'ALREADY_BOUND',
  INVITE_INVALID: 'INVITE_INVALID',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export interface ErrorResponse {
  ok: false;
  code: ErrorCode;
  message: string;
}

export interface SuccessResponse<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;
