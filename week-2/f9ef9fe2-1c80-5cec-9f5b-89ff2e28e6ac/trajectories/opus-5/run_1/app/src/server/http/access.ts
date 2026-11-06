import type { Role } from '../../shared/types.js';
import type { Sql } from '../db/pool.js';
import { loadKitchen, loadMember, type KitchenRecord, type MemberRecord } from '../domain/kitchens.js';
import { failures } from './errors.js';
import type { SessionUser } from './session.js';

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw failures.unauthenticated();
  return user;
}

export function requireRole(user: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw failures.forbidden();
}

/** A kitchen the signed-in user does not belong to does not exist for them. */
export async function requireKitchen(
  client: Sql,
  user: SessionUser,
  kitchenId: string,
): Promise<KitchenRecord> {
  const kitchen = await loadKitchen(client, kitchenId);
  if (!kitchen || kitchen.id !== user.kitchen_id) throw failures.notFound();
  return kitchen;
}

/**
 * The member whose records a request may touch. Members only ever reach their
 * own; operators reach any member of their kitchen; anything else is not found.
 */
export async function requireMember(
  client: Sql,
  user: SessionUser,
  memberId: string,
): Promise<MemberRecord> {
  const member = await loadMember(client, memberId);
  if (!member || member.kitchen_id !== user.kitchen_id) throw failures.notFound();
  if (user.role === 'member' && member.id !== user.member_id) throw failures.notFound();
  return member;
}

/**
 * The member a quote, hold or series request is for. Members never pass a
 * member id; operators must.
 */
export async function memberForRequest(
  client: Sql,
  user: SessionUser,
  requested: unknown,
): Promise<MemberRecord> {
  if (user.role === 'member') {
    if (user.member_id === null) throw failures.notFound();
    return requireMember(client, user, user.member_id);
  }
  if (user.role !== 'operator') throw failures.forbidden();
  if (typeof requested !== 'string' || requested === '') {
    throw failures.validation({ member_id: 'Choose the member this is for.' });
  }
  return requireMember(client, user, requested);
}
