import { M } from '../../shared/messages';
import { config } from '../config';
import { query } from '../db';
import { ApiError } from '../errors';
import {
  clearedSessionCookie,
  sendEmpty,
  sendJson,
  sessionCookie,
  SESSION_COOKIE,
  type RequestContext,
  type Router,
} from '../http';
import { assertMailReachable, sendConfirmation, sendReset } from '../mail';
import {
  consumeToken,
  createSession,
  endAllSessions,
  inspectToken,
  endSession,
  hashPassword,
  newId,
  playerShape,
  requirePlayer,
  token,
  verifyPassword,
  type PlayerRow,
} from '../players';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(body: unknown, name: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

function fail(fields: Record<string, string>): never {
  throw new ApiError('VALIDATION', { fields });
}

async function emailTaken(email: string): Promise<boolean> {
  const found = await query('select 1 from players where email_lower = $1', [email.toLowerCase()]);
  return (found.rowCount ?? 0) > 0;
}

async function nameTaken(name: string): Promise<boolean> {
  const found = await query('select 1 from players where display_name_lower = $1', [
    name.toLowerCase(),
  ]);
  return (found.rowCount ?? 0) > 0;
}

/** A confirmation token exists only once Mailpit has accepted its message. */
async function deliverConfirmation(player: PlayerRow, origin: string): Promise<boolean> {
  const value = token();
  try {
    await sendConfirmation(player.email, origin, value);
  } catch {
    return false;
  }
  const expires = new Date(Date.now() + config.verifyTtlMinutes * 60_000);
  await query(
    'insert into auth_tokens (token, player_id, kind, expires_at) values ($1, $2, $3, $4)',
    [value, player.id, 'verify', expires.toISOString()],
  );
  return true;
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/signup', async (context: RequestContext) => {
    const email = field(context.body, 'email').trim();
    const displayName = field(context.body, 'display_name').trim();
    const password = field(context.body, 'password');
    const fields: Record<string, string> = {};
    if (!EMAIL_PATTERN.test(email)) fields.email = M.emailFormat;
    else if (await emailTaken(email)) fields.email = M.emailTaken;
    if (displayName.length < 3 || displayName.length > 20) fields.display_name = M.displayNameLength;
    else if (await nameTaken(displayName)) fields.display_name = M.displayNameTaken;
    if (password.length < 10) fields.password = M.passwordLength;
    if (Object.keys(fields).length > 0) fail(fields);

    const inserted = await query<PlayerRow>(
      `insert into players
         (id, email, email_lower, display_name, display_name_lower, password_hash, verified)
       values ($1, $2, $3, $4, $5, $6, false)
       returning id, email, display_name, verified`,
      [
        newId(),
        email,
        email.toLowerCase(),
        displayName,
        displayName.toLowerCase(),
        await hashPassword(password),
      ],
    );
    const player = inserted.rows[0] as PlayerRow;
    const session = await createSession(player.id);
    const sent = await deliverConfirmation(player, context.origin);
    sendJson(
      context.res,
      201,
      { player: playerShape(player), verification_sent: sent },
      { 'set-cookie': sessionCookie(session) },
    );
  });

  router.post('/api/auth/signin', async (context: RequestContext) => {
    const email = field(context.body, 'email').trim().toLowerCase();
    const password = field(context.body, 'password');
    const found = await query<PlayerRow & { password_hash: string }>(
      'select id, email, display_name, verified, password_hash from players where email_lower = $1',
      [email],
    );
    const row = found.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new ApiError('BAD_CREDENTIALS');
    }
    const session = await createSession(row.id);
    sendJson(context.res, 200, { player: playerShape(row) }, { 'set-cookie': sessionCookie(session) });
  });

  router.post('/api/auth/signout', async (context: RequestContext) => {
    const value = context.cookies[SESSION_COOKIE];
    if (value) await endSession(value);
    sendEmpty(context.res, 204, { 'set-cookie': clearedSessionCookie() });
  });

  router.get('/api/me', async (context: RequestContext) => {
    const player = await requirePlayer(context);
    sendJson(context.res, 200, { player: playerShape(player) });
  });

  router.post('/api/auth/verify/resend', async (context: RequestContext) => {
    const player = await requirePlayer(context);
    assertMailReachable();
    if (player.verified) throw new ApiError('ALREADY_VERIFIED');
    const sent = await deliverConfirmation(player, context.origin);
    if (!sent) throw new ApiError('MAIL_UNAVAILABLE');
    sendJson(context.res, 202, { sent: true });
  });

  router.post('/api/auth/verify', async (context: RequestContext) => {
    const value = field(context.body, 'token');
    const playerId = await inspectToken(value, 'verify');
    await consumeToken(value);
    const updated = await query<PlayerRow>(
      'update players set verified = true where id = $1 returning id, email, display_name, verified',
      [playerId],
    );
    const player = updated.rows[0] as PlayerRow;
    sendJson(context.res, 200, { player: { display_name: player.display_name, verified: true } });
  });

  router.post('/api/auth/reset', async (context: RequestContext) => {
    assertMailReachable();
    const email = field(context.body, 'email').trim();
    if (!EMAIL_PATTERN.test(email)) fail({ email: M.emailFormat });
    const found = await query<PlayerRow>(
      'select id, email, display_name, verified from players where email_lower = $1',
      [email.toLowerCase()],
    );
    const player = found.rows[0];
    if (player) {
      const value = token();
      await sendReset(player.email, context.origin, value);
      const expires = new Date(Date.now() + config.resetTtlMinutes * 60_000);
      await query(
        'insert into auth_tokens (token, player_id, kind, expires_at) values ($1, $2, $3, $4)',
        [value, player.id, 'reset', expires.toISOString()],
      );
    }
    sendJson(context.res, 202, { sent: true });
  });

  router.post('/api/auth/reset/confirm', async (context: RequestContext) => {
    const value = field(context.body, 'token');
    const playerId = await inspectToken(value, 'reset');
    const password = field(context.body, 'password');
    if (password.length < 10) fail({ password: M.passwordLength });
    await consumeToken(value);
    const updated = await query<PlayerRow>(
      'update players set password_hash = $2 where id = $1 returning id, email, display_name, verified',
      [playerId, await hashPassword(password)],
    );
    const player = updated.rows[0] as PlayerRow;
    await endAllSessions(player.id);
    const session = await createSession(player.id);
    sendJson(context.res, 200, { player: playerShape(player) }, { 'set-cookie': sessionCookie(session) });
  });
}
