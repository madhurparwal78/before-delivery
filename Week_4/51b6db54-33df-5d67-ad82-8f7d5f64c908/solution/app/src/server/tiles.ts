import { asId, spriteAccess } from './access';
import { one, pool, rows } from './db';
import { invalid, notFound } from './errors';
import { created, route } from './http';
import { tileRows } from './infos';
import { loadSwatches } from './model';
import { runOperation, type Change, type Operation } from './ops';
import { Errors, bytesOf, intIn, isInt, objectBody } from './validate';
import { DEFAULT_EDGE_TABLE } from '../shared/rules';
import { cutTiles, edgeUpdates, type MapCell } from '../shared/tiles';
import { applyChanges } from './strokes';
import type { Patch } from '../shared/types';

interface TilesetRow {
  id: number;
  sprite_id: number;
  name: string;
  tile_size: number;
  edge_table: number[];
}

async function tilesetAccess(userId: number, id: string | undefined): Promise<TilesetRow> {
  const set = await one<TilesetRow>(pool, 'SELECT id, sprite_id, name, tile_size, edge_table FROM tilesets WHERE id = $1', [asId(id)]);
  if (!set) throw notFound();
  await spriteAccess(userId, set.sprite_id);
  return set;
}

interface TilemapRow {
  id: number;
  sprite_id: number;
  tileset_id: number;
  name: string;
  width: number;
  height: number;
}

async function tilemapAccess(userId: number, id: string | undefined): Promise<TilemapRow> {
  const map = await one<TilemapRow>(pool, 'SELECT id, sprite_id, tileset_id, name, width, height FROM tilemaps WHERE id = $1', [asId(id)]);
  if (!map) throw notFound();
  await spriteAccess(userId, map.sprite_id);
  return map;
}

const tilesOf = async (op: Operation, tilesetId: number): Promise<Uint8Array[]> =>
  (await rows<{ data: Buffer }>(op.tx, 'SELECT data FROM tiles WHERE tileset_id = $1 ORDER BY number', [tilesetId])).map((t) => new Uint8Array(t.data));

const usesOf = async (op: Operation, tilesetId: number, tile: number): Promise<number> =>
  (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM map_cells c JOIN tilemaps m ON m.id = c.tilemap_id WHERE m.tileset_id = $1 AND c.tile = $2', [tilesetId, tile]))?.n ?? 0;

route('POST', '/api/sprites/:id/tilesets', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const errors = new Errors();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '' || name.length > 80) errors.add('name', 'Name the tileset in up to 80 characters');
    if (body.tile_size !== 8 && body.tile_size !== 16) errors.add('tile_size', 'Use 8 or 16');
    errors.check();
    const set = await one<{ id: number }>(op.tx, 'INSERT INTO tilesets (sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4) RETURNING id', [
      op.sprite.id,
      name,
      body.tile_size,
      DEFAULT_EDGE_TABLE,
    ]);
    const seq = await op.emit('tile', { tilesets: [{ id: set?.id ?? 0, name, tile_size: body.tile_size as number, edge_table: [...DEFAULT_EDGE_TABLE] }] });
    return created({ id: set?.id, seq });
  }),
);

route('GET', '/api/tilesets/:id', async (ctx) => {
  const set = await tilesetAccess(ctx.need().id, ctx.params.id);
  const tiles = await rows<{ number: number; data: Buffer }>(pool, 'SELECT number, data FROM tiles WHERE tileset_id = $1 ORDER BY number', [set.id]);
  const uses = await rows<{ tile: number; n: number }>(
    pool,
    'SELECT c.tile, count(*)::int AS n FROM map_cells c JOIN tilemaps m ON m.id = c.tilemap_id WHERE m.tileset_id = $1 GROUP BY c.tile',
    [set.id],
  );
  return {
    id: set.id,
    name: set.name,
    tile_size: set.tile_size,
    edge_table: set.edge_table,
    tiles: tiles.map((t) => ({ id: t.number, rows: tileRows(new Uint8Array(t.data), set.tile_size), uses: uses.find((u) => u.tile === t.number)?.n ?? 0 })),
  };
});

