import { copy } from './copy.js';
import type { MailPort } from './mail.js';
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { Ctx } from './http.js';
import { setCookie, sendJson, sendEmpty } from './http.js';
import { ApiError, errors } from './errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { id, randomToken, friendCode, utcDayKey } from './util.js';
import { validateSignup, storeDown } from './validate.js';
import { writePair } from './ledger.js';
import { loadPlayer, sessionPlayer, type PlayerRow } from './players.js';
import { DEFAULT_SETTINGS, type SessionPlayer } from '../shared/types.js';
import { xpToNext, SIGNUP_GRANT_COINS, REFILL_THRESHOLD, REFILL_COINS, REFILLS_PER_DAY, DAILY_REWARD_COINS } from '../shared/game.js';
import { logger } from './logger.js';

export const SESSION_COOKIE = 'hs_session';

export interface AuthDeps {
  db: Db;
  config: Config;
  mail: MailPort;
  onMeChange: (playerId: string) => void;
}

export function publicOrigin(config: Config, ctx: Ctx): string {
  if (config.publicUrl) return config.publicUrl;
  const proto = ctx.req.headers['x-forwarded-proto'] ?? 'http';
  const host = ctx.req.headers.host ?? `localhost:${config.port}`;
  return `${proto}://${host}`;
}

export async function meBody(db: Db, playerId: string): Promise<Record<string, unknown>> {
  const client = await db.pool.connect();
  try {
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    return fullMe(player);
  } finally {
    client.release();
  }
}

export function fullMe(player: PlayerRow): Record<string, unknown> {
  const session = sessionPlayer(player);
  const wins = player.wins;
  const losses = player.losses;
  const winRate = wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 1000) / 10;
  return {
    ...session,
    xpToNext: xpToNext(player.level),
    wins,
    losses,
    winRate,
    winStreak: player.win_streak,
    highestPot: Number(player.highest_pot),
    equippedCueId: player.equipped_cue_id,
    equippedClothId: player.equipped_cloth_id,
    dailyRewardClaimed: player.daily_claimed_day === utcDayKey(),
    refillsLeft: Math.max(0, REFILLS_PER_DAY - (player.refills_day === utcDayKey() ? player.refills_used : 0)),
    mailDelayed: false,
    activeTableUrl: null,
    friendCode: player.friend_code,
    settings: player.settings,
  };
}

export async function refreshCachedBalances(db: Db, playerId: string): Promise<void> {
  const client = await db.pool.connect();
  try {
    const coins = await balanceOf(client, playerId, 'coins');
    const cash = await balanceOf(client, playerId, 'cash');
    await client.query(`UPDATE players SET coins = $2, cash = $3 WHERE id = $1`, [playerId, coins, cash]);
  } finally {
    client.release();
  }
}

async function balanceOf(client: { query: Db['query'] }, playerId: string, currency: 'coins' | 'cash'): Promise<number> {
  const res = await client.query<{ sum: string }>(
    `SELECT COALESCE(SUM(amount),0) AS sum FROM ledger_lines WHERE player_id = $1 AND currency = $2 AND account = 'wallet'`,
    [playerId, currency]
  );
  return Number(res.rows[0]?.sum ?? 0);
}

