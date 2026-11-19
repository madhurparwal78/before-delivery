import type { Express } from 'express';
import { inTransaction, cQuery, cOne, q, one } from './db.js';
import { notFound, fieldErrors } from './errors.js';
import { now, moveClock } from './clock.js';
import { config } from './http.js';
import { hashPassword } from './config.js';
import { captureState } from './review.js';
import { getSprite, writeCel, blankRows } from './sprites.js';

interface SeedBody {
  users?: SeedUser[];
  projects?: SeedProject[];
  memberships?: SeedMembership[];
  palettes?: SeedPalette[];
  sprites?: SeedSprite[];
  layers?: SeedLayer[];
  frames?: SeedFrame[];
  cels?: SeedCel[];
  tags?: SeedTag[];
  tilesets?: SeedTileset[];
  tilemaps?: SeedTilemap[];
  comments?: SeedComment[];
  snapshots?: SeedSnapshot[];
  share_links?: SeedShareLink[];
  invites?: SeedInvite[];
}

interface SeedUser { key: string; email: string; name: string; password: string; confirmed?: boolean; number_format?: string; time_zone?: string }
interface SeedProject { key: string; name: string; owner: string }
interface SeedMembership { key: string; project: string; user: string; role: string }
interface SeedPalette { key: string; swatches: { index: number; color: string }[] }
interface SeedSprite { key: string; project: string; palette: string; name: string; width: number; height: number }
interface SeedLayer { key: string; sprite: string; name: string; opacity?: number; blend?: string; visible?: boolean; locked_by?: string | null }
interface SeedFrame { key: string; sprite: string; duration_ms: number }
interface SeedCel { key: string; frame: string; layer: string; rows?: number[][]; link_to?: string }
interface SeedTag { key: string; sprite: string; name: string; from: number; to: number; direction: string; repeat?: number }
interface SeedTileset { key: string; sprite: string; name: string; tile_size: number; tiles: { key: string; rows: number[][] }[]; edge_table: number[] }
interface SeedTilemap { key: string; sprite: string; tileset: string; name: string; width: number; height: number; cells: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] }
interface SeedComment { key: string; sprite: string; author: string; frame: number; x: number; y: number; text: string; state: string }
interface SeedSnapshot { key: string; sprite: string; name: string }
interface SeedShareLink { key: string; sprite: string; label: string; token: string; expires_at: string | null }
interface SeedInvite { key: string; project: string; email: string; role: string; token: string; expires_at: string | null }

function gradingGuard(req: { headers: Record<string, unknown> }): void {
  if (!config.gradingKey || req.headers['x-grading-key'] !== config.gradingKey) throw notFound();
}

export function registerGradingRoutes(app: Express): void {
  app.post('/api/grading/seed', async (req, res, next) => {
    try {
      gradingGuard(req);
      const body = req.body as SeedBody;
      const result = await runSeed(body);
      res.status(201).json({ ids: result });
    } catch (e) { next(e); }
  });

  app.post('/api/grading/clock', async (req, res, next) => {
    try {
      gradingGuard(req);
      const body = req.body as Record<string, unknown>;
      if (body['advance_seconds'] !== undefined) {
        const n = Number(body['advance_seconds']);
        if (!Number.isInteger(n) || n < 0) throw fieldErrors({ advance_seconds: 'Use 0 or more' });
        res.json({ now: await moveClock({ advanceSeconds: n }) });
        return;
      }
      if (body['set'] !== undefined) {
        const value = String(body['set']);
        const parsed = Date.parse(value);
        if (Number.isNaN(parsed)) throw fieldErrors({ set: 'Use an instant' });
        const result = await moveClock({ set: value });
        if (result === 'invalid') throw fieldErrors({ set: 'Choose a time not earlier than now' });
        res.json({ now: result });
        return;
      }
      throw fieldErrors({ advance_seconds: 'Give advance_seconds or set' });
    } catch (e) { next(e); }
  });
}

/** Run the whole seed in one transaction: any unknown reference or broken limit
 * rolls back so nothing is created, and the caller sees a 422. */