route('POST', '/api/tilesets/:id/import', async (ctx) => {
  const set = await tilesetAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, set.sprite_id, 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const errors = new Errors();
    const frame = isInt(body.frame) ? await one<{ id: number }>(op.tx, 'SELECT id FROM frames WHERE sprite_id = $1 AND position = $2', [op.sprite.id, body.frame]) : undefined;
    const layer = await one<{ id: number }>(op.tx, 'SELECT id FROM layers WHERE sprite_id = $1 AND name = $2', [op.sprite.id, body.layer]);
    if (!frame) errors.add('frame', 'Choose a frame of this sprite');
    if (!layer) errors.add('layer', 'Choose a layer of this sprite');
    const map = body.tilemap === undefined ? undefined : await one<TilemapRow>(op.tx, 'SELECT id, sprite_id, tileset_id, name, width, height FROM tilemaps WHERE id = $1 AND tileset_id = $2', [body.tilemap, set.id]);
    if (body.tilemap !== undefined && !map) errors.add('tilemap', 'Choose a tilemap of this tileset');
    const offsetX = body.x ?? 0;
    const offsetY = body.y ?? 0;
    if (!isInt(offsetX) || !isInt(offsetY)) errors.add('x', 'Use whole numbers');
    errors.check();
    const cel = await one<{ data: Buffer }>(op.tx, 'SELECT b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id WHERE c.frame_id = $1 AND c.layer_id = $2', [frame?.id, layer?.id]);
    const existing = (await tilesOf(op, set.id)).map((t) => tileRows(t, set.tile_size));
    const cut = cutTiles(new Uint8Array(cel?.data ?? Buffer.alloc(op.sprite.width * op.sprite.height)), op.sprite.width, op.sprite.height, set.tile_size, existing);
    const added = cut.tiles.slice(existing.length);
    for (const [i, rowsOfTile] of added.entries()) {
      await op.tx.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [set.id, existing.length + i + 1, Buffer.from(rowsOfTile.flat())]);
    }
    const patch: Patch = {
      tiles: added.map((rowsOfTile, i) => ({ tileset: set.id, number: existing.length + i + 1, rows: rowsOfTile })),
    };
    let seq: number;
    if (map) {
      const placed = cut.cells.map((c) => ({ ...c, x: c.x + (offsetX as number), y: c.y + (offsetY as number) })).filter((c) => c.x >= 0 && c.y >= 0 && c.x < map.width && c.y < map.height);
      const written = await writeCells(op, map, placed);
      patch.mapCells = [{ map: map.id, cells: written.changed }];
      patch.counts = await op.counts();
      seq = await op.emit('tile', patch, written.changes);
    } else {
      patch.counts = await op.counts();
      seq = await op.emit('tile', patch);
    }
    return created({ tiles_added: added.length, cells: cut.cells, seq });
  });
});

route('PATCH', '/api/tilesets/:id/tiles/:n', async (ctx) => {
  const set = await tilesetAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, set.sprite_id, 'artwork', async (op) => {
    const number = asId(ctx.params.n);
    const tile = await one<{ number: number }>(op.tx, 'SELECT number FROM tiles WHERE tileset_id = $1 AND number = $2', [set.id, number]);
    if (!tile) throw notFound();
    const swatches = new Set((await loadSwatches(op.tx, op.sprite.palette_id)).filter((s) => !s.removed).map((s) => s.idx));
    const tileRowsBody = bytesOf(objectBody(ctx.body).rows);
    const sized = tileRowsBody !== null && tileRowsBody.length === set.tile_size && tileRowsBody.every((r) => r.length === set.tile_size);
    if (!tileRowsBody || !sized || !tileRowsBody.flat().every((v) => v === 0 || swatches.has(v))) {
      throw invalid({ rows: `Send ${set.tile_size} rows of ${set.tile_size} swatch indices` });
    }
    await op.tx.query('UPDATE tiles SET data = $3 WHERE tileset_id = $1 AND number = $2', [set.id, number, Buffer.from(tileRowsBody.flat())]);
    const seq = await op.emit('tile', { tiles: [{ tileset: set.id, number, rows: tileRowsBody }], counts: await op.counts() });
    return { uses: await usesOf(op, set.id, number), seq };
  });
});

