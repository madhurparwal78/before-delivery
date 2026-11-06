import { config } from './config';
import { db, transaction } from './db';
import { ApiError, invalidFields } from './errors';
import { STAND_IN_HASH, hashPassword, newToken, tokenDigest, verifyPassword } from './passwords';

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  role: 'attendee' | 'organiser';
}

const FIELD_COPY = {
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  password: 'Use at least 8 characters.',
  signinPassword: 'Enter your password.',
};

function isEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('@');
  const [local, domain] = parts;
  return parts.length === 2 && local !== undefined && local !== '' && domain !== undefined && domain.includes('.');
}

function isName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  return length >= 1 && length <= 80 && value.trim() !== '' && !value.includes('\n') && !value.includes('\r');
}

function isPassword(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  return length >= 8 && length <= 200;
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

// Every role check reads the stored account behind the token.
export async function accountForToken(token: string): Promise<AccountRecord | null> {
  const result = await db.query<AccountRecord>(
    `SELECT a.id, a.name, a.email, a.role FROM auth_tokens t JOIN accounts a ON a.id = t.account_id
      WHERE t.token_hash = $1`,
    [tokenDigest(token)],
  );
  return result.rows[0] ?? null;
}

interface SignedIn {
  token: string;
  account: AccountRecord;
}

// Signup always creates an attendee; role, id and any other field in the body are ignored.
export async function signup(body: unknown): Promise<SignedIn> {
  const name = field(body, 'name');
  const email = field(body, 'email');
  const password = field(body, 'password');
  const fields: Record<string, string> = {};
  if (!isName(name)) fields.name = FIELD_COPY.name;
  if (!isEmail(email)) fields.email = FIELD_COPY.email;
  if (!isPassword(password)) fields.password = FIELD_COPY.password;
  if (!isName(name) || !isEmail(email) || !isPassword(password)) throw invalidFields(fields);
  const hash = await hashPassword(password);
  return transaction(async (tx) => {
    const created = await tx.query<AccountRecord>(
      `INSERT INTO accounts (name, email, role, password_hash) VALUES ($1, $2, 'attendee', $3)
       ON CONFLICT (email) DO NOTHING RETURNING id, name, email, role`,
      [name, email.toLowerCase(), hash],
    );
    const account = created.rows[0];
    if (account === undefined) throw new ApiError('email_taken');
    const token = newToken();
    await tx.query('INSERT INTO auth_tokens (token_hash, account_id) VALUES ($1, $2)', [tokenDigest(token), account.id]);
    return { token, account };
  });
}

const THROTTLE_LIMIT = 5;

// The throttle: with five or more failures for this email inside the window, the wait until
// enough of them leave it that fewer than five remain. Counted in PostgreSQL for every instance.
async function retryAfter(email: string): Promise<number | null> {
  const result = await db.query<{ wait: number }>(
    `SELECT GREATEST(1, ceil(extract(epoch FROM failed_at + make_interval(secs => $2) - clock_timestamp())))::int AS wait
       FROM signin_failures
      WHERE email = $1 AND failed_at > clock_timestamp() - make_interval(secs => $2)
      ORDER BY failed_at DESC
     OFFSET $3 LIMIT 1`,
    [email, config.signinThrottleWindowSeconds, THROTTLE_LIMIT - 1],
  );
  return result.rows[0]?.wait ?? null;
}

export async function login(body: unknown): Promise<SignedIn> {
  const email = field(body, 'email');
  const password = field(body, 'password');
  const fields: Record<string, string> = {};
  if (typeof email !== 'string' || email === '') fields.email = FIELD_COPY.email;
  if (typeof password !== 'string' || password === '') fields.password = FIELD_COPY.signinPassword;
  if (typeof email !== 'string' || email === '' || typeof password !== 'string' || password === '') {
    throw invalidFields(fields);
  }
  const folded = email.toLowerCase();
  const wait = await retryAfter(folded);
  if (wait !== null) throw new ApiError('rate_limited', {}, undefined, { 'Retry-After': String(wait) });

  // Unknown emails run the same slow check against a stand-in hash, so both refusals match.
  const found = await db.query<AccountRecord & { password_hash: string }>(
    'SELECT id, name, email, role, password_hash FROM accounts WHERE email = $1',
    [folded],
  );
  const stored = found.rows[0];
  const valid = await verifyPassword(password, stored?.password_hash ?? STAND_IN_HASH);
  if (stored === undefined || !valid) {
    await db.query('INSERT INTO signin_failures (email) VALUES ($1)', [folded]);
    throw new ApiError('invalid_credentials');
  }
  const token = newToken();
  await db.query('INSERT INTO auth_tokens (token_hash, account_id) VALUES ($1, $2)', [tokenDigest(token), stored.id]);
  return { token, account: { id: stored.id, name: stored.name, email: stored.email, role: stored.role } };
}

export async function logout(token: string): Promise<void> {
  await db.query('DELETE FROM auth_tokens WHERE token_hash = $1', [tokenDigest(token)]);
}
