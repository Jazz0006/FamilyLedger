import { beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { makeActionContext, type ActionContext } from './action-context.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import { createInvite, previewInvite } from './invites.js';
import { bindInvite } from './bindInvite.js';

const T0 = Date.UTC(2026, 0, 1, 4, 0, 0);

function ctx(repo: MemoryRepo, openid: string, now = T0): ActionContext {
  return makeActionContext({ repo, openid, now });
}

describe('bootstrapAdmin', () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
  });

  it('first caller becomes the BORROWER/admin', async () => {
    const res = await bootstrapAdmin(ctx(repo, 'openid_zj'), {
      displayName: '曾骏',
    });
    expect(res.userId).toBeTruthy();
    const user = await repo.getUserByOpenid('openid_zj');
    expect(user?.role).toBe(UserRole.BORROWER);
    expect(user?.boundAt).toBe(T0);
  });

  it('self-disables: a second caller is refused with CONFLICT', async () => {
    await bootstrapAdmin(ctx(repo, 'openid_zj'), { displayName: '曾骏' });
    await expect(
      bootstrapAdmin(ctx(repo, 'openid_intruder'), { displayName: '坏人' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.users).toHaveLength(1);
  });

  it('requires a display name', async () => {
    await expect(
      bootstrapAdmin(ctx(repo, 'openid_zj'), { displayName: '  ' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('createInvite + previewInvite + bindInvite (full onboarding)', () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    await bootstrapAdmin(ctx(repo, 'openid_zj'), { displayName: '曾骏' });
  });

  async function inviteFor(name: string): Promise<string> {
    const { rawToken } = await createInvite(ctx(repo, 'openid_zj'), {
      displayName: name,
    });
    return rawToken;
  }

  it('admin creates an invite; only the hash is stored, not the raw token', async () => {
    const rawToken = await inviteFor('妈妈');
    expect(rawToken).toBeTruthy();
    expect(repo.invites).toHaveLength(1);
    expect(repo.invites[0]!.tokenHash).not.toBe(rawToken);
    expect(repo.invites[0]!.displayName).toBe('妈妈');
    expect(repo.invites[0]!.usedAt).toBeNull();
  });

  it('non-admin cannot create invites', async () => {
    // Bind a lender first, then have them try to create an invite.
    const token = await inviteFor('妈妈');
    await bindInvite(ctx(repo, 'openid_mom'), { token });
    const token2 = await inviteFor('爸爸'); // admin makes another
    await bindInvite(ctx(repo, 'openid_dad'), { token: token2 });
    await expect(
      createInvite(ctx(repo, 'openid_mom'), { displayName: '姐姐' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('previewInvite shows the name for a valid token, hides it otherwise', async () => {
    const token = await inviteFor('妈妈');
    expect(await previewInvite(ctx(repo, 'openid_mom'), { token })).toEqual({
      displayName: '妈妈',
      valid: true,
    });
    expect(
      await previewInvite(ctx(repo, 'openid_mom'), { token: 'garbage' }),
    ).toEqual({ displayName: '', valid: false });
  });

  it('bind creates the user + loan account and consumes the invite', async () => {
    const token = await inviteFor('妈妈');
    const res = await bindInvite(ctx(repo, 'openid_mom'), { token });

    const user = await repo.getUserByOpenid('openid_mom');
    expect(user?.displayName).toBe('妈妈');
    expect(user?.role).toBe(UserRole.LENDER);

    const account = await repo.getLoanAccount(res.loanId);
    expect(account?.lenderUserId).toBe(user!._id);
    // Borrower is the admin.
    const admin = await repo.getUserByOpenid('openid_zj');
    expect(account?.borrowerUserId).toBe(admin!._id);

    // Invite consumed, pointing at the created user.
    expect(repo.invites[0]!.usedAt).toBe(T0);
    expect(repo.invites[0]!.consumedUserId).toBe(user!._id);
  });

  it('a used token cannot be bound again (INVITE_USED)', async () => {
    const token = await inviteFor('妈妈');
    await bindInvite(ctx(repo, 'openid_mom'), { token });
    await expect(
      bindInvite(ctx(repo, 'openid_other'), { token }),
    ).rejects.toMatchObject({ code: 'INVITE_USED' });
  });

  it('an expired token is rejected', async () => {
    const token = await inviteFor('妈妈');
    const later = T0 + 8 * 24 * 60 * 60 * 1000; // 8 days > 7-day TTL
    await expect(
      bindInvite(ctx(repo, 'openid_mom', later), { token }),
    ).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });
  });

  it('a WeChat account already bound cannot bind another invite', async () => {
    const t1 = await inviteFor('妈妈');
    await bindInvite(ctx(repo, 'openid_mom'), { token: t1 });
    const t2 = await inviteFor('爸爸');
    await expect(
      bindInvite(ctx(repo, 'openid_mom'), { token: t2 }),
    ).rejects.toMatchObject({ code: 'ALREADY_BOUND' });
  });

  it('unknown token is rejected as INVITE_INVALID', async () => {
    await expect(
      bindInvite(ctx(repo, 'openid_mom'), { token: 'never-issued' }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });
  });
});
