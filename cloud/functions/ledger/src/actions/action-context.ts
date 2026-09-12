import type { LedgerRepo } from '../data/repo.js';

/**
 * Trusted application context for v2 actions.
 *
 * Identity is resolved by the CloudBase runtime before an action is invoked.
 * There is deliberately no family/admin/global-role state here.
 */
export interface ActionContext {
  repo: LedgerRepo;
  openid: string;
  now: number;
}

export function makeActionContext(params: ActionContext): ActionContext {
  return params;
}
