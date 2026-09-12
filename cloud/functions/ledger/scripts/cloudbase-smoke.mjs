import { randomBytes } from 'node:crypto';
import cloudbase from '@cloudbase/node-sdk';
import {
  Collections,
  LOAN_EVENT_SCHEMA_VERSION,
  LoanEventType,
  RateSource,
} from '@family-ledger/shared';
import { CloudBaseRepo } from '../dist/data/cloudbase-repo.js';
import { createLoanRequest } from '../dist/actions/createLoanRequest.js';
import { ensureUser } from '../dist/actions/ensureUser.js';
import {
  acceptInviteRequest,
  createLoanInvite,
} from '../dist/actions/loanInvites.js';
import { verifyFirstCounterparty } from '../dist/actions/verifyFirstCounterparty.js';

function assert(condition, message) {
  if (!condition) throw new Error(`R12D smoke assertion failed: ${message}`);
}

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function extractOne(response) {
  if (Array.isArray(response?.data)) return response.data[0] || null;
  return response?.data && typeof response.data === 'object' ? response.data : null;
}

function errorContains(error, sentinel) {
  return error instanceof Error && error.message.includes(sentinel);
}

const envId = process.env.CLOUDBASE_ENV_ID;
if (!envId) throw new Error('CLOUDBASE_ENV_ID is required');
if (process.env.R12D_ALLOW_MUTATION !== envId) {
  throw new Error(
    'Refusing to mutate CloudBase. Set R12D_ALLOW_MUTATION to the exact CLOUDBASE_ENV_ID after confirming it is a disposable development environment.',
  );
}

const hasApiKey = Boolean(process.env.CLOUDBASE_APIKEY);
const hasSecretPair = Boolean(
  process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY,
);
if (!hasApiKey && !hasSecretPair) {
  throw new Error(
    'CloudBase admin authentication is required through CLOUDBASE_APIKEY or TENCENTCLOUD_SECRETID + TENCENTCLOUD_SECRETKEY.',
  );
}

const app = cloudbase.init({ env: envId });
const db = app.database();
const repo = new CloudBaseRepo(db);
const runId = `r12d-${Date.now()}-${randomBytes(4).toString('hex')}`;
const aliceOpenid = `${runId}-alice`;
const bobOpenid = `${runId}-bob`;
const requestKey = `${runId}-create`;
const today = shanghaiToday();
let requestId = null;
let inviteId = null;
let loanId = null;
let aliceUserId = null;
let bobUserId = null;
const keepData = process.env.R12D_KEEP_DATA === '1';

function ctx(openid, offset = 0) {
  return { repo, openid, now: Date.now() + offset };
}

async function removeDoc(collection, id) {
  if (!id) return;
  try {
    await db.collection(collection).doc(id).remove();
  } catch (error) {
    console.warn(`cleanup warning for ${collection}/${id}:`, error?.message || error);
  }
}

async function cleanup() {
  if (keepData) {
    console.log(`R12D_KEEP_DATA=1; preserving smoke data tagged ${runId}`);
    return;
  }
  if (loanId) {
    try {
      await db.collection(Collections.LOAN_EVENTS).where({ loanId }).remove();
    } catch (error) {
      console.warn('cleanup warning for loan events:', error?.message || error);
    }
  }
  await removeDoc(Collections.LOANS, loanId);
  await removeDoc(Collections.INVITE_TOKENS, inviteId);
  await removeDoc(Collections.LEDGER_REQUESTS, requestId);

  for (const openid of [aliceOpenid, bobOpenid]) {
    try {
      const user = await repo.getUserByOpenid(openid);
      if (user) await removeDoc(Collections.USERS, user._id);
    } catch (error) {
      console.warn(`cleanup warning for synthetic user ${openid}:`, error?.message || error);
    }
  }
}

