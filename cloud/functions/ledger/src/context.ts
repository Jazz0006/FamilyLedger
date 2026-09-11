import cloudbase from '@cloudbase/node-sdk';

/**
 * Server-side request context. The OPENID is taken from the CloudBase runtime,
 * NOT from anything the client sends — the client cannot spoof identity, and
 * roles are looked up server-side from the `users` collection (spec §15).
 */
export interface CallContext {
  openid: string;
  app: ReturnType<typeof cloudbase.init>;
  db: ReturnType<ReturnType<typeof cloudbase.init>['database']>;
  /** Server time in epoch millis. Never trust client timestamps. */
  now: number;
}

let cachedApp: ReturnType<typeof cloudbase.init> | null = null;

function getApp() {
  if (!cachedApp) {
    cachedApp = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  }
  return cachedApp;
}

/**
 * Build the call context from the CloudBase function invocation. The SCF
 * `context` is required to resolve the caller's WeChat OPENID. Throws if the
 * caller has no resolvable identity.
 */
export function buildContext(fnContext: unknown): CallContext {
  const app = getApp();
  const { WX_OPENID } = cloudbase.getCloudbaseContext(
    fnContext as Parameters<typeof cloudbase.getCloudbaseContext>[0],
  );
  if (!WX_OPENID) {
    throw new Error('UNAUTHENTICATED: no WeChat OPENID in call context');
  }
  return {
    openid: WX_OPENID,
    app,
    db: app.database(),
    now: Date.now(),
  };
}
