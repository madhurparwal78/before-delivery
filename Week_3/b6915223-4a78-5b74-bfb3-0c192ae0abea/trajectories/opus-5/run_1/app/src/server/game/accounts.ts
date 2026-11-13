import { one, pool, query } from '../db.ts';
import type { Me } from '../../shared/types.ts';
import { SIGNIN_OUTAGE } from '../../shared/copy.ts';
import {
  PocketBaseRejected,
  PocketBaseUnavailable,
  authenticateUser,
  createUser,
  type PocketBaseUser,
} from '../services/pocketbase.ts';
import { OPERATOR_EMAIL } from '../domain/seed.ts';
import { apiError, conflict, validation } from '../http/errors.ts';
import type { ManagerRecord } from './sessions.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const parseSignUp = (
  body: Record<string, unknown>,
): { email: string; password: string; teamName: string } => {
  const fields: Record<string, string> = {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!EMAIL_PATTERN.test(email)) fields.email = 'Give an email address.';
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10 || password.length > 72) {
    fields.password = 'Use 10 to 72 characters.';
  }
  const teamName = typeof body.team_name === 'string' ? body.team_name.trim() : '';
  if (teamName.length < 3 || teamName.length > 30) {
    fields.team_name = 'Use 3 to 30 characters.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { email, password, teamName };
};

export const ensureManagerRecord = async (user: PocketBaseUser): Promise<ManagerRecord> => {
  const role = user.email === OPERATOR_EMAIL ? 'operator' : 'manager';
  const inserted = await query<ManagerRecord>(
    pool,
    `insert into managers (pb_user_id, email, team_name, role)
     values ($1, $2, $3, $4)
     on conflict (pb_user_id) do update set email = $2
     returning id, pb_user_id, email, team_name, role`,
    [user.id, user.email, user.team_name, role],
  );
  return inserted[0]!;
};

const unavailable = (): never => {
  throw apiError(503, 'accounts_unavailable', SIGNIN_OUTAGE);
};

export const signUp = async (
  email: string,
  password: string,
  teamName: string,
): Promise<ManagerRecord> => {
  try {
    return await ensureManagerRecord(await createUser(email, password, teamName));
  } catch (error) {
    if (error instanceof PocketBaseUnavailable) unavailable();
    if (error instanceof PocketBaseRejected && error.status === 400) {
      throw conflict('email_taken', 'An account with this email already exists.');
    }
    throw error;
  }
};

export const signIn = async (
  email: string,
  password: string,
): Promise<ManagerRecord | null> => {
  try {
    const user = await authenticateUser(email, password);
    if (user === null) return null;
    return await ensureManagerRecord(user);
  } catch (error) {
    if (error instanceof PocketBaseUnavailable) unavailable();
    throw error;
  }
};

export const meView = (manager: ManagerRecord): Me => ({
  id: manager.id,
  email: manager.email,
  team_name: manager.team_name,
  role: manager.role,
});

export const managerById = async (id: string): Promise<ManagerRecord | null> =>
  (await one<ManagerRecord>(
    pool,
    'select id, pb_user_id, email, team_name, role from managers where id = $1',
    [id],
  )) ?? null;
