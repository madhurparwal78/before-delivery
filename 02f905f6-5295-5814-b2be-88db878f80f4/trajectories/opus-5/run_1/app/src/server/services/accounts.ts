import { ensureAccount } from './killbill';
import { listMembers, rememberAccountId, type UserRow } from '../repo/users';

/** The Kill Bill account of a member, created once and remembered. */
export async function memberAccountId(user: UserRow): Promise<string> {
  if (user.kb_account_id) return user.kb_account_id;
  const accountId = await ensureAccount({
    externalKey: `member-${user.member_number}`,
    name: user.name,
    email: user.email,
  });
  await rememberAccountId(user.id, accountId);
  return accountId;
}

/** The Kill Bill account of a guest drop-off, keyed by its piece number. */
export async function guestAccountId(args: {
  pieceNumber: string;
  name: string;
  email: string;
}): Promise<string> {
  return ensureAccount({
    externalKey: `guest-${args.pieceNumber}`,
    name: args.name,
    email: args.email,
  });
}

/** Fills in any member account missing from Kill Bill, if it is reachable. */
export async function ensureMemberAccounts(): Promise<void> {
  const members = await listMembers();
  for (const member of members) {
    try {
      await memberAccountId(member);
    } catch {
      return;
    }
  }
}
