import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { REFILL_LIMIT } from '../shared/catalog.js';
import { xpToLeaveLevel } from '../shared/catalog.js';
import { queryOne, type Queryable } from './db.js';

const scrypt = promisify(scryptCallback);

export interface PlayerRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  birth_year: number;
  level: number;
  xp: number;
  coins: string | number;
  cash: string | number;
  email_verified: boolean;
  minor: boolean;
  wins: number;
  losses: number;
  win_streak: number;
  highest_pot: string | number;
  weekly_wins: number;
  week_start: Date | null;
  last_win_at: Date | null;
  equipped_cue_id: string | null;
  equipped_cloth_id: string | null;
  friend_code: string | null;
  daily_claim_date: Date | null;
  refill_date: Date | null;
  refill_count: number;
  settings: Record<string, unknown>;
  seeded: boolean;
  deleted: boolean;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  aimSensitivity: number;
  leftHanded: boolean;
  reducedMotion: boolean;
  theme: 'light' | 'dark' | 'system';
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: true,
  aimSensitivity: 5,
  leftHanded: false,
  reducedMotion: false,
  theme: 'dark',
};

export function settingsOf(row: PlayerRow): Settings {
  const stored = row.settings ?? {};
  return {
    sound: typeof stored.sound === 'boolean' ? stored.sound : DEFAULT_SETTINGS.sound,
    music: typeof stored.music === 'boolean' ? stored.music : DEFAULT_SETTINGS.music,
    aimSensitivity: typeof stored.aimSensitivity === 'number' ? stored.aimSensitivity : DEFAULT_SETTINGS.aimSensitivity,
    leftHanded: typeof stored.leftHanded === 'boolean' ? stored.leftHanded : DEFAULT_SETTINGS.leftHanded,
    reducedMotion: typeof stored.reducedMotion === 'boolean' ? stored.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    theme: stored.theme === 'light' || stored.theme === 'system' ? stored.theme : 'dark',
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const derived = (await scrypt(password, Buffer.from(saltHex, 'hex'), 32)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function utcDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function weekStart(date = new Date()): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = copy.getUTCDay();
  const back = weekday === 0 ? 6 : weekday - 1;
  copy.setUTCDate(copy.getUTCDate() - back);
  return copy.toISOString().slice(0, 10);
}

export function refillsLeft(row: PlayerRow): number {
  const today = utcDate();
  const stored = row.refill_date ? new Date(row.refill_date).toISOString().slice(0, 10) : null;
  if (stored !== today) return REFILL_LIMIT;
  return Math.max(0, REFILL_LIMIT - row.refill_count);
}

export function dailyClaimed(row: PlayerRow): boolean {
  const stored = row.daily_claim_date ? new Date(row.daily_claim_date).toISOString().slice(0, 10) : null;
  return stored === utcDate();
}

export function winRateOf(row: PlayerRow): number {
  const played = row.wins + row.losses;
  if (played === 0) return 0;
  return Math.round((row.wins / played) * 1000) / 10;
}

export function sessionBody(row: PlayerRow): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    level: row.level,
    xp: row.xp,
    coins: Number(row.coins),
    cash: Number(row.cash),
    emailVerified: row.email_verified,
    minor: row.minor,
  };
}

export async function meBody(row: PlayerRow): Promise<Record<string, unknown>> {
  const mail = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM mail_outbox WHERE player_id = $1 AND delivered = FALSE`,
    [row.id],
  );
  const table = await queryOne<{ id: string }>(
    `SELECT id FROM matches
      WHERE (seat1 = $1 OR seat2 = $1) AND status IN ('escrowed','in_play','waiting')
      ORDER BY created_at DESC LIMIT 1`,
    [row.id],
  );
  return {
    ...sessionBody(row),
    xpToNext: xpToLeaveLevel(row.level),
    wins: row.wins,
    losses: row.losses,
    winRate: winRateOf(row),
    winStreak: row.win_streak,
    highestPot: Number(row.highest_pot),
    equippedCueId: row.equipped_cue_id,
    equippedClothId: row.equipped_cloth_id,
    dailyRewardClaimed: dailyClaimed(row),
    refillsLeft: refillsLeft(row),
    mailDelayed: Number(mail?.count ?? '0') > 0,
    activeTableUrl: table ? `/table/${table.id}` : null,
    friendCode: row.friend_code,
    settings: settingsOf(row),
  };
}

export async function loadPlayer(id: string): Promise<PlayerRow | null> {
  return queryOne<PlayerRow>(`SELECT * FROM players WHERE id = $1 AND deleted = FALSE`, [id]);
}

export async function newFriendCode(client: Queryable): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    const bytes = randomBytes(8);
    for (let index = 0; index < 8; index += 1) {
      code += alphabet[(bytes[index] as number) % alphabet.length];
    }
    const existing = await client.query(`SELECT 1 FROM players WHERE friend_code = $1`, [code]);
    if (existing.rows.length === 0) return code;
  }
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}
