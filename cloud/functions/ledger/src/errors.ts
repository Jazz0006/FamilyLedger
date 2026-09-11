/** Stable error codes returned to the client. UI maps these to friendly text. */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  NOT_BOUND: 'NOT_BOUND',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVITE_INVALID: 'INVITE_INVALID',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_USED: 'INVITE_USED',
  ALREADY_BOUND: 'ALREADY_BOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  REPAY_EXCEEDS_PRINCIPAL: 'REPAY_EXCEEDS_PRINCIPAL',
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
