import { buildContext } from './context.js';
import { AppError, ErrorCode, type ApiResponse } from './errors.js';
import { getHomeSummary } from './actions/getHomeSummary.js';
import { bindInvite, type BindInviteInput } from './actions/bindInvite.js';
import {
  recordLodgment,
  type RecordLodgmentInput,
} from './actions/recordLodgment.js';
import {
  proposeRepayment,
  type ProposeRepaymentInput,
} from './actions/proposeRepayment.js';
import { confirmChange, type ConfirmChangeInput } from './actions/confirmChange.js';

/**
 * Single router-style cloud function. The miniprogram calls
 * wx.cloud.callFunction({ name: 'ledger', data: { action, payload } }).
 *
 * Every action is server-authoritative: identity comes from the CloudBase
 * WeChat context (never the client), and all money/permission logic runs here
 * (spec §14). Errors are returned as a stable { ok:false, code } envelope so
 * the UI can render friendly, elder-readable messages.
 */
type Event = {
  action?: string;
  payload?: unknown;
};

export async function main(
  event: Event,
  fnContext: unknown,
): Promise<ApiResponse<unknown>> {
  try {
    const ctx = buildContext(fnContext);
    const { action, payload } = event ?? {};

    switch (action) {
      case 'getHomeSummary':
        return ok(await getHomeSummary(ctx));
      case 'bindInvite':
        return ok(await bindInvite(ctx, payload as BindInviteInput));
      case 'recordLodgment':
        return ok(await recordLodgment(ctx, payload as RecordLodgmentInput));
      case 'proposeRepayment':
        return ok(await proposeRepayment(ctx, payload as ProposeRepaymentInput));
      case 'confirmChange':
        return ok(await confirmChange(ctx, payload as ConfirmChangeInput));
      default:
        throw new AppError(
          ErrorCode.INVALID_ARGUMENT,
          `Unknown action: ${String(action)}`,
        );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function toErrorResponse(err: unknown): ApiResponse<never> {
  if (err instanceof AppError) {
    return { ok: false, code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  // Map a couple of thrown sentinel strings to codes; default to INTERNAL.
  if (message.startsWith('UNAUTHENTICATED')) {
    return { ok: false, code: ErrorCode.UNAUTHENTICATED, message };
  }
  return { ok: false, code: ErrorCode.INTERNAL, message };
}

// CloudBase expects a CommonJS-style `exports.main`. With ESM output the named
// export is picked up by the runtime; keep `main` as the entry.
export default { main };
