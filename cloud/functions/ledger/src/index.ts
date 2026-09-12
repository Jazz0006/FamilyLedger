import { ErrorCode, type ApiResponse } from './errors.js';

type Event = {
  action?: string;
  payload?: unknown;
};

/**
 * R1 clean-rewrite boundary.
 *
 * The v1.1 family/admin actions were intentionally removed instead of being
 * kept behind compatibility branches. New v2 server actions are introduced in
 * later rewrite milestones after the v2 domain/repository foundations exist.
 *
 * Keeping an explicit disabled router is safer than accidentally deploying the
 * old unilateral-write semantics while the product is being rebuilt.
 */
export async function main(
  event: Event,
  _fnContext: unknown,
): Promise<ApiResponse<never>> {
  return {
    ok: false,
    code: ErrorCode.INVALID_STATE,
    message: `v2 rewrite in progress; action unavailable: ${String(event?.action)}`,
  };
}

export default { main };
