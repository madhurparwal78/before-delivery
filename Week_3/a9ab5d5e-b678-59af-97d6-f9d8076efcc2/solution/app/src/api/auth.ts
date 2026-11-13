import { randomBytes, createHash } from 'node:crypto';
import { knownIdOrNotFound } from '../db/ids';
import { config } from '../config';
import { appendLog, inHousehold, nextId, one, rows, transaction } from '../db';
import { Household, loadHousehold, loadVersions, householdToday, householdZone } from '../db/repo';
import { currencyExponent, activeCurrencies } from '../domain/money';
import { ApiError, fail, failField } from '../errors';
import { ApiResponse, Ctx, Session } from '../http/context';
import { inviteNotice, queueNotices, supersedeQueuedInvites } from '../services/notices';
import { isValidEmail } from '../lib/text';
import { hashPassword, passwordMatches } from './passwords';

/** Failed sign-ins for one email, in a sliding window shared by every process on the database. */
const UNIQUE_VIOLATION = '23505';
const SIGN_IN_FAILURE_LIMIT = 5;
const SIGN_IN_WINDOW_SECONDS = 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function sessionFromHeader(header: string | undefined): Promise<Session | null> {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (token === '') return null;
  const found = await one(
    `SELECT s.token_hash, p.id::text AS parent_id, p.household_id::text AS household_id, p.role, p.name
     FROM sessions s JOIN parents p ON p.id = s.parent_id WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  if (!found) return null;
  return {
    token,
    parentId: found.parent_id as string,
    householdId: found.household_id as string,
    role: found.role as Session['role'],
    name: found.name as string,
  };
}

async function openSession(client: { query: (sql: string, params?: readonly unknown[]) => Promise<unknown> }, parentId: string): Promise<string> {
  const token = newToken();
  await client.query('INSERT INTO sessions (token_hash, parent_id) VALUES ($1, $2)', [hashToken(token), parentId]);
  return token;
}

function readEmail(ctx: Ctx, field: string): string {
  const value = ctx.text(field, 'Use at most 254 characters.', { min: 1, max: 254 });
  if (!isValidEmail(value)) failField(field, 'Enter a valid email address.');
  return value;
}

export async function createHousehold(ctx: Ctx): Promise<ApiResponse> {
  const householdName = ctx.text('householdName', 'Use 1 to 80 characters.', { min: 1, max: 80 });
  const currency = ctx.text('currency', 'Choose an ISO 4217 currency code.', { min: 1, max: 80 });
  if (!activeCurrencies.has(currency)) failField('currency', 'Choose an ISO 4217 currency code.');
  const yourName = ctx.text('yourName', 'Use 1 to 80 characters.', { min: 1, max: 80 });
  const email = readEmail(ctx, 'email');
  const password = ctx.text('password', 'Use 12 to 128 characters.', { min: 12, max: 128 });
  const otherParentName = ctx.text('otherParentName', 'Use 1 to 80 characters.', { min: 1, max: 80 });
  const otherParentEmail = readEmail(ctx, 'otherParentEmail');
  if (email.toLowerCase() === otherParentEmail.toLowerCase()) {
    failField('otherParentEmail', 'The other parent needs their own email.');
  }
  const taken = await rows('SELECT 1 FROM parents WHERE email_lower = ANY($1::text[])', [
    [email.toLowerCase(), otherParentEmail.toLowerCase()],
  ]);
  if (taken.length > 0) fail('email_taken');

  return transaction(async (client) => {
    const householdId = await nextId(client);
    await client.query('INSERT INTO households (id, name, currency) VALUES ($1, $2, $3)', [
      householdId,
      householdName,
      currency,
    ]);
    const planningId = await nextId(client);
    const otherId = await nextId(client);
    await client.query(
      `INSERT INTO parents (id, household_id, role, name, email, email_lower, password_hash, joined)
       VALUES ($1, $2, 'planning', $3, $4, $5, $6, true)`,
      [planningId, householdId, yourName, email, email.toLowerCase(), hashPassword(password)],
    );
    await client.query(
      `INSERT INTO parents (id, household_id, role, name, email, email_lower, password_hash, joined)
       VALUES ($1, $2, 'other', $3, $4, $5, null, false)`,
      [otherId, householdId, otherParentName, otherParentEmail, otherParentEmail.toLowerCase()],
    );
    await appendLog(client, householdId, 'planning', 'household.created', householdId);
    const token = await openSession(client, planningId);
    return {
      status: 201,
      json: { householdId, userId: planningId, role: 'planning', token },
    };
  }).catch((error: unknown) => {
    // two households created at once with the same email meet the unique constraint
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) fail('email_taken');
    throw error;
  });
}

export async function signIn(ctx: Ctx): Promise<ApiResponse> {
  const email = ctx.text('email', 'Use at most 254 characters.', { min: 1, max: 254 });
  const password = ctx.text('password', 'Use 12 to 128 characters.', { min: 1, max: 128 });
  const emailLower = email.toLowerCase();
  // One attempt per email at a time: the count, the check and the failure record are a single step, so
  // parallel wrong passwords cannot all read a count below the limit.
  const outcome = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`signin:${emailLower}`]);
    const window = (
      await client.query(
        `SELECT at FROM signin_failures WHERE email_lower = $1 AND at > clock_timestamp() - make_interval(secs => $2) ORDER BY at ASC`,
        [emailLower, SIGN_IN_WINDOW_SECONDS],
      )
    ).rows;
    if (window.length >= SIGN_IN_FAILURE_LIMIT) {
      const oldest = (window[0] as { at: Date }).at.getTime();
      return { blockedFor: Math.max(1, Math.ceil((oldest + SIGN_IN_WINDOW_SECONDS * 1000 - Date.now()) / 1000)) };
    }
    const parent = (
      await client.query(
        'SELECT id::text AS id, household_id::text AS household_id, role, password_hash FROM parents WHERE email_lower = $1',
        [emailLower],
      )
    ).rows[0] as { id: string; role: string; password_hash: string | null } | undefined;
    if (!parent || !passwordMatches(password, parent.password_hash)) {
      await client.query('INSERT INTO signin_failures (email_lower, at) VALUES ($1, clock_timestamp())', [emailLower]);
      return { refused: true };
    }
    return { userId: parent.id, role: parent.role, token: await openSession(client, parent.id) };
  });
  if ('blockedFor' in outcome) throw new ApiError('too_many_attempts', { retryAfterSeconds: outcome.blockedFor });
  if ('refused' in outcome) fail('invalid_credentials');
  return { status: 200, json: { userId: outcome.userId, role: outcome.role, token: outcome.token } };
}

export async function signOut(ctx: Ctx): Promise<ApiResponse> {
  await rows('DELETE FROM sessions WHERE token_hash = $1', [hashToken(ctx.user.token)]);
  return { status: 204 };
}

export async function me(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const versions = await loadVersions(household.id);
  const zone = householdZone(versions, ctx.now);
  return {
    status: 200,
    json: {
      userId: ctx.user.parentId,
      name: ctx.user.role === 'planning' ? household.planning.name : household.other.name,
      role: ctx.user.role,
      household: {
        id: household.id,
        name: household.name,
        planningName: household.planning.name,
        otherName: household.other.name,
        otherJoined: household.other.joined,
        today: householdToday(versions, ctx.now),
        zone,
        currency: household.currency,
        currencyExponent: currencyExponent(household.currency),
      },
    },
  };
}

export async function sendInvite(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  if (household.other.joined) fail('already_joined');
  return inHousehold(household.id, async (client) => {
    await client.query('UPDATE invites SET dead = true WHERE household_id = $1 AND used_at IS NULL', [household.id]);
    await supersedeQueuedInvites(client, household.id);
    const token = newToken();
    const inviteId = await nextId(client);
    await client.query(
      `INSERT INTO invites (id, household_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [inviteId, household.id, hashToken(token), String(config.inviteTtlSeconds)],
    );
    const [noticeId] = await queueNotices(client, household, [inviteNotice(household, token)]);
    await appendLog(client, household.id, ctx.user.role, 'invite.sent', inviteId);
    return { status: 202, json: { noticeId: noticeId as string } };
  });
}