try {
  console.log(`R12D CloudBase smoke starting in ${envId} (run ${runId})`);

  const [aliceA, aliceB] = await Promise.all([
    ensureUser(ctx(aliceOpenid), { displayName: 'R12D Alice' }),
    ensureUser(ctx(aliceOpenid, 1), { displayName: 'R12D Alice' }),
  ]);
  assert(aliceA._id === aliceB._id, 'concurrent ensureUser did not converge');
  aliceUserId = aliceA._id;

  const bob = await ensureUser(ctx(bobOpenid, 2), { displayName: 'R12D Bob' });
  bobUserId = bob._id;

  const request = await createLoanRequest(ctx(aliceOpenid, 3), {
    unknownPartyRole: 'BORROWER',
    initialPrincipalFen: 12_345,
    rate: {
      annualEffectiveRate: '0.01',
      rateSource: RateSource.MANUAL,
    },
    proposedEffectiveDate: today,
    note: runId,
    idempotencyKey: requestKey,
  });
  requestId = request._id;

  const rawToken = randomBytes(32).toString('base64url');
  const invite = await createLoanInvite(ctx(aliceOpenid, 4), {
    requestId: request._id,
    rawToken,
  });
  inviteId = invite.invite._id;

  const claimed = await acceptInviteRequest(ctx(bobOpenid, 5), {
    rawToken,
    displayName: 'R12D Bob',
  });
  assert(
    claimed.request.counterpartyUserId === bob._id,
    'invite claim did not bind Bob',
  );

  const applied = await verifyFirstCounterparty(ctx(aliceOpenid, 6), {
    requestId: request._id,
  });
  loanId = applied.loan._id;
  assert(applied.loan.lenderUserId === aliceA._id, 'Alice is not lender');
  assert(applied.loan.borrowerUserId === bob._id, 'Bob is not borrower');

  const retry = await verifyFirstCounterparty(ctx(aliceOpenid, 7), {
    requestId: request._id,
  });
  assert(retry.loan._id === applied.loan._id, 'verification retry duplicated Loan');

  const beforeEvents = await repo.listLoanEvents({
    loanId: applied.loan._id,
    page: { limit: 100 },
  });
  assert(beforeEvents.items.length === 2, 'CREATE_LOAN did not create exactly two genesis events');
  assert(beforeEvents.items[0]?.sequence === 1, 'first genesis sequence is not 1');
  assert(beforeEvents.items[1]?.sequence === 2, 'second genesis sequence is not 2');

  const loanBeforeRollback = extractOne(
    await db.collection(Collections.LOANS).doc(applied.loan._id).get(),
  );
  assert(loanBeforeRollback, 'raw Loan document missing before rollback test');
  const nextSequenceBefore = loanBeforeRollback.nextEventSequence;

  let forcedRollbackObserved = false;
  try {
    await repo.runTransaction(async (tx) => {
      const [sequence] = await tx.allocateEventSequences(applied.loan._id, 1);
      assert(sequence != null, 'rollback test could not allocate sequence');
      await tx.appendEventIdempotent({
        loanId: applied.loan._id,
        eventType: LoanEventType.PRINCIPAL_ADD,
        amountFen: 1,
        effectiveDate: today,
        sourceRequestId: request._id,
        createdBy: aliceA._id,
        confirmedBy: bob._id,
        sequence,
        idempotencyKey: `${runId}-forced-rollback-event`,
        createdAt: Date.now(),
        schemaVersion: LOAN_EVENT_SCHEMA_VERSION,
      });
      throw new Error('R12D_FORCED_ROLLBACK');
    });
  } catch (error) {
    if (errorContains(error, 'R12D_FORCED_ROLLBACK')) {
      forcedRollbackObserved = true;
    } else {
      throw error;
    }
  }
  assert(forcedRollbackObserved, 'forced rollback sentinel was not observed');

  const afterEvents = await repo.listLoanEvents({
    loanId: applied.loan._id,
    page: { limit: 100 },
  });
  assert(afterEvents.items.length === 2, 'rolled-back event was persisted');
  const loanAfterRollback = extractOne(
    await db.collection(Collections.LOANS).doc(applied.loan._id).get(),
  );
  assert(
    loanAfterRollback?.nextEventSequence === nextSequenceBefore,
    'event sequence reservation was not rolled back',
  );

  const storedRequest = await repo.getRequest(request._id);
  assert(storedRequest, 'request missing before update rollback test');
  const originalUpdatedAt = storedRequest.updatedAt;
  try {
    await repo.runTransaction(async (tx) => {
      const current = await tx.getRequest(request._id);
      assert(current, 'request missing inside rollback transaction');
      await tx.putRequest({ ...current, updatedAt: originalUpdatedAt + 999_999 });
      throw new Error('R12D_FORCED_UPDATE_ROLLBACK');
    });
  } catch (error) {
    if (!errorContains(error, 'R12D_FORCED_UPDATE_ROLLBACK')) {
      throw error;
    }
  }
  assert(
    (await repo.getRequest(request._id))?.updatedAt === originalUpdatedAt,
    'rolled-back request update was persisted',
  );

  console.log('R12D CloudBase persistence smoke PASS');
  console.log('Verified: unique OPENID convergence, first-contact transaction, idempotent verify retry, event rollback, sequence rollback, request-update rollback.');
} finally {
  await cleanup();
  void aliceUserId;
  void bobUserId;
}
