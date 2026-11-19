import { cellKey, defaultEdgeTable, edgeMatchedChanges, flipTileRows, type MapCells } from '../../shared/edges.js';
import type { TileCell } from '../../shared/types.js';
import { openSprite, requireArtwork, type SpriteRow } from '../access.js';
import { notFound, unprocessable } from '../errors.js';
import type { Ctx, Reply, Route } from '../http.js';
import { recordOperation, spriteTransaction, type MapCellPatch, type OpContext } from '../ops.js';
import {
  celsOfFrame,
  emptySurface,
  surfaceOf,
  tileBuffer,
  tileRows,
  tileUses,
} from '../sprite.js';
import { idParam, text, wholeNumber } from '../validate.js';
import { frameByNumber, layerByName } from './sprites.js';
import { first, one, query, rows, transact } from '../db.js';
import type { PoolClient } from 'pg';

interface TilesetRow {
  id: number;
  sprite_id: number;
  name: string;
  tile_size: number;
  edge_table: number[];
}

interface TilemapRow {
  id: number;
  sprite_id: number;
  tileset_id: number;
  name: string;
  width: number;
  height: number;
}

async function openTileset(ctx: Ctx, tilesetId: number): Promise<{ tileset: TilesetRow; sprite: SpriteRow; access: Awaited<ReturnType<typeof openSprite>>['access'] }> {
  const tileset = await one<TilesetRow>('SELECT * FROM tilesets WHERE id = $1', [tilesetId]);
  if (tileset === null) throw notFound();
  const { sprite, access } = await openSprite(ctx, tileset.sprite_id);
  return { tileset, sprite, access };
}

async function openTilemap(ctx: Ctx, tilemapId: number): Promise<{
  tilemap: TilemapRow;
  tileset: TilesetRow;
  sprite: SpriteRow;
  access: Awaited<ReturnType<typeof openSprite>>['access'];
}> {
  const tilemap = await one<TilemapRow>('SELECT * FROM tilemaps WHERE id = $1', [tilemapId]);
  if (tilemap === null) throw notFound();
  const tileset = await one<TilesetRow>('SELECT * FROM tilesets WHERE id = $1', [tilemap.tileset_id]);
  if (tileset === null) throw notFound();
  const { sprite, access } = await openSprite(ctx, tilemap.sprite_id);
  return { tilemap, tileset, sprite, access };
}

async function mapCells(client: PoolClient, tilemapId: number): Promise<MapCells> {
  const list = await rows<{ x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }>(
    client,
    'SELECT x, y, tile, flip_h, flip_v FROM tilemap_cells WHERE tilemap_id = $1',
    [tilemapId],
  );
  return new Map(
    list.map((cell) => [cellKey(cell.x, cell.y), { tile: cell.tile, flip_h: cell.flip_h, flip_v: cell.flip_v }]),
  );
}

async function tilesOf(client: PoolClient, tilesetId: number): Promise<{ number: number; rows: number[][] }[]> {
  const list = await rows<{ number: number; data: Buffer }>(
    client,
    'SELECT number, data FROM tiles WHERE tileset_id = $1 ORDER BY number',
    [tilesetId],
  );
  const size = Math.round(Math.sqrt(list[0]?.data.length ?? 1));
  return list.map((tile) => ({ number: tile.number, rows: tileRows(tile.data, size) }));
}

function sameRows(left: number[][], right: number[][]): boolean {
  return left.every((row, y) => row.every((value, x) => value === right[y][x]));
}

async function writeCells(
  opCtx: OpContext,
  tilemapId: number,
  changes: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[],
  existing: MapCells,
): Promise<MapCellPatch[]> {
  const patch: MapCellPatch[] = [];
  for (const change of changes) {
    const before = existing.get(cellKey(change.x, change.y)) ?? null;
    if (change.tile === 0) {
      await opCtx.client.query('DELETE FROM tilemap_cells WHERE tilemap_id = $1 AND x = $2 AND y = $3', [
        tilemapId,
        change.x,
        change.y,
      ]);
    } else {
      await opCtx.client.query(
        `INSERT INTO tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tilemap_id, x, y) DO UPDATE SET tile = $4, flip_h = $5, flip_v = $6`,
        [tilemapId, change.x, change.y, change.tile, change.flip_h, change.flip_v],
      );
    }
    patch.push({
      x: change.x,
      y: change.y,
      before: before === null ? null : { ...before },
      after:
        change.tile === 0
          ? null
          : { tile: change.tile, flip_h: change.flip_h, flip_v: change.flip_v },
    });
  }
  return patch;
}

