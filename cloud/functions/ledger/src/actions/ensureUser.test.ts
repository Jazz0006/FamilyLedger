import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../data/memory-repo.js';
import { AppError, ErrorCode } from '../errors.js';
import { ensureUser } from './ensureUser.js';
import { makeActionContext } from './action-context.js';

function ctx(repo: MemoryRepo, openid = 'openid-a', now = 123) {
  return makeActionContext({ repo, openid, now });
}

describe('ensureUser', () => {
  it('creates one ordinary User for a new runtime OPENID', async () => {
    const repo = new MemoryRepo();
    const user = await ensureUser(ctx(repo), {
      displayName: ' Jazz ',
      avatarUrl: ' https://example.test/a.png ',
    });

    expect(user.openid).toBe('openid-a');
    expect(user.displayName).toBe('Jazz');
    expect(user.avatarUrl).toBe('https://example.test/a.png');
    expect(user.createdAt).toBe(123);
    expect(user.updatedAt).toBe(123);
    expect('role' in user).toBe(false);
    expect('familyId' in user).toBe(false);
  });

  it('uses a neutral default display name when none is supplied', async () => {
    const repo = new MemoryRepo();
    const user = await ensureUser(ctx(repo), {});
    expect(user.displayName).toBe('微信用户');
    expect(user.avatarUrl).toBeNull();
  });

  it('retry returns the same User id', async () => {
    const repo = new MemoryRepo();
    const first = await ensureUser(ctx(repo));
    const second = await ensureUser(ctx(repo));

    expect(second._id).toBe(first._id);
  });

  it('concurrent same-OPENID calls resolve to one User identity', async () => {
    const repo = new MemoryRepo();
    const actionContext = ctx(repo);

    const [a, b] = await Promise.all([
      ensureUser(actionContext, { displayName: 'first' }),
      ensureUser(actionContext, { displayName: 'second' }),
    ]);

    expect(a._id).toBe(b._id);
    expect((await repo.getUserByOpenid('openid-a'))?._id).toBe(a._id);
  });

  it('does not overwrite an existing profile during ensure/login', async () => {
    const repo = new MemoryRepo();
    const first = await ensureUser(ctx(repo), {
      displayName: 'Original',
      avatarUrl: 'https://example.test/original.png',
    });

    const again = await ensureUser(ctx(repo, 'openid-a', 999), {
      displayName: 'Replacement',
      avatarUrl: null,
    });

    expect(again).toEqual(first);
  });

  it('ignores client-supplied identity-like fields and uses runtime OPENID', async () => {
    const repo = new MemoryRepo();
    const user = await ensureUser(ctx(repo, 'trusted-runtime-openid'), {
      displayName: 'User',
      openid: 'attacker-controlled-openid',
      role: 'BORROWER',
      familyId: 'legacy-family',
    });

    expect(user.openid).toBe('trusted-runtime-openid');
    expect('role' in user).toBe(false);
    expect('familyId' in user).toBe(false);
    expect(await repo.getUserByOpenid('attacker-controlled-openid')).toBeNull();
  });

  it('validates profile field types for a new user', async () => {
    const repo = new MemoryRepo();
    try {
      await ensureUser(ctx(repo), { displayName: 123 });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });
});