async function runSeed(body: SeedBody): Promise<Record<string, number>> {
  const at = await now();
  const snapshotKeys: { spriteId: number; name: string; key: string }[] = [];
  const ids = await inTransaction(async (client) => {
    const ids: Record<string, number> = {};
    const userByKey = new Map<string, number>();
    const q = <T extends import('pg').QueryResultRow = import('pg').QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> => cQuery<T>(client, sql, params);
    const one = <T extends import('pg').QueryResultRow = import('pg').QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> => cOne<T>(client, sql, params);
    for (const u of body.users ?? []) {
        const row = await one<{ id: string }>(
          `insert into users (email, name, password_hash, confirm_code, confirmed, number_format, time_zone, created_at)
           values ($1, $2, $3, null, $4, $5, $6, $7) returning id::text`,
          [u.email, u.name, hashPassword(u.password), u.confirmed ?? true, u.number_format ?? 'en-US', u.time_zone ?? 'UTC', at]
        );
        ids[u.key] = Number(row!.id);
        userByKey.set(u.key, Number(row!.id));
      }
      const projectByKey = new Map<string, number>();
      for (const p of body.projects ?? []) {
        const row = await one<{ id: string }>('insert into projects (name, owner_id, created_at) values ($1, $2, $3) returning id::text',
          [p.name, userByKey.get(p.owner)!, at]);
        ids[p.key] = Number(row!.id);
        projectByKey.set(p.key, Number(row!.id));
        await q('insert into memberships (project_id, user_id, role, joined_at) values ($1, $2, $3, $4)',
          [row!.id, userByKey.get(p.owner)!, 'owner', at]);
      }
      for (const m of body.memberships ?? []) {
        await q(
          `insert into memberships (project_id, user_id, role, joined_at) values ($1, $2, $3, $4)
           on conflict (project_id, user_id) do update set role = $3`,
          [projectByKey.get(m.project)!, userByKey.get(m.user)!, m.role, at]
        );
      }
      const paletteByKey = new Map<string, number>();
      for (const p of body.palettes ?? []) {
        const row = await one<{ id: string }>('insert into palettes (sprite_id, seq_at_creation) values (0, 0) returning id::text');
        ids[p.key] = Number(row!.id);
        paletteByKey.set(p.key, Number(row!.id));
        for (const s of p.swatches) {
          await q('insert into swatches (palette_id, index, color, version, last_version) values ($1, $2, $3, 1, 1)',
            [row!.id, s.index, s.color]);
        }
      }
      const spriteByKey = new Map<string, { id: number; w: number; h: number }>();
      for (const s of body.sprites ?? []) {
        const row = await one<{ id: string }>(
          'insert into sprites (project_id, palette_id, name, width, height, seq, created_at) values ($1, $2, $3, $4, $5, 0, $6) returning id::text',
          [projectByKey.get(s.project)!, paletteByKey.get(s.palette)!, s.name, s.width, s.height, at]
        );
        ids[s.key] = Number(row!.id);
        spriteByKey.set(s.key, { id: Number(row!.id), w: s.width, h: s.height });
        await q('update palettes set sprite_id = $1 where id = $2', [row!.id, paletteByKey.get(s.palette)!]);
      }
      const layerByKey = new Map<string, number>();
      for (const l of body.layers ?? []) {
        const sprite = spriteByKey.get(l.sprite)!;
        const count = (await q<{ n: string }>('select count(*)::text as n from layers where sprite_id = $1', [sprite.id]))[0]!.n;
        const row = await one<{ id: string }>(
          'insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, $3, $4, $5, $6, $7) returning id::text',
          [sprite.id, l.name, l.opacity ?? 100, l.blend ?? 'normal', l.visible ?? true, l.locked_by ? userByKey.get(l.locked_by) ?? null : null, Number(count) + 1]
        );
        ids[l.key] = Number(row!.id);
        layerByKey.set(l.key, Number(row!.id));
      }
      const frameByKey = new Map<string, number>();
      for (const f of body.frames ?? []) {
        const sprite = spriteByKey.get(f.sprite)!;
        const count = (await q<{ n: string }>('select count(*)::text as n from frames where sprite_id = $1', [sprite.id]))[0]!.n;
        const row = await one<{ id: string }>(
          'insert into frames (sprite_id, position, duration_ms) values ($1, $2, $3) returning id::text',
          [sprite.id, Number(count) + 1, f.duration_ms]
        );
        ids[f.key] = Number(row!.id);
        frameByKey.set(f.key, Number(row!.id));
      }
      for (const c of body.cels ?? []) {
        const layerRow = await one<{ sprite_id: string }>('select sprite_id::text from layers where id = $1', [layerByKey.get(c.layer)!]);
        const spriteRow = await one<{ width: number; height: number }>('select width, height from sprites where id = $1', [layerRow!.sprite_id]);
        // a cel always holds the full sprite size, whatever rows were given
        const blank = blankRows(spriteRow!.width, spriteRow!.height);
        const given = c.rows ?? blank;
        for (let y = 0; y < given.length && y < blank.length; y++) {
          for (let x = 0; x < given[y].length && x < blank[y].length; x++) blank[y][x] = given[y][x];
        }
        const frameId = frameByKey.get(c.frame)!;
        if (c.link_to) {
          await q(
            `insert into cels (frame_id, layer_id, rows, link_frame_id) values ($1, $2, $3::jsonb, $4)
             on conflict (frame_id, layer_id) do update set rows = $3::jsonb, link_frame_id = $4`,
            [frameId, layerByKey.get(c.layer)!, JSON.stringify(blank), frameByKey.get(c.link_to)!]
          );
        } else {
          await q(
            `insert into cels (frame_id, layer_id, rows, link_frame_id) values ($1, $2, $3::jsonb, null)
             on conflict (frame_id, layer_id) do update set rows = $3::jsonb, link_frame_id = null`,
            [frameId, layerByKey.get(c.layer)!, JSON.stringify(blank)]
          );
        }
        ids[c.key] = frameId;
      }
      for (const t of body.tags ?? []) {
        const sprite = spriteByKey.get(t.sprite)!;
        const row = await one<{ id: string }>(
          'insert into tags (sprite_id, name, from_frame, to_frame, direction, repeat) values ($1, $2, $3, $4, $5, $6) returning id::text',
          [sprite.id, t.name, t.from, t.to, t.direction, t.repeat ?? 0]
        );
        ids[t.key] = Number(row!.id);
      }
      const tilesetByKey = new Map<string, number>();
      for (const ts of body.tilesets ?? []) {
        const sprite = spriteByKey.get(ts.sprite)!;
        const row = await one<{ id: string }>(
          'insert into tilesets (sprite_id, name, tile_size, edge_table) values ($1, $2, $3, $4::jsonb) returning id::text',
          [sprite.id, ts.name, ts.tile_size, JSON.stringify(ts.edge_table)]
        );
        ids[ts.key] = Number(row!.id);
        tilesetByKey.set(ts.key, Number(row!.id));
        let num = 1;
        for (const tile of ts.tiles) {
          await q('insert into tiles (tileset_id, num, rows) values ($1, $2, $3::jsonb)', [row!.id, num, JSON.stringify(tile.rows)]);
          ids[tile.key] = num;
          num++;
        }
      }
      for (const tm of body.tilemaps ?? []) {
        const sprite = spriteByKey.get(tm.sprite)!;
        const row = await one<{ id: string }>(
          'insert into tilemaps (sprite_id, tileset_id, name, width, height) values ($1, $2, $3, $4, $5) returning id::text',
          [sprite.id, tilesetByKey.get(tm.tileset)!, tm.name, tm.width, tm.height]
        );
        ids[tm.key] = Number(row!.id);
        for (const cell of tm.cells) {
          await q('insert into tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) values ($1, $2, $3, $4, $5, $6)',
            [row!.id, cell.x, cell.y, cell.tile, cell.flip_h, cell.flip_v]);
        }
      }
      for (const c of body.comments ?? []) {
        const sprite = spriteByKey.get(c.sprite)!;
        const row = await one<{ id: string }>(
          'insert into comments (sprite_id, author_id, frame, x, y, text, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text',
          [sprite.id, userByKey.get(c.author)!, c.frame, c.x, c.y, c.text, c.state, at]
        );
        ids[c.key] = Number(row!.id);
      }
      for (const sn of body.snapshots ?? []) {
        const sprite = spriteByKey.get(sn.sprite)!;
        snapshotKeys.push({ spriteId: sprite.id, name: sn.name, key: sn.key });
      }
      for (const sl of body.share_links ?? []) {
        const sprite = spriteByKey.get(sl.sprite)!;
        const row = await one<{ id: string }>(
          'insert into share_links (sprite_id, label, token, state, expires_at, created_at) values ($1, $2, $3, $4, $5, $6) returning id::text',
          [sprite.id, sl.label, sl.token, 'active', sl.expires_at, at]
        );
        ids[sl.key] = Number(row!.id);
      }
      for (const inv of body.invites ?? []) {
        const row = await one<{ id: string }>(
          'insert into invites (project_id, email, role, token, state, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7) returning id::text',
          [projectByKey.get(inv.project)!, inv.email, inv.role, inv.token, 'pending', inv.expires_at, at]
        );
        ids[inv.key] = Number(row!.id);
      }
    return ids;
  }).catch((e) => {
    console.error('seed failed:', e instanceof Error ? e.message : e);
    // an unknown reference or a broken limit: nothing was created
    throw fieldErrors({ seed: 'Unknown reference or broken limit' });
  });
  // snapshots capture the state after every cel, tag, tile and map in the call,
  // so they are written once the seed transaction has committed
  for (const snap of snapshotKeys) {
    const state = await captureState(snap.spriteId);
    const row = await one<{ id: string }>(
      'insert into snapshots (sprite_id, name, seq, state, at) values ($1, $2, 0, $3::jsonb, $4) returning id::text',
      [snap.spriteId, snap.name, JSON.stringify(state), at]
    );
    if (snap.key) ids[snap.key] = Number(row!.id);
  }
  return ids;
}


