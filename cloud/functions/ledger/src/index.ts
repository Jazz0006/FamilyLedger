import { buildContext } from './context.js';
import { CloudBaseRepo } from './data/cloudbase-repo.js';
import { AppError, ErrorCode, type ApiResponse } from './errors.js';
import { makeActionContext } from './actions/action-context.js';
import { ensureUser } from './actions/ensureUser.js';

type Event = {
  action?: string;
  payload?: unknown;
};

/**
 * v2 ledger router.
 *
 * R4 deliberately exposes only ensureUser. Formal ledger mutation actions remain
 * unavailable until their own milestones establish the required transaction and
 * consent semantics.
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
