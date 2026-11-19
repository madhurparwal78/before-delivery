import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { requireUser } from './http.js';
import { getSprite, getLayers, getFrames, celRows, nextSeq } from './sprites.js';
import { requireMember } from './projects.js';
import { edgeMask } from '../shared/rules.js';

function artworkForbidden(role: string): void {
  if (role === 'reviewer') throw forbidden("Reviewers can't change artwork");
}

interface Cell { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }

function flipMatches(rowsA: number[][], rowsB: number[][], mode: 'h' | 'v' | 'both'): boolean {
  const h = rowsA.length, w = rowsA[0]?.length ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = mode === 'h' ? w - 1 - x : x;
      let sy = mode === 'v' ? h - 1 - y : y;
      if (rowsA[y][x] !== rowsB[sy][sx]) return false;
    }
  }
  return true;
}

async function tilesetBySprite(spriteId: number, tilesetId: number) {
  const row = await one<{ id: string; sprite_id: string; tile_size: number; edge_table: number[]; name: string }>(
    'select id::text, sprite_id::text, tile_size, edge_table, name from tilesets where id = $1', [tilesetId]
  );
  if (!row || Number(row.sprite_id) !== spriteId) throw notFound();
  return row;
}

export function registerTileRoutes(app: Express): void {
  app.post('/api/sprites/:id/tilesets', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim() || 'Tileset';
      const tileSize = Number(body['tile_size']);
      if (tileSize !== 8 && tileSize !== 16) throw fieldErrors({ tile_size: 'Use 8 or 16' });
      const row = await one<{ id: string }>(
        'insert into tilesets (sprite_id, name, tile_size, edge_table) values ($1, $2, $3, $4::jsonb) returning id::text',
        [sprite.id, name, tileSize, JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1))]
      );
      const seq = await nextSeq(Number(sprite.id), 'tile', user.id, { op: 'add_tileset' });
      res.status(201).json({ id: Number(row!.id), seq });
    } catch (e) { next(e); }
  });

  app.get('/api/tilesets/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const ts = await one<{ id: string; sprite_id: string; name: string; tile_size: number; edge_table: number[] }>(
        'select id::text, sprite_id::text, name, tile_size, edge_table from tilesets where id = $1', [req.params.id]
      );
      if (!ts) throw notFound();
      const sprite = await getSprite(ts.sprite_id);
      await requireMember(Number(sprite.project_id), user.id);
      const tiles = await q<{ num: number; rows: number[][] }>('select num, rows from tiles where tileset_id = $1 order by num asc', [ts.id]);
      const uses = await q<{ tile: number; n: string }>(
        'select tile, count(*)::text as n from tilemap_cells c join tilemaps m on m.id = c.tilemap_id where m.tileset_id = $1 group by tile',
        [ts.id]
      );
      const useBy = new Map(uses.map((u) => [u.tile, Number(u.n)]));
      res.json({
        id: Number(ts.id), name: ts.name, tile_size: ts.tile_size,
        edge_table: ts.edge_table,
        tiles: tiles.map((t) => ({ id: t.num, rows: t.rows, uses: useBy.get(t.num) ?? 0 }))
      });
    } catch (e) { next(e); }
  });

  app.post('/api/tilesets/:id/import', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const ts = await one<{ id: string; sprite_id: string; tile_size: number }>(
        'select id::text, sprite_id::text, tile_size from tilesets where id = $1', [req.params.id]
      );
      if (!ts) throw notFound();
      const sprite = await getSprite(ts.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const framePos = Number(body['frame']);
      const layerName = String(body['layer'] ?? '');
      const frames = await getFrames(Number(sprite.id));
      const layers = await getLayers(Number(sprite.id));
      const frame = frames.find((f) => f.position === framePos);
      const layer = layers.find((l) => l.name === layerName);
      if (!frame || !layer) throw fieldErrors({ frame: 'No such frame' });
      const rows = await celRows(Number(frame.id), Number(layer.id));
      const size = ts.tile_size;
      const w = sprite.width, h = sprite.height;
      const existing = await q<{ num: number; rows: number[][] }>('select num, rows from tiles where tileset_id = $1 order by num asc', [ts.id]);
      let nextNum = existing.reduce((m, t) => Math.max(m, t.num), 0) + 1;
      const cells: Cell[] = [];
      let added = 0;
      const targetMap = body['tilemap'] !== undefined && body['tilemap'] !== null ? Number(body['tilemap']) : null;
      let mapId: number | null = targetMap;
      const ox = Number(body['x'] ?? 0), oy = Number(body['y'] ?? 0);
      for (let ty = 0; ty + size <= h; ty += size) {
        for (let tx = 0; tx + size <= w; tx += size) {
          const block: number[][] = [];
          let empty = true;
          for (let y = 0; y < size; y++) {
            const row: number[] = [];
            for (let x = 0; x < size; x++) {
              const v = rows?.[ty + y]?.[tx + x] ?? 0;
              if (v !== 0) empty = false;
              row.push(v);
            }
            block.push(row);
          }
          if (empty) continue;
          let found: { num: number; fh: boolean; fv: boolean } | null = null;
          for (const t of existing) {
            if (t.num === 0) continue;
            if (flipMatches(t.rows, block, 'h') === true && same(t.rows, block)) { found = { num: t.num, fh: false, fv: false }; break; }
            if (same(t.rows, block)) { found = { num: t.num, fh: false, fv: false }; break; }
            if (flipMatches(t.rows, block, 'h')) { found = { num: t.num, fh: true, fv: false }; break; }
            if (flipMatches(t.rows, block, 'v')) { found = { num: t.num, fh: false, fv: true }; break; }
            if (flipMatches(t.rows, block, 'both')) { found = { num: t.num, fh: true, fv: true }; break; }
          }
          if (!found) {
            await q('insert into tiles (tileset_id, num, rows) values ($1, $2, $3::jsonb)', [ts.id, nextNum, JSON.stringify(block)]);
            existing.push({ num: nextNum, rows: block });
            found = { num: nextNum, fh: false, fv: false };
            nextNum++;
            added++;
          }
          if (mapId !== null) cells.push({ x: ox + Math.floor(tx / size), y: oy + Math.floor(ty / size), tile: found.num, flip_h: found.fh, flip_v: found.fv });
        }
      }
      const seq = await nextSeq(Number(sprite.id), 'tile', user.id, { op: 'import' });
      res.status(201).json({ tiles_added: added, cells: mapId !== null ? cells : [], seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/tilesets/:id/tiles/:n', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const ts = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from tilesets where id = $1', [req.params.id]);
      if (!ts) throw notFound();
      const sprite = await getSprite(ts.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const num = Number(req.params.n);
      const tile = await one<{ num: number; rows: number[][] }>('select num, rows from tiles where tileset_id = $1 and num = $2', [ts.id, num]);
      if (!tile) throw fieldErrors({ rows: 'No such tile' });
      const rows = (req.body as Record<string, unknown>)['rows'];
      if (!Array.isArray(rows) || rows.length === 0 || !(rows as unknown[][]).every((r) => Array.isArray(r))) {
        throw fieldErrors({ rows: 'Give the full tile rows' });
      }
      await q('update tiles set rows = $1::jsonb where tileset_id = $2 and num = $3', [JSON.stringify(rows), ts.id, num]);
      const uses = await one<{ n: string }>(
        `select count(*)::text as n from tilemap_cells c join tilemaps m on m.id = c.tilemap_id
         where m.tileset_id = $1 and c.tile = $2`, [ts.id, num]
      );
      const seq = await nextSeq(Number(sprite.id), 'tile', user.id, { op: 'edit', num });
      res.json({ uses: Number(uses!.n), seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/tilesets/:id/edges', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const ts = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from tilesets where id = $1', [req.params.id]);
      if (!ts) throw notFound();
      const sprite = await getSprite(ts.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const table = (req.body as Record<string, unknown>)['table'];
      const tiles = await q<{ num: number }>('select num from tiles where tileset_id = $1', [ts.id]);
      const nums = new Set(tiles.map((t) => t.num));
      if (!Array.isArray(table) || (table as unknown[]).length !== 16 ||
          !(table as unknown[]).every((v) => typeof v === 'number' && (v === 0 || nums.has(v)))) {
        throw fieldErrors({ table: 'Use 16 existing tile numbers' });
      }
      await q('update tilesets set edge_table = $1::jsonb where id = $2', [JSON.stringify(table), ts.id]);
      const seq = await nextSeq(Number(sprite.id), 'tile', user.id, { op: 'edges' });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/tilemaps', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim() || 'Map';
      const tileset = Number(body['tileset']);
      const width = Number(body['width']);
      const height = Number(body['height']);
      const errors: Record<string, string> = {};
      if (!Number.isInteger(width) || width < 1 || width > 64) errors['width'] = 'Use 1 to 64';
      if (!Number.isInteger(height) || height < 1 || height > 64) errors['height'] = 'Use 1 to 64';
      const ts = await one<{ id: string }>('select id::text from tilesets where id = $1 and sprite_id = $2', [tileset, sprite.id]);
      if (!ts) errors['tileset'] = 'No such tileset';
      if (Object.keys(errors).length) throw fieldErrors(errors);
      const row = await one<{ id: string }>(
        'insert into tilemaps (sprite_id, tileset_id, name, width, height) values ($1, $2, $3, $4, $5) returning id::text',
        [sprite.id, tileset, name, width, height]
      );
      const seq = await nextSeq(Number(sprite.id), 'tilemap', user.id, { op: 'add' });
      res.status(201).json({ id: Number(row!.id), seq });
    } catch (e) { next(e); }
  });

  app.get('/api/tilemaps/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const map = await one<{ id: string; sprite_id: string; tileset_id: string; name: string; width: number; height: number }>(
        'select id::text, sprite_id::text, tileset_id::text, name, width, height from tilemaps where id = $1', [req.params.id]
      );
      if (!map) throw notFound();
      const sprite = await getSprite(map.sprite_id);
      await requireMember(Number(sprite.project_id), user.id);
      const cells = await q<{ x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }>(
        'select x, y, tile, flip_h, flip_v from tilemap_cells where tilemap_id = $1 and tile <> 0 order by y, x', [map.id]
      );
      const spriteRow = await one<{ seq: number }>('select seq from sprites where id = $1', [sprite.id]);
      res.json({
        id: Number(map.id), name: map.name, tileset: Number(map.tileset_id),
        width: map.width, height: map.height, cells, seq: spriteRow!.seq
      });
    } catch (e) { next(e); }
  });

  app.post('/api/tilemaps/:id/cells', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const map = await one<{ id: string; sprite_id: string; tileset_id: string; width: number; height: number }>(
        'select id::text, sprite_id::text, tileset_id::text, width, height from tilemaps where id = $1', [req.params.id]
      );
      if (!map) throw notFound();
      const sprite = await getSprite(map.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const x = Number(body['x']), y = Number(body['y']);
      const tile = Number(body['tile']);
      const edgeMatching = body['edge_matching'] === true;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) throw fieldErrors({ x: 'Outside the map' });
      const ts = await tilesetBySprite(Number(sprite.id), Number(map.tileset_id));
      if (tile !== 0) {
        const exists = await one<{ num: number }>('select num from tiles where tileset_id = $1 and num = $2', [ts.id, tile]);
        if (!exists) throw fieldErrors({ tile: 'No such tile' });
      }
      const write = async (cx: number, cy: number, value: number): Promise<void> => {
        if (value === 0) await q('delete from tilemap_cells where tilemap_id = $1 and x = $2 and y = $3', [map.id, cx, cy]);
        else await q(
          `insert into tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) values ($1, $2, $3, $4, false, false)
           on conflict (tilemap_id, x, y) do update set tile = $4, flip_h = false, flip_v = false`,
          [map.id, cx, cy, value]
        );
      };
      const changed: (Cell & { mask: number | null })[] = [];
      if (edgeMatching) {
        const targets = [[x, y], [x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as [number, number][];
        for (const [tx, ty] of targets) {
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        }
        // apply the placed/erased cell first, then neighbours from the new state
        await write(x, y, tile);
        const filledSet = await filledCells(map.id);
        for (const [tx, ty] of targets) {
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const value = await cellValue(map.id, tx, ty);
          if (value === 0) continue;
          const mask = edgeMask(filledSet, tx, ty);
          const chosen = ts.edge_table[mask] ?? mask + 1;
          await write(tx, ty, chosen);
          changed.push({ x: tx, y: ty, tile: chosen, flip_h: false, flip_v: false, mask });
        }
        // include the written cell even when it stayed empty
        const self = await cellValue(map.id, x, y);
        changed.unshift({ x, y, tile: self, flip_h: false, flip_v: false, mask: self === 0 ? null : edgeMask(await filledCells(map.id), x, y) });
      } else {
        await write(x, y, tile);
        const after = await cellValue(map.id, x, y);
        changed.push({ x, y, tile: after, flip_h: false, flip_v: false, mask: null });
      }
      const deduped = dedupeChanged(changed);
      const seq = await nextSeq(Number(sprite.id), 'tilemap', user.id, { op: 'cell', x, y, tile });
      res.status(201).json({ seq, changed: deduped });
    } catch (e) { next(e); }
  });

  app.patch('/api/tilemaps/:id/cells/:x/:y', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const map = await one<{ id: string; sprite_id: string }>(
        'select id::text, sprite_id::text from tilemaps where id = $1', [req.params.id]
      );
      if (!map) throw notFound();
      const sprite = await getSprite(map.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const x = Number(req.params.x), y = Number(req.params.y);
      const cell = await one<{ tile: number }>('select tile from tilemap_cells where tilemap_id = $1 and x = $2 and y = $3', [map.id, x, y]);
      if (!cell || cell.tile === 0) throw fieldErrors({ cell: 'Empty cell' });
      const body = req.body as Record<string, unknown>;
      const flipH = body['flip_h'] === true;
      const flipV = body['flip_v'] === true;
      await q('update tilemap_cells set flip_h = $1, flip_v = $2 where tilemap_id = $3 and x = $4 and y = $5',
        [flipH, flipV, map.id, x, y]);
      const seq = await nextSeq(Number(sprite.id), 'tilemap', user.id, { op: 'flip', x, y });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/tilemaps/:id/stamp', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const map = await one<{ id: string; sprite_id: string; width: number; height: number }>(
        'select id::text, sprite_id::text, width, height from tilemaps where id = $1', [req.params.id]
      );
      if (!map) throw notFound();
      const sprite = await getSprite(map.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const x = Number(body['x']), y = Number(body['y']);
      const cellsIn = body['cells'];
      if (!Array.isArray(cellsIn)) throw fieldErrors({ cells: 'Give rows of cells' });
      const changed: Cell[] = [];
      for (let ry = 0; ry < cellsIn.length; ry++) {
        const row = cellsIn[ry] as unknown[];
        if (!Array.isArray(row)) throw fieldErrors({ cells: 'Give rows of cells' });
        for (let rx = 0; rx < row.length; rx++) {
          const c = row[rx] as Record<string, unknown>;
          const tx = x + rx, ty = y + ry;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const tile = Number(c['tile'] ?? 0);
          const fh = c['flip_h'] === true, fv = c['flip_v'] === true;
          if (tile === 0) {
            await q('delete from tilemap_cells where tilemap_id = $1 and x = $2 and y = $3', [map.id, tx, ty]);
          } else {
            await q(
              `insert into tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) values ($1, $2, $3, $4, $5, $6)
               on conflict (tilemap_id, x, y) do update set tile = $4, flip_h = $5, flip_v = $6`,
              [map.id, tx, ty, tile, fh, fv]
            );
          }
          changed.push({ x: tx, y: ty, tile, flip_h: fh, flip_v: fv });
        }
      }
      const seq = await nextSeq(Number(sprite.id), 'tilemap', user.id, { op: 'stamp' });
      res.status(201).json({ seq, changed });
    } catch (e) { next(e); }
  });
}

function same(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    if (a[y].length !== b[y].length) return false;
    for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) return false;
  }
  return true;
}

async function filledCells(mapId: string): Promise<Set<string>> {
  const rows = await q<{ x: number; y: number }>('select x, y from tilemap_cells where tilemap_id = $1 and tile <> 0', [mapId]);
  return new Set(rows.map((r) => `${r.x},${r.y}`));
}

async function cellValue(mapId: string, x: number, y: number): Promise<number> {
  const row = await one<{ tile: number }>('select tile from tilemap_cells where tilemap_id = $1 and x = $2 and y = $3', [mapId, x, y]);
  return row?.tile ?? 0;
}

function dedupeChanged(cells: (Cell & { mask: number | null })[]): (Cell & { mask: number | null })[] {
  const seen = new Set<string>();
  const out: (Cell & { mask: number | null })[] = [];
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
