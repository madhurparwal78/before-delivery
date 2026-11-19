import { randomBytes } from 'node:crypto';
import type { MemberSummary, Membership, Role, Tier, User } from '../../shared/types';
import { sessionHasEnded } from '../domain/session';
import type { LibraryDate } from '../../shared/time';
import type { Db } from './calendar';

export interface MembershipRow {
  user_id: number;
  status: Membership['status'];
  tier: Tier;
  active_until: LibraryDate | null;
  ends_at_term: boolean;
  killbill_account_id: string | null;
  killbill_subscription_id: string | null;
}

export async function findUserByEmail(db: Db, email: string): Promise<(User & { password_hash: string }) | null> {
  const rows = await db.query<User & { password_hash: string }>(
    'select id, name, email, role, password_hash from users where email = $1',
    [email.toLowerCase()],
  );
  return rows.rows[0] ?? null;
}

export async function findUserById(db: Db, id: number): Promise<User | null> {
  const rows = await db.query<User>('select id, name, email, role from users where id = $1', [id]);
  return rows.rows[0] ?? null;
}

export async function insertUser(
  db: Db,
  name: string,
  email: string,
  passwordHash: string,
  role: Role,
): Promise<User | null> {
  const rows = await db.query<User>(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do nothing returning id, name, email, role`,
    [name, email.toLowerCase(), passwordHash, role],
  );
  return rows.rows[0] ?? null;
}

export async function insertMembership(db: Db, userId: number, tier: Tier): Promise<void> {
  await db.query(
    "insert into memberships (user_id, status, tier) values ($1, 'pending-payment', $2)",
    [userId, tier],
  );
}

export async function readMembershipRow(db: Db, userId: number): Promise<MembershipRow | null> {
  const rows = await db.query<MembershipRow>(
    `select user_id, status, tier, active_until, ends_at_term, killbill_account_id,
     killbill_subscription_id from memberships where user_id = $1`,
    [userId],
  );
  return rows.rows[0] ?? null;
}

export async function recordBillingIds(
  db: Db,
  userId: number,
  accountId: string,
  subscriptionId: string,
): Promise<void> {
  await db.query(
    'update memberships set killbill_account_id = $2, killbill_subscription_id = $3 where user_id = $1',
    [userId, accountId, subscriptionId],
  );
}

export async function markMembershipActive(db: Db, userId: number): Promise<void> {
  await db.query(
    "update memberships set status = 'active' where user_id = $1 and status = 'pending-payment'",
    [userId],
  );
}

export async function markMembershipEnding(
  db: Db,
  userId: number,
  activeUntil: LibraryDate | null,
): Promise<void> {
  await db.query(
    'update memberships set ends_at_term = true, active_until = $2 where user_id = $1',
    [userId, activeUntil],
  );
}

export async function markMembershipLapsed(db: Db, userId: number): Promise<void> {
  await db.query("update memberships set status = 'lapsed' where user_id = $1", [userId]);
}

/** A membership whose term has run out reads as lapsed from the first day after it. */
export function membershipView(row: MembershipRow, today: LibraryDate): Membership {
  const lapsed = row.status === 'active' && row.active_until !== null && today > row.active_until;
  return {
    status: lapsed ? 'lapsed' : row.status,
    tier: row.tier,
    active_until: row.active_until,
    ends_at_term: row.ends_at_term,
  };
}

export async function isMemberActive(
  db: Db,
  userId: number,
  today: LibraryDate,
): Promise<boolean> {
  const row = await readMembershipRow(db, userId);
  return row !== null && membershipView(row, today).status === 'active';
}

export async function listMemberSummaries(db: Db, today: LibraryDate): Promise<MemberSummary[]> {
  const rows = await db.query<{
    id: number;
    name: string;
    email: string;
    status: Membership['status'];
    tier: Tier;
    active_until: LibraryDate | null;
    ends_at_term: boolean;
  }>(
    `select u.id, u.name, u.email, m.status, m.tier, m.active_until, m.ends_at_term
     from users u join memberships m on m.user_id = u.id
     where u.role = 'member' order by u.name`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    membership_status: membershipView({ ...row, user_id: row.id, killbill_account_id: null, killbill_subscription_id: null }, today)
      .status,
  }));
}

export interface SessionRecord {
  readonly id: string;
  readonly user: User;
  readonly ended: boolean;
}

export async function startSession(db: Db, userId: number): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db.query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  return id;
}

/**
 * Each instance judges idleness by its own `SESSION_IDLE_SECONDS`, from the last
 * activity any instance recorded. The ending is then written down, so a session
 * one instance has ended never comes back on another.
 */
export async function readSession(
  db: Db,
  id: string,
  now: Date,
  idleSeconds: number,
): Promise<SessionRecord | null> {
  const rows = await db.query<{
    id: string;
    last_activity_at: Date;
    ended_at: Date | null;
    user_id: number;
    name: string;
    email: string;
    role: Role;
  }>(
    `select s.id, s.last_activity_at, s.ended_at, u.id as user_id, u.name, u.email, u.role
     from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const ended =
    row.ended_at !== null || sessionHasEnded(row.last_activity_at, now, idleSeconds);
  if (ended && row.ended_at === null) {
    await db.query('update sessions set ended_at = now() where id = $1 and ended_at is null', [id]);
  }
  return {
    id: row.id,
    user: { id: row.user_id, name: row.name, email: row.email, role: row.role },
    ended,
  };
}

export async function recordActivity(db: Db, id: string): Promise<void> {
  await db.query(
    'update sessions set last_activity_at = now() where id = $1 and ended_at is null',
    [id],
  );
}

export async function endSession(db: Db, id: string): Promise<void> {
  await db.query('delete from sessions where id = $1', [id]);
}

export async function listPendingMemberships(db: Db): Promise<MembershipRow[]> {
  const rows = await db.query<MembershipRow>(
    `select user_id, status, tier, active_until, ends_at_term, killbill_account_id,
     killbill_subscription_id from memberships where status = 'pending-payment'`,
  );
  return rows.rows;
}

export async function listEndingMemberships(db: Db): Promise<MembershipRow[]> {
  const rows = await db.query<MembershipRow>(
    `select user_id, status, tier, active_until, ends_at_term, killbill_account_id,
     killbill_subscription_id from memberships
     where status = 'active' and active_until is not null`,
  );
  return rows.rows;
}
