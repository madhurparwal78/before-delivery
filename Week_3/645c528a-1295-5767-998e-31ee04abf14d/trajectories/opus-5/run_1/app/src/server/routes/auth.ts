import { randomBytes, randomUUID } from 'node:crypto';
import { AUTH_COPY } from '../../shared/copy.js';
import { SIGNUP_GRANT, STARTER_CLOTH_ID, STARTER_CUE_ID } from '../../shared/catalog.js';
import { publicOrigin } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { credit } from '../ledger.js';
import { hashPassword, loadPlayer, newFriendCode, sessionBody, verifyPassword, type PlayerRow } from '../players.js';
import { clearSessionCookie, requireSession, setSessionCookie, startSession, SESSION_COOKIE } from '../session.js';
import { sendVerification } from '../services/mail.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export async function createVerificationToken(playerId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query(`UPDATE verification_tokens SET voided = TRUE WHERE player_id = $1 AND used = FALSE`, [playerId]);
  await query(`INSERT INTO verification_tokens (token, player_id) VALUES ($1, $2)`, [token, playerId]);
  return token;
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/signup', async (ctx: Ctx) => {
    const body = objectBody(ctx);
    const email = stringField(body, 'email').trim().toLowerCase();
    const password = stringField(body, 'password');
    const displayName = stringField(body, 'displayName').trim();
    const birthYearRaw = body.birthYear;
    const birthYear = typeof birthYearRaw === 'number' ? birthYearRaw : Number.parseInt(String(birthYearRaw ?? ''), 10);
    const currentYear = new Date().getUTCFullYear();

    const fields: Record<string, string> = {};
    if (!EMAIL_PATTERN.test(email)) fields.email = AUTH_COPY.email;
    if (password.length < 8 || password.length > 72) fields.password = AUTH_COPY.password;
    if (displayName.length < 2 || displayName.length > 20) fields.displayName = AUTH_COPY.displayName;
    const yearValid = Number.isInteger(birthYear) && birthYear >= 1900 && birthYear <= currentYear;
    if (!yearValid) fields.birthYear = AUTH_COPY.birthYear;

    if (Number.isInteger(birthYear) && currentYear - birthYear < 13) {
      throw new ApiError(403, 'under_age', AUTH_COPY.underAge);
    }
    if (!fields.email) {
      const existing = await queryOne<{ id: string }>(`SELECT id FROM players WHERE email = $1`, [email]);
      if (existing) throw new ApiError(409, 'email_taken', AUTH_COPY.emailTaken);
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

    const age = currentYear - birthYear;
    const minor = age < 18;
    const id = randomUUID();
    const passwordHash = await hashPassword(password);

    const player = await transaction(async (client) => {
      const friendCode = await newFriendCode(client);
      const inserted = await client.query<PlayerRow>(
        `INSERT INTO players (id, email, password_hash, display_name, birth_year, minor, equipped_cue_id, equipped_cloth_id, friend_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, email, passwordHash, displayName, birthYear, minor, STARTER_CUE_ID, STARTER_CLOTH_ID, friendCode],
      );
      await client.query(`INSERT INTO player_items (player_id, item_id) VALUES ($1,$2), ($1,$3)`, [id, STARTER_CUE_ID, STARTER_CLOTH_ID]);
      await credit(client, id, 'coins', SIGNUP_GRANT, 'grant', null);
      const row = inserted.rows[0];
      if (!row) throw new Error('signup insert failed');
      return row;
    });

    const token = await createVerificationToken(id);
    void sendVerification(id, email, token, publicOrigin(ctx.origin));

    const sessionId = await startSession(id);
    setSessionCookie(ctx.res, sessionId);
    const fresh = await loadPlayer(id);
    return { status: 201, body: sessionBody(fresh ?? player) };
  });

  router.post('/api/auth/signin', async (ctx: Ctx) => {
    const body = objectBody(ctx);
    const email = stringField(body, 'email').trim().toLowerCase();
    const password = stringField(body, 'password');

    const failures = await queryOne<{ count: string; first: Date | null }>(
      `SELECT count(*)::text AS count, min(created_at) AS first FROM signin_failures
        WHERE email = $1 AND created_at > now() - interval '60 seconds'`,
      [email],
    );
    if (Number(failures?.count ?? '0') >= 5) {
      const first = failures?.first ? new Date(failures.first).getTime() : Date.now();
      const retryAfter = Math.max(1, Math.ceil((first + 60000 - Date.now()) / 1000));
      throw new ApiError(429, 'rate_limited', AUTH_COPY.rateLimit, { headers: { 'retry-after': String(retryAfter) } });
    }

    const player = await queryOne<PlayerRow>(`SELECT * FROM players WHERE email = $1 AND deleted = FALSE`, [email]);
    const ok = player ? await verifyPassword(password, player.password_hash) : false;
    if (!player || !ok) {
      await query(`INSERT INTO signin_failures (email) VALUES ($1)`, [email]);
      throw new ApiError(401, 'invalid_credentials', AUTH_COPY.badSignIn);
    }
    const sessionId = await startSession(player.id);
    setSessionCookie(ctx.res, sessionId);
    return { status: 200, body: sessionBody(player) };
  });

  router.post('/api/auth/signout', async (ctx: Ctx) => {
    const sessionId = ctx.cookies[SESSION_COOKIE];
    if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
      await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    }
    clearSessionCookie(ctx.res);
    return { status: 204, body: null };
  });

  router.post('/api/auth/resend-verification', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    if (player.email_verified) throw new ApiError(409, 'already_verified', 'That email is already verified.');
    const token = await createVerificationToken(player.id);
    const receipt = await sendVerification(player.id, player.email ?? '', token, publicOrigin(ctx.origin));
    if (receipt === 'delayed') {
      throw new ApiError(503, 'mail_unavailable', 'Could not send mail. Try again soon.');
    }
    return { status: 202, body: { status: 'sent' } };
  });

  router.post('/api/auth/verify', async (ctx: Ctx) => {
    const body = objectBody(ctx);
    const token = stringField(body, 'token');
    const row = await queryOne<{ player_id: string }>(
      `SELECT player_id FROM verification_tokens WHERE token = $1 AND used = FALSE AND voided = FALSE`,
      [token],
    );
    if (!row) throw new ApiError(410, 'link_invalid', 'This link is no longer valid.');
    await query(`UPDATE verification_tokens SET used = TRUE WHERE token = $1`, [token]);
    await query(`UPDATE players SET email_verified = TRUE WHERE id = $1`, [row.player_id]);
    return { status: 200, body: { emailVerified: true } };
  });
}