route('PATCH', '/api/tilesets/:id/edges', async (ctx) => {
  const set = await tilesetAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, set.sprite_id, 'artwork', async (op) => {
    const table = objectBody(ctx.body).table;
    const count = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM tiles WHERE tileset_id = $1', [set.id]))?.n ?? 0;
    if (!Array.isArray(table) || table.length !== 16 || !table.every((t) => intIn(t, 1, count))) throw invalid({ table: 'Use 16 existing tile numbers' });
    await op.tx.query('UPDATE tilesets SET edge_table = $2 WHERE id = $1', [set.id, table]);
    return { seq: await op.emit('tile', { tilesets: [{ id: set.id, name: set.name, tile_size: set.tile_size, edge_table: table as number[] }] }) };
  });
});

route('POST', '/api/sprites/:id/tilemaps', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const errors = new Errors();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const set = isInt(body.tileset) ? await one<{ id: number }>(op.tx, 'SELECT id FROM tilesets WHERE id = $1 AND sprite_id = $2', [body.tileset, op.sprite.id]) : undefined;
    if (name === '' || name.length > 80) errors.add('name', 'Name the tilemap in up to 80 characters');
    if (!set) errors.add('tileset', 'Choose a tileset of this sprite');
    for (const field of ['width', 'height'] as const) if (!intIn(body[field], 1, 128)) errors.add(field, 'Use 1 to 128');
    errors.check();
    const map = await one<{ id: number }>(op.tx, 'INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
      op.sprite.id,
      set?.id,
      name,
      body.width,
      body.height,
    ]);
    const seq = await op.emit('tilemap', { tilemaps: [{ id: map?.id ?? 0, tileset: set?.id ?? 0, name, width: body.width as number, height: body.height as number }] });
    return created({ id: map?.id, seq });
  }),
);

route('GET', '/api/tilemaps/:id', async (ctx) => {
  const map = await tilemapAccess(ctx.need().id, ctx.params.id);
  const cells = await rows<MapCell>(pool, 'SELECT x, y, tile, flip_h, flip_v FROM map_cells WHERE tilemap_id = $1 ORDER BY y, x', [map.id]);
  const seq = (await one<{ seq: number }>(pool, 'SELECT seq FROM sprites WHERE id = $1', [map.sprite_id]))?.seq ?? 0;
  return { id: map.id, name: map.name, tileset: map.tileset_id, width: map.width, height: map.height, cells, seq };
});

/** Writes map cells, recording only those that differ; the one place the map changes. */
async function writeCells(op: Operation, map: TilemapRow, desired: readonly MapCell[]): Promise<{ changed: MapCell[]; changes: Change[] }> {
  const current = new Map((await rows<MapCell>(op.tx, 'SELECT x, y, tile, flip_h, flip_v FROM map_cells WHERE tilemap_id = $1', [map.id])).map((c) => [`${c.x},${c.y}`, c]));
  const changes: Change[] = [];
  const changed: MapCell[] = [];
  for (const cell of [...desired].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const before = current.get(`${cell.x},${cell.y}`) ?? { x: cell.x, y: cell.y, tile: 0, flip_h: false, flip_v: false };
    if (before.tile === cell.tile && before.flip_h === cell.flip_h && before.flip_v === cell.flip_v) continue;
    changes.push(['map', map.id, cell.x, cell.y, before.tile, before.flip_h, before.flip_v, cell.tile, cell.flip_h, cell.flip_v]);
    changed.push(cell);
  }
  if (changes.length > 0) await applyChanges(op, changes);
  return { changed, changes };
}

/** Emits a map change as one operation and records it for undo. */
async function commitMap(op: Operation, map: TilemapRow, written: { changed: MapCell[]; changes: Change[] }): Promise<number> {
  const seq = await op.emit('tilemap', { mapCells: [{ map: map.id, cells: written.changed }], counts: await op.counts() }, written.changes);
  if (written.changes.length > 0) await op.recordUndo(seq, written.changes);
  return seq;
}

