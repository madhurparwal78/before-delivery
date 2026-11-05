import type { Db } from './db.js';
import { newId, hashPassword, HttpError } from './util.js';
import type { Currency } from './money.js';
import type { UserRole } from './domain.js';

export interface SessionContext {
  sessionId: string;
  user: UserRow | null;
}

export interface UserRow {
  id: string;
  accountId: string | null;
  name: string;
  email: string;
  role: UserRole;
}

export interface AccountRow {
  id: string;
  businessName: string;
  currency: Currency;
  cardLast4: string | null;
  killbillAccountId: string | null;
}

export async function createSession(db: Db, userId: string | null): Promise<string> {
  const id = newId();
  await db.query('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, now(), now() + interval \'30 days\')', [id, userId]);
  return id;
}

export async function loadSession(db: Db, sessionId: string | undefined): Promise<SessionContext | null> {
  if (!sessionId) return null;
  const result = await db.query(
    `SELECT s.id AS session_id, u.id AS user_id, u.account_id, u.name, u.email, u.role
     FROM sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as {
    session_id: string;
    user_id: string | null;
    account_id: string | null;
    name: string;
    email: string;
    role: UserRole;
  };
  return {
    sessionId: row.session_id,
    user: row.user_id
      ? { id: row.user_id, accountId: row.account_id, name: row.name, email: row.email, role: row.role }
      : null,
  };
}

export async function signIn(db: Db, email: string, password: string): Promise<{ sessionId: string; user: UserRow }> {
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rowCount === 0) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  const row = result.rows[0] as { id: string; account_id: string | null; name: string; email: string; role: UserRole; password_hash: string };
  const { verifyPassword } = await import('./util.js');
  if (!verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  const sessionId = await createSession(db, row.id);
  return {
    sessionId,
    user: { id: row.id, accountId: row.account_id, name: row.name, email: row.email, role: row.role },
  };
}

export async function createUser(db: Db, input: {
  accountId: string | null;
  name: string;
  email: string;
  role: UserRole;
  password: string;
}): Promise<UserRow> {
  const id = newId();
  const hash = hashPassword(input.password);
  try {
    await db.query(
      'INSERT INTO users (id, account_id, name, email, role, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())',
      [id, input.accountId, input.name, input.email, input.role, hash],
    );
  } catch {
    throw new HttpError(422, 'email_taken', 'This person already has a Pampero Ledger sign-in.', {
      email: 'This person already has a Pampero Ledger sign-in.',
    });
  }
  return { id, accountId: input.accountId, name: input.name, email: input.email, role: input.role };
}

export async function createAccount(db: Db, businessName: string, currency: Currency): Promise<AccountRow> {
  const id = newId();
  await db.query(
    'INSERT INTO accounts (id, business_name, currency, created_at, seeding_day) VALUES ($1, $2, $3, now(), (now() AT TIME ZONE \'America/Argentina/Buenos_Aires\')::date)',
    [id, businessName, currency],
  );
  return { id, businessName, currency, cardLast4: null, killbillAccountId: null };
}

export async function getAccount(db: Db, accountId: string): Promise<AccountRow | null> {
  const result = await db.query('SELECT id, business_name, currency, card_last4, killbill_account_id FROM accounts WHERE id = $1', [accountId]);
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as { id: string; business_name: string; currency: Currency; card_last4: string | null; killbill_account_id: string | null };
  return { id: row.id, businessName: row.business_name, currency: row.currency, cardLast4: row.card_last4, killbillAccountId: row.killbill_account_id };
}

export function requireUser(session: SessionContext | null): UserRow {
  if (!session?.user) {
    throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  }
  return session.user;
}

export function requireClientOwner(session: SessionContext | null): UserRow {
  const user = requireUser(session);
  if (user.role !== 'client_owner') {
    throw new HttpError(403, 'forbidden', 'Only the client owner may do that.');
  }
  return user;
}

export function requireStudioOwner(session: SessionContext | null): UserRow {
  const user = requireUser(session);
  if (user.role !== 'studio_owner') {
    throw new HttpError(403, 'forbidden', 'Only the studio owner may do that.');
  }
  return user;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'We could not find that.');
}

export function idempotencyScope(session: SessionContext | null): string {
  if (session?.user) return `user:${session.user.id}`;
  if (session) return `session:${session.sessionId}`;
  return 'anonymous';
}
