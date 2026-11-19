// Player, session and progress queries. The film ledger is the one place film is decided.

import { Db, TxClient, withTransaction } from "./db";
import { newId, makeSessionToken } from "../shared/ids";
import { ErrorCode } from "../shared/errors";
import { ApiError } from "./http";
import { Heading } from "../shared/world";
import { creaturesOfIsland } from "../shared/creatures";

export interface PlayerRow {
  id: string;
  world_id: string;
  name: string;
  handle: string;
  email: string;
  confirmed: boolean;
  ranger: boolean;
}

export async function playerById(db: Db, id: string): Promise<PlayerRow | null> {
  const r = await db.query<PlayerRow>(
    "SELECT id, world_id, name, handle, email, confirmed, ranger FROM players WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function playerByToken(db: Db, token: string | null): Promise<PlayerRow | null> {
  if (!token) return null;
  const r = await db.query<PlayerRow>(
    `SELECT p.id, p.world_id, p.name, p.handle, p.email, p.confirmed, p.ranger
     FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = $1`, [token]);
  return r.rows[0] ?? null;
}

export function playerBody(p: PlayerRow, includeEmail: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { id: p.id, name: p.name, handle: p.handle, confirmed: p.confirmed, ranger: p.ranger };
  if (includeEmail) body.email = p.email;
  return body;
}

export async function createSession(db: Db, playerId: string): Promise<string> {
  const token = makeSessionToken();
  await db.query("INSERT INTO sessions (token, player_id) VALUES ($1, $2)", [token, playerId]);
  return token;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
}

// ---------- film ledger ----------

export type FilmReason = "start" | "photo" | "page" | "refill" | "restart";

/** Every film change writes two rows with one change id: a satchel row and the opposite locker row. */
export async function writeFilm(client: TxClient, playerId: string, amount: number, reason: FilmReason): Promise<void> {
  if (amount === 0) return;
  const changeId = newId("chg");
  await client.query(
    "INSERT INTO film_ledger (player_id, change_id, account, amount, reason) VALUES ($1,$2,'satchel',$3,$4), ($1,$2,'locker',$5,$4)",
    [playerId, changeId, amount, reason, -amount]);
}

export async function filmSatchel(db: Db, playerId: string): Promise<number> {
  const r = await db.query<{ sum: string }>("SELECT COALESCE(SUM(amount),0) AS sum FROM film_ledger WHERE player_id = $1 AND account = 'satchel'", [playerId]);
  return Number(r.rows[0].sum);
}

export async function filmSatchelIn(client: TxClient, playerId: string): Promise<number> {
  const r = await client.query<{ sum: string }>("SELECT COALESCE(SUM(amount),0) AS sum FROM film_ledger WHERE player_id = $1 AND account = 'satchel'", [playerId]);
  return Number(r.rows[0].sum);
}

export async function grantFilm(db: Db, playerId: string, amount: number, reason: FilmReason): Promise<number> {
  return withTransaction(db, async client => {
    await writeFilm(client, playerId, amount, reason);
    return filmSatchelIn(client, playerId);
  });
}

// ---------- position ----------

export interface Position { island: number; tile: [number, number]; heading: Heading }

export async function positionOf(db: Db, playerId: string): Promise<Position> {
  const r = await db.query<{ island: number; x: number; y: number; heading: Heading }>(
    "SELECT island, x, y, heading FROM positions WHERE player_id = $1", [playerId]);
  if (r.rows.length === 0) return { island: 1, tile: [3, 12], heading: "E" };
  const row = r.rows[0];
  return { island: row.island, tile: [row.x, row.y], heading: row.heading };
}

export async function savePosition(db: Db, playerId: string, pos: Position): Promise<void> {
  await db.query(
    `INSERT INTO positions (player_id, island, x, y, heading) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (player_id) DO UPDATE SET island = $2, x = $3, y = $4, heading = $5, updated_at = now()`,
    [playerId, pos.island, pos.tile[0], pos.tile[1], pos.heading]);
}

// ---------- albums and stamps ----------

export interface AlbumPage { creature: string; creature_name: string; filled: boolean; photo_id: string | null; total: number }

export async function albumOf(db: Db, playerId: string, island: number): Promise<AlbumPage[]> {
  const r = await db.query<{ creature_id: string; photo_id: string | null; total: number | null }>(
    "SELECT creature_id, photo_id, total FROM album_pages WHERE player_id = $1", [playerId]);
  const byCreature = new Map(r.rows.map(row => [row.creature_id, row]));
  const pages: AlbumPage[] = [];
  for (const c of creaturesOfIsland(island)) {
    const row = byCreature.get(c.id);
    pages.push({
      creature: c.id,
      creature_name: c.name,
      filled: Boolean(row && row.photo_id),
      photo_id: row?.photo_id ?? null,
      total: row?.total ?? 0
    });
  }
  return pages;
}

export async function stampsCount(db: Db, playerId: string): Promise<number> {
  const r = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM stamps WHERE player_id = $1 AND earned", [playerId]);
  return Number(r.rows[0].n);
}

export async function stampOf(db: Db, playerId: string, island: number): Promise<boolean> {
  const r = await db.query<{ earned: boolean }>("SELECT earned FROM stamps WHERE player_id = $1 AND island = $2", [playerId, island]);
  return r.rows[0]?.earned ?? false;
}

/** Album state after a kept photo; decides page fill, film return and the stamp in one place. */
export async function applyAlbumForPhoto(
  client: TxClient,
  playerId: string,
  creatureId: string,
  island: number,
  photoId: string,
  total: number,
  tick: number
): Promise<{ page_filled: boolean; pages_filled: number; stamp_earned: boolean; film_return: number }> {
  const existing = await client.query<{ photo_id: string | null; total: number | null }>(
    "SELECT photo_id, total FROM album_pages WHERE player_id = $1 AND creature_id = $2", [playerId, creatureId]);
  const row = existing.rows[0];
  let pageFilled = false;
  let filmReturn = 0;
  if (total >= 60 && (!row || !row.photo_id || total > (row.total ?? 0))) {
    pageFilled = !row?.photo_id;
    await client.query(
      `INSERT INTO album_pages (player_id, creature_id, photo_id, total, filled, tick) VALUES ($1,$2,$3,$4,TRUE,$5)
       ON CONFLICT (player_id, creature_id) DO UPDATE SET photo_id = $3, total = $4, filled = TRUE, tick = $5`,
      [playerId, creatureId, photoId, total, tick]);
    if (pageFilled) {
      filmReturn = 6;
      await writeFilm(client, playerId, 6, "page");
    }
  }
  const pagesFilled = await pagesFilledIn(client, playerId, island);
  let stampEarned = false;
  if (pagesFilled === 4) {
    const s = await client.query<{ earned: boolean }>(
      "SELECT earned FROM stamps WHERE player_id = $1 AND island = $2", [playerId, island]);
    if (!s.rows[0]?.earned) {
      await client.query(
        `INSERT INTO stamps (player_id, island, earned) VALUES ($1,$2,TRUE)
         ON CONFLICT (player_id, island) DO UPDATE SET earned = TRUE`, [playerId, island]);
      stampEarned = true;
    }
  }
  return { page_filled: pageFilled, pages_filled: pagesFilled, stamp_earned: stampEarned, film_return: filmReturn };
}

export async function pagesFilledIn(client: TxClient, playerId: string, island: number): Promise<number> {
  const ids = creaturesOfIslandIds(island);
  const r = await client.query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM album_pages WHERE player_id = $1 AND filled AND creature_id = ANY($2)", [playerId, ids]);
  return Number(r.rows[0].n);
}

function creaturesOfIslandIds(island: number): string[] {
  return creaturesOfIsland(island).map(c => c.id);
}

export async function lighthouseOpen(db: Db, playerId: string): Promise<boolean> {
  const r = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM stamps WHERE player_id = $1 AND earned", [playerId]);
  return Number(r.rows[0].n) >= 3;
}

export function requireRanger(p: PlayerRow): void {
  if (!p.ranger) throw new ApiError("not_ranger");
}

export function requireConfirmed(p: PlayerRow): void {
  if (!p.confirmed) throw new ApiError("unconfirmed");
}

export function codeOf(err: unknown): ErrorCode | undefined {
  return err instanceof ApiError ? err.code : undefined;
}