const tileCount = async (op: Operation, tilesetId: number): Promise<number> =>
  (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM tiles WHERE tileset_id = $1', [tilesetId]))?.n ?? 0;

route('POST', '/api/tilemaps/:id/cells', async (ctx) => {
  const map = await tilemapAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, map.sprite_id, 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const errors = new Errors();
    const count = await tileCount(op, map.tileset_id);
    if (!intIn(body.x, 0, map.width - 1)) errors.add('x', `Use 0 to ${map.width - 1}`);
    if (!intIn(body.y, 0, map.height - 1)) errors.add('y', `Use 0 to ${map.height - 1}`);
    if (!intIn(body.tile, 0, count)) errors.add('tile', 'Choose an existing tile');
    errors.check();
    const x = body.x as number;
    const y = body.y as number;
    const erase = body.tile === 0;
    const flips = { flip_h: body.flip_h === true && !erase, flip_v: body.flip_v === true && !erase };
    if (body.edge_matching !== true) {
      const written = await writeCells(op, map, [{ x, y, tile: body.tile as number, ...flips }]);
      const seq = await commitMap(op, map, written);
      return created({ seq, changed: written.changed.map((c) => ({ ...c, mask: null })) });
    }
    const tileset = await one<{ edge_table: number[] }>(op.tx, 'SELECT edge_table FROM tilesets WHERE id = $1', [map.tileset_id]);
    const filled = new Map((await rows<MapCell>(op.tx, 'SELECT x, y, tile, flip_h, flip_v FROM map_cells WHERE tilemap_id = $1', [map.id])).map((c) => [`${c.x},${c.y}`, c.tile]));
    const updates = edgeUpdates(filled, map.width, map.height, x, y, erase, tileset?.edge_table ?? DEFAULT_EDGE_TABLE);
    if (updates.some((u) => u.tile < 1 || u.tile > count)) throw invalid({ tile: 'Edge table points at a missing tile' });
    const desired: MapCell[] = updates.map((u) => ({ x: u.x, y: u.y, tile: u.tile, flip_h: false, flip_v: false }));
    if (erase) desired.push({ x, y, tile: 0, flip_h: false, flip_v: false });
    const written = await writeCells(op, map, desired);
    const masks = new Map(updates.map((u) => [`${u.x},${u.y}`, u.mask]));
    const seq = await commitMap(op, map, written);
    return created({ seq, changed: written.changed.map((c) => ({ ...c, mask: masks.get(`${c.x},${c.y}`) ?? null })) });
  });
});

route('PATCH', '/api/tilemaps/:id/cells/:x/:y', async (ctx) => {
  const map = await tilemapAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, map.sprite_id, 'artwork', async (op) => {
    const x = Number(ctx.params.x);
    const y = Number(ctx.params.y);
    const cell = await one<MapCell>(op.tx, 'SELECT x, y, tile, flip_h, flip_v FROM map_cells WHERE tilemap_id = $1 AND x = $2 AND y = $3', [map.id, x, y]);
    if (!cell) throw invalid({ x: 'That cell is empty' });
    const body = objectBody(ctx.body);
    const written = await writeCells(op, map, [{ ...cell, flip_h: typeof body.flip_h === 'boolean' ? body.flip_h : cell.flip_h, flip_v: typeof body.flip_v === 'boolean' ? body.flip_v : cell.flip_v }]);
    return { seq: await commitMap(op, map, written) };
  });
});

route('POST', '/api/tilemaps/:id/stamp', async (ctx) => {
  const map = await tilemapAccess(ctx.need().id, ctx.params.id);
  return runOperation(ctx.need().id, map.sprite_id, 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const count = await tileCount(op, map.tileset_id);
    const stamp = body.cells;
    const valid =
      isInt(body.x) && isInt(body.y) && Array.isArray(stamp) && stamp.length > 0 &&
      stamp.every((row) => Array.isArray(row) && row.length > 0 && row.every((c) => intIn(objectBody(c).tile, 0, count)));
    if (!valid) throw invalid({ cells: 'Send rows of existing tiles' });
    const desired: MapCell[] = [];
    (stamp as Record<string, unknown>[][]).forEach((row, r) =>
      row.forEach((c, k) => {
        const cell = { x: (body.x as number) + k, y: (body.y as number) + r, tile: c.tile as number, flip_h: c.flip_h === true && c.tile !== 0, flip_v: c.flip_v === true && c.tile !== 0 };
        if (cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height) desired.push(cell);
      }),
    );
    const written = await writeCells(op, map, desired);
    return created({ seq: await commitMap(op, map, written), changed: written.changed });
  });
});