export const tileRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/sprites/:id/tilesets',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const name = text(ctx, 'name', { max: 60, label: 'Name this tileset' });
      const size = Number(ctx.body.tile_size);
      if (size !== 8 && size !== 16) throw unprocessable({ tile_size: 'Use 8 or 16' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const made = await first<{ id: number }>(
          opCtx.client,
          'INSERT INTO tilesets (sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4) RETURNING id',
          [sprite.id, name, size, defaultEdgeTable()],
        );
        const seq = await recordOperation(opCtx, { type: 'tile', data: { action: 'tileset', name } });
        opCtx.events.push({ type: 'op', seq, op: 'tile', by: access.person.name });
        return { status: 201, body: { id: (made as { id: number }).id, seq } };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/tilesets/:id',
    handler: async (ctx) => {
      const { tileset } = await openTileset(ctx, idParam(ctx, 'id'));
      return transact(async (client) => {
        const uses = await tileUses(client, tileset.id);
        const tiles = await rows<{ number: number; data: Buffer }>(
          client,
          'SELECT number, data FROM tiles WHERE tileset_id = $1 ORDER BY number',
          [tileset.id],
        );
        return {
          status: 200,
          body: {
            id: tileset.id,
            name: tileset.name,
            tile_size: tileset.tile_size,
            edge_table: tileset.edge_table,
            tiles: tiles.map((tile) => ({
              id: tile.number,
              rows: tileRows(tile.data, tileset.tile_size),
              uses: uses.get(tile.number) ?? 0,
            })),
          },
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/tilesets/:id/import',
    handler: async (ctx) => {
      const { tileset, sprite, access } = await openTileset(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frame = await frameByNumber(opCtx.client, sprite.id, Number(ctx.body.frame));
        const layer = await layerByName(opCtx.client, sprite.id, String(ctx.body.layer ?? ''));
        const cel = (await celsOfFrame(opCtx.client, frame.id)).get(layer.id);
        const surface =
          cel === undefined
            ? emptySurface(sprite.width, sprite.height)
            : surfaceOf(cel.data, sprite.width, sprite.height);
        const size = tileset.tile_size;
        const known = await tilesOf(opCtx.client, tileset.id);
        let nextNumber = known.reduce((top, tile) => Math.max(top, tile.number), 0) + 1;
        let added = 0;
        const placements: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] = [];
        const columns = Math.floor(sprite.width / size);
        const lines = Math.floor(sprite.height / size);
        for (let row = 0; row < lines; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const block: number[][] = [];
            let empty = true;
            for (let y = 0; y < size; y += 1) {
              const line: number[] = [];
              for (let x = 0; x < size; x += 1) {
                const index = surface.indices[(row * size + y) * sprite.width + column * size + x];
                if (index !== 0) empty = false;
                line.push(index);
              }
              block.push(line);
            }
            if (empty) {
              placements.push({ x: column, y: row, tile: 0, flip_h: false, flip_v: false });
              continue;
            }
            let match: { tile: number; flip_h: boolean; flip_v: boolean } | null = null;
            const transforms: { flip_h: boolean; flip_v: boolean }[] = [
              { flip_h: false, flip_v: false },
              { flip_h: true, flip_v: false },
              { flip_h: false, flip_v: true },
              { flip_h: true, flip_v: true },
            ];
            for (const transform of transforms) {
              for (const tile of known) {
                if (sameRows(flipTileRows(tile.rows, transform.flip_h, transform.flip_v), block)) {
                  match = { tile: tile.number, ...transform };
                  break;
                }
              }
              if (match !== null) break;
            }
            if (match === null) {
              await opCtx.client.query(
                'INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)',
                [tileset.id, nextNumber, tileBuffer(block)],
              );
              known.push({ number: nextNumber, rows: block });
              match = { tile: nextNumber, flip_h: false, flip_v: false };
              nextNumber += 1;
              added += 1;
            }
            placements.push({ x: column, y: row, ...match });
          }
        }

        const tilemapId = ctx.body.tilemap === undefined ? null : Number(ctx.body.tilemap);
        const offsetX = Number(ctx.body.x ?? 0);
        const offsetY = Number(ctx.body.y ?? 0);
        let changed = placements;
        if (tilemapId !== null) {
          const tilemap = await first<TilemapRow>(
            opCtx.client,
            'SELECT * FROM tilemaps WHERE id = $1 AND sprite_id = $2',
            [tilemapId, sprite.id],
          );
          if (tilemap === null) throw unprocessable({ tilemap: 'That tilemap is gone' });
          const existing = await mapCells(opCtx.client, tilemapId);
          changed = placements
            .map((cell) => ({ ...cell, x: cell.x + offsetX, y: cell.y + offsetY }))
            .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < tilemap.width && cell.y < tilemap.height);
          await writeCells(opCtx, tilemapId, changed, existing);
        }
        const seq = await recordOperation(opCtx, {
          type: 'tile',
          data: { action: 'import', tiles_added: added },
        });
        opCtx.events.push({ type: 'op', seq, op: 'tile', by: access.person.name });
        return {
          status: 201,
          body: {
            tiles_added: added,
            cells: changed.map((cell) => ({
              x: cell.x,
              y: cell.y,
              tile: cell.tile,
              flip_h: cell.flip_h,
              flip_v: cell.flip_v,
            })),
            seq,
          },
        };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/tilesets/:id/tiles/:n',
    handler: async (ctx) => {
      const { tileset, sprite, access } = await openTileset(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const number = idParam(ctx, 'n');
      const given = ctx.body.rows;
      const size = tileset.tile_size;
      if (
        !Array.isArray(given) ||
        given.length !== size ||
        given.some((row) => !Array.isArray(row) || row.length !== size)
      ) {
        throw unprocessable({ rows: `Send ${size} rows of ${size} indices` });
      }
      const tileData = (given as number[][]).map((row) => row.map((value) => Number(value)));
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const tile = await first<{ number: number }>(
          opCtx.client,
          'SELECT number FROM tiles WHERE tileset_id = $1 AND number = $2',
          [tileset.id, number],
        );
        if (tile === null) throw unprocessable({ rows: 'That tile is gone' });
        await opCtx.client.query('UPDATE tiles SET data = $3 WHERE tileset_id = $1 AND number = $2', [
          tileset.id,
          number,
          tileBuffer(tileData),
        ]);
        const uses = (await tileUses(opCtx.client, tileset.id)).get(number) ?? 0;
        const seq = await recordOperation(opCtx, {
          type: 'tile',
          data: { action: 'edit', tile: number },
        });
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'tile',
          by: access.person.name,
          data: { action: 'edit', tile: number, tileset: tileset.id },
        });
        return { status: 200, body: { uses, seq } };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/tilesets/:id/edges',
    handler: async (ctx) => {
      const { tileset, sprite, access } = await openTileset(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const table = ctx.body.table;
      const bad = 'Use 16 existing tile numbers';
      if (!Array.isArray(table) || table.length !== 16) throw unprocessable({ table: bad });
      const numbers = (table as unknown[]).map((value) => Number(value));
      if (numbers.some((value) => !Number.isInteger(value) || value < 1)) {
        throw unprocessable({ table: bad });
      }
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const known = new Set((await tilesOf(opCtx.client, tileset.id)).map((tile) => tile.number));
        if (numbers.some((value) => !known.has(value))) throw unprocessable({ table: bad });
        await opCtx.client.query('UPDATE tilesets SET edge_table = $2 WHERE id = $1', [
          tileset.id,
          numbers,
        ]);
        const seq = await recordOperation(opCtx, { type: 'tile', data: { action: 'edges' } });
        opCtx.events.push({ type: 'op', seq, op: 'tile', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/tilemaps',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const name = text(ctx, 'name', { max: 60, label: 'Name this tilemap' });
      const width = wholeNumber(ctx, 'width', { min: 1, max: 256, text: 'Use 1 to 256' });
      const height = wholeNumber(ctx, 'height', { min: 1, max: 256, text: 'Use 1 to 256' });
      const tilesetId = Number(ctx.body.tileset);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const tileset = await first<{ id: number }>(
          opCtx.client,
          'SELECT id FROM tilesets WHERE id = $1 AND sprite_id = $2',
          [tilesetId, sprite.id],
        );
        if (tileset === null) throw unprocessable({ tileset: 'Choose a tileset' });
        const made = await first<{ id: number }>(
          opCtx.client,
          'INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [sprite.id, tilesetId, name, width, height],
        );
        const seq = await recordOperation(opCtx, { type: 'tilemap', data: { action: 'add', name } });
        opCtx.events.push({ type: 'op', seq, op: 'tilemap', by: access.person.name });
        return { status: 201, body: { id: (made as { id: number }).id, seq } };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/tilemaps/:id',
    handler: async (ctx) => {
      const { tilemap, sprite } = await openTilemap(ctx, idParam(ctx, 'id'));
      const cells = await query<{ x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }>(
        'SELECT x, y, tile, flip_h, flip_v FROM tilemap_cells WHERE tilemap_id = $1 ORDER BY y, x',
        [tilemap.id],
      );
      return {
        status: 200,
        body: {
          id: tilemap.id,
          name: tilemap.name,
          tileset: tilemap.tileset_id,
          width: tilemap.width,
          height: tilemap.height,
          cells,
          seq: sprite.seq,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/tilemaps/:id/cells',
    handler: async (ctx) => placeCell(ctx),
  },
  {
    method: 'PATCH',
    pattern: '/api/tilemaps/:id/cells/:x/:y',
    handler: async (ctx) => {
      const { tilemap, sprite, access } = await openTilemap(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const x = idParam(ctx, 'x');
      const y = idParam(ctx, 'y');
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const existing = await mapCells(opCtx.client, tilemap.id);
        const cell = existing.get(cellKey(x, y));
        if (cell === undefined || cell.tile === 0) {
          throw unprocessable({ x: 'That cell is empty' });
        }
        const flipH = typeof ctx.body.flip_h === 'boolean' ? ctx.body.flip_h : cell.flip_h;
        const flipV = typeof ctx.body.flip_v === 'boolean' ? ctx.body.flip_v : cell.flip_v;
        const patch = await writeCells(
          opCtx,
          tilemap.id,
          [{ x, y, tile: cell.tile, flip_h: flipH, flip_v: flipV }],
          existing,
        );
        const seq = await recordOperation(opCtx, {
          type: 'tilemap',
          data: { action: 'flip', x, y },
          patch: { map: { tilemap: tilemap.id, cells: patch } },
          undoable: true,
        });
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'tilemap',
          by: access.person.name,
          data: { tilemap: tilemap.id },
        });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/tilemaps/:id/stamp',
    handler: async (ctx) => {
      const { tilemap, sprite, access } = await openTilemap(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const x = Number(ctx.body.x);
      const y = Number(ctx.body.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw unprocessable({ x: 'Send a whole-number cell' });
      }
      const given = ctx.body.cells;
      if (!Array.isArray(given) || given.length === 0) throw unprocessable({ cells: 'Send stamp rows' });
      const stamp = (given as TileCell[][]).map((row) =>
        row.map((cell) => ({
          tile: Number(cell.tile ?? 0),
          flip_h: cell.flip_h === true,
          flip_v: cell.flip_v === true,
        })),
      );
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const existing = await mapCells(opCtx.client, tilemap.id);
        const changes: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] = [];
        stamp.forEach((row, dy) => {
          row.forEach((cell, dx) => {
            const atX = x + dx;
            const atY = y + dy;
            if (atX < 0 || atY < 0 || atX >= tilemap.width || atY >= tilemap.height) return;
            changes.push({ x: atX, y: atY, ...cell });
          });
        });
        changes.sort((l, r) => (l.y === r.y ? l.x - r.x : l.y - r.y));
        const patch = await writeCells(opCtx, tilemap.id, changes, existing);
        const seq = await recordOperation(opCtx, {
          type: 'tilemap',
          data: { action: 'stamp', x, y },
          patch: { map: { tilemap: tilemap.id, cells: patch } },
          undoable: true,
        });
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'tilemap',
          by: access.person.name,
          data: { tilemap: tilemap.id },
        });
        return { status: 201, body: { seq, changed: changes } };
      });
    },
  },
];

async function placeCell(ctx: Ctx): Promise<Reply> {
  const { tilemap, tileset, sprite, access } = await openTilemap(ctx, idParam(ctx, 'id'));
  requireArtwork(access);
  const x = Number(ctx.body.x);
  const y = Number(ctx.body.y);
  const tile = Number(ctx.body.tile);
  if (!Number.isInteger(x) || x < 0 || x >= tilemap.width) throw unprocessable({ x: 'That cell is outside the map' });
  if (!Number.isInteger(y) || y < 0 || y >= tilemap.height) throw unprocessable({ y: 'That cell is outside the map' });
  if (!Number.isInteger(tile) || tile < 0) throw unprocessable({ tile: 'Choose a tile' });
  const flipH = ctx.body.flip_h === true;
  const flipV = ctx.body.flip_v === true;
  const matching = ctx.body.edge_matching === true;
  return spriteTransaction(sprite.id, access.person, async (opCtx) => {
    const known = new Set((await tilesOf(opCtx.client, tileset.id)).map((entry) => entry.number));
    if (tile !== 0 && !known.has(tile)) throw unprocessable({ tile: 'Choose a tile' });
    const existing = await mapCells(opCtx.client, tilemap.id);
    let changes: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean; mask: number | null }[];
    if (matching) {
      const edged = edgeMatchedChanges(
        existing,
        x,
        y,
        tile,
        tileset.edge_table,
        tilemap.width,
        tilemap.height,
      );
      if (edged.some((change) => change.tile !== 0 && !known.has(change.tile))) {
        throw unprocessable({ tile: 'Edge table points at a missing tile' });
      }
      changes = edged;
    } else {
      changes = [{ x, y, tile, flip_h: flipH, flip_v: flipV, mask: null }];
    }
    const patch = await writeCells(opCtx, tilemap.id, changes, existing);
    const seq = await recordOperation(opCtx, {
      type: 'tilemap',
      data: { action: tile === 0 ? 'erase' : 'place', x, y },
      patch: { map: { tilemap: tilemap.id, cells: patch } },
      undoable: true,
    });
    opCtx.events.push({
      type: 'op',
      seq,
      op: 'tilemap',
      by: access.person.name,
      data: { tilemap: tilemap.id },
    });
    return { status: 201, body: { seq, changed: changes } };
  });
}