export async function signup(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const body = ctx.body as Record<string, unknown>;
  const currentYear = new Date().getUTCFullYear();
  const input = {
    email: typeof body.email === 'string' ? body.email : '',
    password: typeof body.password === 'string' ? body.password : '',
    displayName: typeof body.displayName === 'string' ? body.displayName : '',
    birthYear: typeof body.birthYear === 'number' ? body.birthYear : Number.NaN,
  };
  const check = await validateSignup(input, currentYear);
  if (!check.ok) throw errors.validation(check.fields);
  const age = currentYear - check.value.birthYear;
  if (age < 13) throw new ApiError(403, 'under_age', copy.underAge);

  const playerId = id('player');
  const sessionId = id('sess');
  const settings = DEFAULT_SETTINGS;

  await deps.db.tx(async (client) => {
    const existing = await client.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL`, [check.value.email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ApiError(409, 'email_taken', copy.emailTaken);
    }
    await client.query(
      `INSERT INTO players (id, email, password_hash, display_name, birth_year, minor, email_verified, level, xp, coins, cash,
         friend_code, settings, verify_token)
       VALUES ($1,$2,$3,$4,$5,$6,false,1,0,$7,0,$8,$9::jsonb,$10)`,
      [playerId, check.value.email, hashPassword(check.value.password), check.value.displayName, check.value.birthYear, age < 18,
        SIGNUP_GRANT_COINS, friendCode(), JSON.stringify(settings), randomToken(24)]
    );
    await client.query(
      `INSERT INTO item_owners (player_id, item_id) VALUES ($1,'cue-starter'), ($1,'cloth-hall-blue') ON CONFLICT DO NOTHING`,
      [playerId]
    );
    await client.query(`UPDATE players SET equipped_cue_id = 'cue-starter', equipped_cloth_id = 'cloth-hall-blue' WHERE id = $1`, [playerId]);
    await writePair(client, {
      kind: 'opening_balance',
      refId: playerId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'system', amount: -SIGNUP_GRANT_COINS },
        { playerId, currency: 'coins', account: 'wallet', amount: SIGNUP_GRANT_COINS },
      ],
    });
    await client.query(`INSERT INTO sessions (id, player_id) VALUES ($1,$2)`, [sessionId, playerId]);
  });

  setCookie(ctx, SESSION_COOKIE, sessionId, { HttpOnly: '', SameSite: 'Lax', Path: '/' });

  // Sign-up never waits on mail.
  void enqueueVerification(deps, ctx, playerId, check.value.email).catch((err) => logger.warn(`verification enqueue failed: ${(err as Error).message}`));

  const player = await loadPlayerRow(deps.db, playerId);
  sendJson(ctx, 201, sessionPlayer(player));
}

async function enqueueVerification(deps: AuthDeps, ctx: Ctx, playerId: string, email: string): Promise<'sent' | 'failed'> {
  const origin = publicOrigin(deps.config, ctx);
  const row = await deps.db.query<{ verify_token: string }>(`SELECT verify_token FROM players WHERE id = $1`, [playerId]);
  const token = row.rows[0]?.verify_token ?? '';
  return deps.mail.send({
    playerId,
    to: email,
    subject: 'Verify your Long Rail email',
    body: `Verify your email to buy Cash packs:\n\n${origin}/verify?token=${token}\n\nLong Rail Headstring`,
    kind: 'verification',
  });
}

async function loadPlayerRow(db: Db, playerId: string): Promise<PlayerRow> {
  const client = await db.pool.connect();
  try {
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    return player;
  } finally {
    client.release();
  }
}

export async function signin(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const body = ctx.body as { email?: string; password?: string };
  const emailKey = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  const recent = await deps.db.query(
    `SELECT COUNT(*)::int AS n FROM signin_attempts WHERE email_key = $1 AND created_at > now() - interval '60 seconds'`,
    [emailKey]
  );
  const failedCount = recent.rows[0]?.n ?? 0;
  if (failedCount >= 5) {
    throw new ApiError(429, 'rate_limited', copy.rateLimited, undefined, { 'Retry-After': '60' });
  }

  const res = await deps.db.query<PlayerRow & { password_hash: string }>(
    `SELECT * FROM players WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [emailKey]
  );
  const player = res.rows[0];
  const valid = player ? verifyPassword(password, player.password_hash) : false;
  if (!player || !valid) {
    await deps.db.query(`INSERT INTO signin_attempts (email_key) VALUES ($1)`, [emailKey]);
    throw new ApiError(401, 'invalid_credentials', copy.badSignIn);
  }

  const sessionId = id('sess');
  await deps.db.query(`INSERT INTO sessions (id, player_id) VALUES ($1,$2)`, [sessionId, player.id]);
  await refreshCachedBalances(deps.db, player.id);
  setCookie(ctx, SESSION_COOKIE, sessionId, { HttpOnly: '', SameSite: 'Lax', Path: '/' });
  const fresh = await loadPlayerRow(deps.db, player.id);
  sendJson(ctx, 200, sessionPlayer(fresh));
}

export async function signout(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies[SESSION_COOKIE];
  if (sessionId) {
    await deps.db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }
  setCookie(ctx, SESSION_COOKIE, '', { HttpOnly: '', SameSite: 'Lax', Path: '/', 'Max-Age': '0' });
  sendEmpty(ctx, 204);
}

export async function resendVerification(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies[SESSION_COOKIE];
  const session = sessionId ? await deps.db.query<{ player_id: string }>(`SELECT player_id FROM sessions WHERE id = $1`, [sessionId]) : null;
  const playerId = session?.rows[0]?.player_id;
  if (!playerId) throw errors.unauthenticated();
  const player = await loadPlayerRow(deps.db, playerId);
  if (player.email_verified) throw new ApiError(409, 'already_verified', 'Your email is already verified.');
  const token = randomToken(24);
  await deps.db.query(`UPDATE players SET verify_token = $2, verify_token_at = now() WHERE id = $1`, [playerId, token]);
  const result = await enqueueVerification(deps, ctx, playerId, player.email);
  if (result === 'failed') throw errors.mailUnavailable();
  sendJson(ctx, 202, { status: 'sent' });
}

export async function verify(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const body = ctx.body as { token?: string };
  const token = body.token ?? '';
  const res = await deps.db.query<{ id: string }>(`SELECT id FROM players WHERE verify_token = $1 AND deleted_at IS NULL`, [token]);
  const player = res.rows[0];
  if (!player || player.id === '') throw new ApiError(410, 'link_invalid', copy.linkInvalid);
  await deps.db.query(`UPDATE players SET email_verified = true, verify_token = NULL WHERE id = $1`, [player.id]);
  sendJson(ctx, 200, { emailVerified: true });
}

export async function getMe(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const client = await deps.db.pool.connect();
  try {
    const player = await loadPlayer(client, playerId);
    if (!player) throw errors.unauthenticated();
    const pending = await client.query(`SELECT 1 FROM mail_outbox WHERE player_id = $1 AND status = 'pending' LIMIT 1`, [playerId]);
    const activeTable = await client.query<{ id: string; kind: string }>(
      `SELECT id, kind FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`,
      [playerId]
    );
    const body = fullMe(player);
    body.mailDelayed = (pending.rowCount ?? 0) > 0;
    body.activeTableUrl = activeTable.rows[0]?.id ? `/table/${activeTable.rows[0].id}` : null;
    sendJson(ctx, 200, body);
  } finally {
    client.release();
  }
}

export async function requirePlayerId(db: Db, ctx: Ctx): Promise<string> {
  const sessionId = ctx.cookies[SESSION_COOKIE];
  if (!sessionId) throw errors.unauthenticated();
  const res = await db.query<{ player_id: string }>(
    `SELECT s.player_id FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.id = $1 AND p.deleted_at IS NULL`,
    [sessionId]
  );
  const playerId = res.rows[0]?.player_id;
  if (!playerId) throw errors.unauthenticated();
  return playerId;
}

export async function sessionIdOf(ctx: Ctx): Promise<string | null> {
  return ctx.cookies[SESSION_COOKIE] ?? null;
}

export async function claimDaily(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const day = utcDayKey();
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const res = await client.query<{ daily_claimed_day: string | null }>(`SELECT daily_claimed_day FROM players WHERE id = $1`, [playerId]);
    if (res.rows[0]?.daily_claimed_day === day) {
      throw new ApiError(409, 'daily_claimed', copy.dailyAlready);
    }
    await writePair(client, {
      kind: 'daily_reward',
      refId: playerId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'system', amount: -DAILY_REWARD_COINS },
        { playerId, currency: 'coins', account: 'wallet', amount: DAILY_REWARD_COINS },
      ],
    });
    await client.query(`UPDATE players SET daily_claimed_day = $2 WHERE id = $1`, [playerId, day]);
  });
  const coins = await refreshAndBalance(deps.db, playerId, 'coins');
  deps.onMeChange(playerId);
  sendJson(ctx, 200, { coins });
}

