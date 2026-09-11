import {
  LoanAccountStatus,
  UserRole,
  type LoanAccount,
  type User,
} from '@family-ledger/shared';
import { MemoryRepo } from '../data/memory-repo.js';
import { makeActionContext, type ActionContext } from './action-context.js';

export interface Fixture {
  repo: MemoryRepo;
  admin: User;
  mom: User;
  dad: User;
  momLoan: LoanAccount;
  dadLoan: LoanAccount;
  ctxFor: (openid: string, now?: number) => ActionContext;
}

/** A single family: admin (曾骏) + two lenders, each with a loan account. */
export function makeFamily(): Fixture {
  const repo = new MemoryRepo();
  const familyId = 'fam1';

  const admin: User = {
    _id: 'u_admin',
    openid: 'openid_admin',
    displayName: '曾骏',
    role: UserRole.BORROWER,
    familyId,
    boundAt: 1,
  };
  const mom: User = {
    _id: 'u_mom',
    openid: 'openid_mom',
    displayName: '妈妈',
    role: UserRole.LENDER,
    familyId,
    boundAt: 1,
  };
  const dad: User = {
    _id: 'u_dad',
    openid: 'openid_dad',
    displayName: '爸爸',
    role: UserRole.LENDER,
    familyId,
    boundAt: 1,
  };
  repo.users.push(admin, mom, dad);

  const momLoan: LoanAccount = {
    _id: 'loan_mom',
    familyId,
    lenderUserId: mom._id,
    borrowerUserId: admin._id,
    currency: 'CNY',
    status: LoanAccountStatus.ACTIVE,
  };
  const dadLoan: LoanAccount = {
    _id: 'loan_dad',
    familyId,
    lenderUserId: dad._id,
    borrowerUserId: admin._id,
    currency: 'CNY',
    status: LoanAccountStatus.ACTIVE,
  };
  repo.accounts.push(momLoan, dadLoan);

  const ctxFor = (openid: string, now = Date.UTC(2026, 0, 1, 4, 0, 0)) =>
    makeActionContext({ repo, openid, now });

  return { repo, admin, mom, dad, momLoan, dadLoan, ctxFor };
}
