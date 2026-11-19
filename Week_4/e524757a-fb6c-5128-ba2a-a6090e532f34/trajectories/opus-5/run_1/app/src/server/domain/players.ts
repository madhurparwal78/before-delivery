import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { isLand, SPOTS, type Heading } from '../../shared/islands.js';
import { config } from '../config.js';
import { query, type Queryable } from '../db.js';
import { filmCount, FULL_FILM, recordFilmChange, setFilm } from './film.js';
import { lighthouseState, stampCount } from './albums.js';

export type PlayerRow = {
  id: string;
  world_id: string;
  name: string;
  handle: string;
  email: string;
  password_hash: string;
  confirmed: boolean;
  ranger: boolean;
  confirm_code: string | null;
  confirm_expires_at: Date | null;
  island: number;
  tile_x: number;
  tile_y: number;
  heading: Heading;
  music: number;
  effects: number;
  graphics: string;
};

export type PublicPlayer = {
  id: string;
  name: string;
  handle: string;
  confirmed: boolean;
  ranger: boolean;
  email?: string;
};

export function publicPlayer(row: PlayerRow, own: boolean): PublicPlayer {
  const base = { id: row.id, name: row.name, handle: row.handle, confirmed: row.confirmed, ranger: row.ranger };
  return own ? { ...base, email: row.email } : base;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.byteLength);
  return timingSafeEqual(expected, actual);
}

export function confirmationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 40) throw new ApiError('bad_name');
  return value.trim();
}

export function checkEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) throw new ApiError('bad_email');
  return value.trim().toLowerCase();
}

export function checkPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw new ApiError('bad_password');
  return value;
}

export function slugOf(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base.length > 0 ? base : 'explorer';
}

export async function createPlayer(
  db: Queryable,
  options: {
    worldId: string;
    name: string;
    email: string;
    password: string;
    confirmed?: boolean;
    ranger?: boolean;
    code?: string | null;
  },
): Promise<PlayerRow> {
  const id = randomUUID();
  const handle = `${slugOf(options.name)}-${randomBytes(3).toString('hex')}`;
  const expires = options.code ? new Date(Date.now() + config.confirmCodeTtlSeconds * 1000) : null;
  let inserted;
  try {
    inserted = await db.query<PlayerRow>(
      `INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger, confirm_code, confirm_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        options.worldId,
        options.name,
        handle,
        options.email,
        hashPassword(options.password),
        options.confirmed ?? false,
        options.ranger ?? false,
        options.code ?? null,
        expires,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError('email_taken');
    throw error;
  }
  await db.query('INSERT INTO halls (player_id, public) VALUES ($1, false)', [id]);
  await recordFilmChange(db, id, FULL_FILM, 'start');
  return inserted.rows[0];
}

export async function playerByEmail(db: Queryable, email: string): Promise<PlayerRow | null> {
  const found = await db.query<PlayerRow>('SELECT * FROM players WHERE email = $1', [email]);
  return found.rows[0] ?? null;
}

export async function startSession(db: Queryable, playerId: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await db.query('INSERT INTO sessions (id, player_id) VALUES ($1, $2)', [id, playerId]);
  return id;
}

export async function playerBySession(sessionId: string): Promise<PlayerRow | null> {
  const found = await query<PlayerRow>(
    'SELECT players.* FROM sessions JOIN players ON players.id = sessions.player_id WHERE sessions.id = $1',
    [sessionId],
  );
  return found.rows[0] ?? null;
}

export async function endSession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export type Progress = {
  position: { island: number; tile: [number, number]; heading: Heading };
  film: number;
  stamps: number;
  lighthouse: 'open' | 'closed';
};

export async function progressOf(db: Queryable, player: PlayerRow): Promise<Progress> {
  const stamps = await stampCount(db, player.id);
  return {
    position: { island: player.island, tile: [player.tile_x, player.tile_y], heading: player.heading },
    film: await filmCount(db, player.id),
    stamps,
    lighthouse: lighthouseState(stamps),
  };
}

export async function savePosition(
  db: Queryable,
  playerId: string,
  island: number,
  x: number,
  y: number,
  heading: Heading,
): Promise<void> {
  if (!isLand(island, x, y)) throw new ApiError('not_land');
  await db.query('UPDATE players SET island = $2, tile_x = $3, tile_y = $4, heading = $5 WHERE id = $1', [
    playerId,
    island,
    x,
    y,
    heading,
  ]);
}

export async function refillFilm(db: Queryable, player: PlayerRow): Promise<number> {
  if (player.island !== 1) throw new ApiError('not_at_harbour');
  const current = await filmCount(db, player.id);
  if (current >= FULL_FILM) throw new ApiError('film_full');
  return setFilm(db, player.id, FULL_FILM, 'refill');
}

export async function restartExpedition(db: Queryable, player: PlayerRow): Promise<Progress> {
  await db.query('DELETE FROM album_pages WHERE player_id = $1', [player.id]);
  await db.query('DELETE FROM stamps WHERE player_id = $1', [player.id]);
  await setFilm(db, player.id, FULL_FILM, 'restart');
  const spot = SPOTS[0];
  await db.query('UPDATE players SET island = 1, tile_x = $2, tile_y = $3, heading = $4 WHERE id = $1', [
    player.id,
    spot.tile.x,
    spot.tile.y,
    spot.heading,
  ]);
  return {
    position: { island: 1, tile: [spot.tile.x, spot.tile.y], heading: spot.heading },
    film: FULL_FILM,
    stamps: 0,
    lighthouse: 'closed',
  };
}

export type Settings = { music: number; effects: number; graphics: 'full' | 'balanced' | 'light' };

export function settingsOf(player: PlayerRow): Settings {
  return { music: player.music, effects: player.effects, graphics: player.graphics as Settings['graphics'] };
}

export function checkSettings(body: Record<string, unknown>): Settings {
  const music = body.music;
  const effects = body.effects;
  const graphics = body.graphics;
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 && value % 5 === 0;
  if (!valid(music) || !valid(effects)) throw new ApiError('bad_request');
  if (graphics !== 'full' && graphics !== 'balanced' && graphics !== 'light') throw new ApiError('bad_request');
  return { music, effects, graphics };
}

export async function saveSettings(db: Queryable, playerId: string, settings: Settings): Promise<Settings> {
  await db.query('UPDATE players SET music = $2, effects = $3, graphics = $4 WHERE id = $1', [
    playerId,
    settings.music,
    settings.effects,
    settings.graphics,
  ]);
  return settings;
}