export async function refill(deps: AuthDeps, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(deps.db, ctx);
  const day = utcDayKey();
  let refillsLeft = 0;
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const res = await client.query<{ refills_day: string | null; refills_used: number }>(
      `SELECT refills_day, refills_used FROM players WHERE id = $1`, [playerId]
    );
    const row = res.rows[0];
    const usedToday = row?.refills_day === day ? row.refills_used : 0;
    const coins = await balanceOf(client, playerId, 'coins');
    if (coins >= REFILL_THRESHOLD) {
      throw new ApiError(409, 'refill_not_needed', copy.refillNotNeeded);
    }
    if (usedToday >= REFILLS_PER_DAY) {
      throw new ApiError(409, 'refill_limit', copy.refillNone);
    }
    await writePair(client, {
      kind: 'refill',
      refId: playerId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'system', amount: -REFILL_COINS },
        { playerId, currency: 'coins', account: 'wallet', amount: REFILL_COINS },
      ],
    });
    refillsLeft = REFILLS_PER_DAY - usedToday - 1;
    await client.query(`UPDATE players SET refills_day = $2, refills_used = $3 WHERE id = $1`, [playerId, day, usedToday + 1]);
  });
  const coins = await refreshAndBalance(deps.db, playerId, 'coins');
  deps.onMeChange(playerId);
  sendJson(ctx, 200, { coins, refillsLeft });
}

async function refreshAndBalance(db: Db, playerId: string, currency: 'coins' | 'cash'): Promise<number> {
  await refreshCachedBalances(db, playerId);
  const res = await db.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1`, [playerId]);
  return Number(res.rows[0]?.[currency] ?? 0);
}

export { storeDown };
