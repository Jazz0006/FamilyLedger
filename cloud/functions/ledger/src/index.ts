import { buildContext } from './context.js';
import { CloudBaseRepo } from './data/cloudbase-repo.js';
import { AppError, ErrorCode, type ApiResponse } from './errors.js';
import { makeActionContext } from './actions/action-context.js';
import { ensureUser } from './actions/ensureUser.js';
import { createLoanRequest } from './actions/createLoanRequest.js';
import {
  acceptInviteRequest,
  createLoanInvite,
  previewInvite,
} from './actions/loanInvites.js';
import { verifyFirstCounterparty } from './actions/verifyFirstCounterparty.js';

type Event = {
  action?: string;
  payload?: unknown;
};

/**
 * v2 ledger router. Only actions whose v2 authority/transaction semantics have
 * been implemented are exposed here; unavailable legacy/future actions fail
 * closed instead of falling back to v1 behavior.
 */
export async function main(
  event: Event,
  fnContext: unknown,
): Promise<ApiResponse<unknown>> {
  try {
    const call = buildContext(fnContext);
    const ctx = makeActionContext({
      repo: new CloudBaseRepo(call.db),
      openid: call.openid,
      now: call.now,
    });

    switch (event?.action) {
      case 'ensureUser':
        return ok(await ensureUser(ctx, event.payload));
      case 'createLoanRequest':
        return ok(await createLoanRequest(ctx, event.payload));
      case 'createLoanInvite':
        return ok(await createLoanInvite(ctx, event.payload));
      case 'previewInvite':
        return ok(await previewInvite(ctx, event.payload));
      case 'acceptInviteRequest':
        return ok(await acceptInviteRequest(ctx, event.payload));
      case 'verifyFirstCounterparty':
        return ok(await verifyFirstCounterparty(ctx, event.payload));
      default:
        throw new AppError(
          ErrorCode.INVALID_STATE,
          `v2 action unavailable: ${String(event?.action)}`,
        );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function toErrorResponse(error: unknown): ApiResponse<never> {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('UNAUTHENTICATED')) {
    return { ok: false, code: ErrorCode.UNAUTHENTICATED, message };
  }
  return { ok: false, code: ErrorCode.INTERNAL, message };
}

export default { main };