export async function readInvite(ctx: Ctx): Promise<ApiResponse> {
  const token = ctx.params.token as string;
  const found = await one(
    `SELECT h.name AS household_name, p.name AS other_name
     FROM invites i
     JOIN households h ON h.id = i.household_id
     JOIN parents p ON p.household_id = i.household_id AND p.role = 'other'
     WHERE i.token_hash = $1 AND i.dead = false AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );
  if (!found) fail('not_found');
  return {
    status: 200,
    json: { householdName: found.household_name as string, otherParentName: found.other_name as string },
  };
}

export async function joinHousehold(ctx: Ctx): Promise<ApiResponse> {
  const token = ctx.text('token', 'This value is out of range.', { min: 1, max: 200 });
  const password = ctx.text('password', 'Use 12 to 128 characters.', { min: 12, max: 128 });
  return transaction(async (client) => {
    // Lock the household before touching its invites, the same order an invite send takes.
    const invited = await client.query('SELECT household_id::text AS household_id FROM invites WHERE token_hash = $1', [
      hashToken(token),
    ]);
    const invitedHousehold = invited.rows[0] as { household_id: string } | undefined;
    if (!invitedHousehold) fail('not_found');
    await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [invitedHousehold.household_id]);
    const claimed = await client.query(
      `UPDATE invites SET used_at = now()
       WHERE token_hash = $1 AND dead = false AND used_at IS NULL AND expires_at > now()
       RETURNING household_id::text AS household_id`,
      [hashToken(token)],
    );
    const row = claimed.rows[0] as { household_id: string } | undefined;
    if (!row) fail('not_found');
    const householdId = row.household_id;
    const parent = await client.query(
      `UPDATE parents SET password_hash = $2, joined = true
       WHERE household_id = $1 AND role = 'other' RETURNING id::text AS id`,
      [householdId, hashPassword(password)],
    );
    const parentId = (parent.rows[0] as { id: string }).id;
    await appendLog(client, householdId, 'other', 'household.joined', parentId);
    const sessionToken = await openSession(client, parentId);
    return {
      status: 200,
      json: { householdId, userId: parentId, role: 'other', token: sessionToken },
    };
  });
}

export async function requireHousehold(ctx: Ctx): Promise<Household> {
  const householdId = knownIdOrNotFound(ctx.params.hid ?? ctx.user.householdId);
  if (householdId !== ctx.user.householdId) fail('not_found');
  const household = await loadHousehold(householdId);
  if (!household) fail('not_found');
  return household;
}
