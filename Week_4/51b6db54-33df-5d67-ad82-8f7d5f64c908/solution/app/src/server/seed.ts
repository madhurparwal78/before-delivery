import type { PoolClient } from 'pg';
import { hashPassword } from './auth';
import { moveClock, now, instant, syncClock } from './clock';
import { config, SEED_BODY_MAX } from './config';
import { one, transaction } from './db';
import { HttpError, invalid, notFound } from './errors';
import { broadcastClock } from './hub';
import { route } from './http';
import { captureSnapshot } from './snapshots';
import { isColour } from '../shared/colour';
import { courtyardCells, groundTile, gumdropCels, GUMDROP_PALETTE, GUMDROP_SIZE } from '../shared/art';
import { isInt, objectBody, type Json } from './validate';
import { loadSpriteRow } from './model';

type Ids = Record<string, number>;

const list = (body: Json, key: string): Json[] => (Array.isArray(body[key]) ? (body[key] as unknown[]).map(objectBody) : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

class SeedRefusal extends Error {}

function refuse(message: string): never {
  throw new SeedRefusal(message);
}

/** Creates the published records of a seed body in one transaction; any broken reference or limit refuses it whole. */
export async function seedWorld(tx: PoolClient, body: Json): Promise<Ids> {
  const ids: Ids = {};
  const claim = (key: string, id: number): void => {
    if (key === '' || key in ids) refuse(`Key ${key} is not unique`);
    ids[key] = id;
  };
  const ref = (key: unknown, what: string): number => ids[str(key)] ?? refuse(`Unknown ${what} ${str(key)}`);
  const { limits } = config;
  for (const user of list(body, 'users')) {
    const email = str(user.email).toLowerCase();
    const row = await one<{ id: number }>(
      tx,
      'INSERT INTO users (email, name, password_hash, confirmed, number_format, time_zone) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id',
      [email, str(user.name), hashPassword(str(user.password)), user.confirmed !== false, str(user.number_format) || 'en-US', str(user.time_zone) || 'UTC'],
    );
    if (!row) refuse(`Email ${email} is taken`);
    claim(str(user.key), row.id);
  }
  for (const project of list(body, 'projects')) {
    const owner = ref(project.owner, 'user');
    const row = await one<{ id: number }>(tx, 'INSERT INTO projects (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING id', [str(project.name), owner, now()]);
    claim(str(project.key), row?.id ?? 0);
    await tx.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'owner')", [row?.id, owner]);
  }
  for (const member of list(body, 'memberships')) {
    const row = await tx.query('INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [ref(member.project, 'project'), ref(member.user, 'user'), str(member.role)]);
    if (!['editor', 'reviewer', 'owner'].includes(str(member.role))) refuse('Unknown role');
    claim(str(member.key), row.rowCount ?? 0);
  }
  for (const palette of list(body, 'palettes')) {
    const swatches = (Array.isArray(palette.swatches) ? palette.swatches : []).map(objectBody);
    if (swatches.length > limits.paletteMax) refuse('Palette is over the limit');
    const row = await one<{ id: number }>(tx, 'INSERT INTO palettes (ord) VALUES ($1) RETURNING id', [swatches.map((s) => s.index)]);
    for (const swatch of swatches) {
      if (!isInt(swatch.index) || swatch.index < 1 || !isColour(swatch.color)) refuse('Swatch is not valid');
      await tx.query('INSERT INTO swatches (palette_id, idx, color, version) VALUES ($1, $2, $3, 1)', [row?.id, swatch.index, swatch.color]);
    }
    claim(str(palette.key), row?.id ?? 0);
  }
  const sizes = new Map<number, { width: number; height: number }>();
  for (const sprite of list(body, 'sprites')) {
    const { width, height } = sprite;
    if (!isInt(width) || !isInt(height) || width < 1 || height < 1 || width > limits.spriteMax || height > limits.spriteMax) refuse('Sprite is over the limit');
    const row = await one<{ id: number }>(tx, 'INSERT INTO sprites (project_id, palette_id, name, width, height, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [
      ref(sprite.project, 'project'),
      ref(sprite.palette, 'palette'),
      str(sprite.name),
      width,
      height,
      now(),
    ]);
    claim(str(sprite.key), row?.id ?? 0);
    sizes.set(row?.id ?? 0, { width, height });
  }
  const counts = new Map<number, number>();
  const layerSprites = list(body, 'layers');
  for (const layer of layerSprites) counts.set(ref(layer.sprite, 'sprite'), (counts.get(ref(layer.sprite, 'sprite')) ?? 0) + 1);
  const placed = new Map<number, number>();
  for (const layer of layerSprites) {
    const sprite = ref(layer.sprite, 'sprite');
    const index = placed.get(sprite) ?? 0;
    placed.set(sprite, index + 1);
    const row = await one<{ id: number }>(tx, 'INSERT INTO layers (sprite_id, name, opacity, blend, visible, locked_by, position) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
      sprite,
      str(layer.name),
      layer.opacity ?? 100,
      layer.blend ?? 'normal',
      layer.visible !== false,
      layer.locked_by ? ref(layer.locked_by, 'user') : null,
      (counts.get(sprite) ?? 1) - index,
    ]);
    claim(str(layer.key), row?.id ?? 0);
  }
  const framesPlaced = new Map<number, number>();
  for (const frame of list(body, 'frames')) {
    const sprite = ref(frame.sprite, 'sprite');
    if (!isInt(frame.duration_ms) || frame.duration_ms < limits.frameMinMs || frame.duration_ms > limits.frameMaxMs) refuse('Frame duration is over the limit');
    const position = (framesPlaced.get(sprite) ?? 0) + 1;
    framesPlaced.set(sprite, position);
    const row = await one<{ id: number }>(tx, 'INSERT INTO frames (sprite_id, position, duration_ms) VALUES ($1, $2, $3) RETURNING id', [sprite, position, frame.duration_ms]);
    claim(str(frame.key), row?.id ?? 0);
  }
  const spriteOfFrame = async (frame: number): Promise<number> => (await one<{ sprite_id: number }>(tx, 'SELECT sprite_id FROM frames WHERE id = $1', [frame]))?.sprite_id ?? 0;
  const celSpecs = list(body, 'cels');
  const buffers = new Map<string, number>();
  for (const cel of celSpecs.filter((c) => !('link_to' in c))) {
    const frame = ref(cel.frame, 'frame');
    const layer = ref(cel.layer, 'layer');
    const size = sizes.get(await spriteOfFrame(frame)) ?? refuse('Unknown sprite');
    const celRows = Array.isArray(cel.rows) ? (cel.rows as unknown[]).map((r) => (Array.isArray(r) ? (r as unknown[]) : [])) : [];
    if (celRows.length !== size.height || celRows.some((r) => r.length !== size.width || r.some((v) => !isInt(v) || v < 0 || v > 255))) refuse('Cel rows do not fit the sprite');
    const row = await one<{ id: number }>(tx, 'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id', [await spriteOfFrame(frame), Buffer.from(celRows.flat() as number[])]);
    await tx.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [frame, layer, row?.id]);
    buffers.set(`${frame}:${layer}`, row?.id ?? 0);
    claim(str(cel.key), row?.id ?? 0);
  }
  for (const cel of celSpecs.filter((c) => 'link_to' in c)) {
    const frame = ref(cel.frame, 'frame');
    const layer = ref(cel.layer, 'layer');
    const source = buffers.get(`${ref(cel.link_to, 'frame')}:${layer}`) ?? refuse('Link target has no cel');
    await tx.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [frame, layer, source]);
    claim(str(cel.key), source);
  }
  for (const tag of list(body, 'tags')) {
    const row = await one<{ id: number }>(tx, 'INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [
      ref(tag.sprite, 'sprite'),
      str(tag.name),
      tag.from,
      tag.to,
      str(tag.direction),
      tag.repeat ?? 0,
    ]);
    claim(str(tag.key), row?.id ?? 0);
  }
  for (const set of list(body, 'tilesets')) {
    const sprite = ref(set.sprite, 'sprite');
    const row = await one<{ id: number }>(tx, 'INSERT INTO tilesets (sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4) RETURNING id', [
      sprite,
      str(set.name),
      set.tile_size,
      Array.isArray(set.edge_table) ? set.edge_table : Array.from({ length: 16 }, (_, i) => i + 1),
    ]);
    claim(str(set.key), row?.id ?? 0);
    const tiles = Array.isArray(set.tiles) ? set.tiles.map(objectBody) : [];
    for (const [i, tile] of tiles.entries()) {
      const tileRows = Array.isArray(tile.rows) ? (tile.rows as number[][]) : [];
      if (tileRows.length !== set.tile_size || tileRows.some((r) => r.length !== set.tile_size)) refuse('Tile rows do not fit the tile size');
      await tx.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [row?.id, i + 1, Buffer.from(tileRows.flat())]);
      claim(str(tile.key), i + 1);
    }
  }
  for (const map of list(body, 'tilemaps')) {
    const row = await one<{ id: number }>(tx, 'INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
      ref(map.sprite, 'sprite'),
      ref(map.tileset, 'tileset'),
      str(map.name),
      map.width,
      map.height,
    ]);
    claim(str(map.key), row?.id ?? 0);
    for (const cell of (Array.isArray(map.cells) ? map.cells : []).map(objectBody)) {
      await tx.query('INSERT INTO map_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)', [row?.id, cell.x, cell.y, cell.tile, cell.flip_h === true, cell.flip_v === true]);
    }
  }
  for (const comment of list(body, 'comments')) {
    const row = await one<{ id: number }>(
      tx,
      'INSERT INTO comments (sprite_id, author_id, frame, x, y, text, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [ref(comment.sprite, 'sprite'), ref(comment.author, 'user'), comment.frame, comment.x, comment.y, str(comment.text), str(comment.state) || 'open', now()],
    );
    claim(str(comment.key), row?.id ?? 0);
  }
  for (const link of list(body, 'share_links')) {
    const row = await one<{ id: number }>(tx, 'INSERT INTO share_links (sprite_id, label, token, expires_at) VALUES ($1, $2, $3, $4) RETURNING id', [
      ref(link.sprite, 'sprite'),
      str(link.label),
      str(link.token),
      link.expires_at ? Date.parse(str(link.expires_at)) : null,
    ]);
    claim(str(link.key), row?.id ?? 0);
  }
  for (const invite of list(body, 'invites')) {
    const project = ref(invite.project, 'project');
    const owner = (await one<{ owner_id: number }>(tx, 'SELECT owner_id FROM projects WHERE id = $1', [project]))?.owner_id;
    const row = await one<{ id: number }>(
      tx,
      "INSERT INTO invites (project_id, email, role, token, state, expires_at, created_by, created_at) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING id",
      [project, str(invite.email).toLowerCase(), str(invite.role), str(invite.token), Date.parse(str(invite.expires_at)), owner, now()],
    );
    claim(str(invite.key), row?.id ?? 0);
  }
  for (const snapshot of list(body, 'snapshots')) {
    const spriteId = ref(snapshot.sprite, 'sprite');
    const sprite = await loadSpriteRow(tx, spriteId);
    if (!sprite) refuse('Unknown sprite');
    const info = await captureSnapshot(tx, sprite, str(snapshot.name), 0);
    claim(str(snapshot.key), info.id);
  }
  return ids;
}

const gradingKeyOk = (provided: string | string[] | undefined): boolean => config.gradingKey !== '' && provided === config.gradingKey;

route(
  'POST',
  '/api/grading/seed',
  async (ctx) => {
    if (!gradingKeyOk(ctx.req.headers['x-grading-key'])) throw notFound();
    try {
      const ids = await transaction((tx) => seedWorld(tx, objectBody(ctx.body)));
      return { status: 201, body: { ids } };
    } catch (error) {
      if (error instanceof SeedRefusal) throw invalid({ seed: error.message });
      if (error instanceof HttpError) throw error;
      if ((error as { code?: string }).code?.startsWith('23')) throw invalid({ seed: 'A reference or a value in the seed is not valid' });
      throw error;
    }
  },
  { bodyMax: SEED_BODY_MAX },
);

route('POST', '/api/grading/clock', async (ctx) => {
  if (!gradingKeyOk(ctx.req.headers['x-grading-key'])) throw notFound();
  const body = objectBody(ctx.body);
  await syncClock();
  let moved: number;
  if (typeof body.advance_seconds === 'number' && Number.isFinite(body.advance_seconds) && body.advance_seconds >= 0) {
    moved = await moveClock({ advanceSeconds: body.advance_seconds });
  } else if (typeof body.set === 'string' && !Number.isNaN(Date.parse(body.set)) && Date.parse(body.set) >= now()) {
    moved = await moveClock({ set: Date.parse(body.set) });
  } else throw invalid({ clock: 'Send advance_seconds from 0 or a set time not earlier than now' });
  broadcastClock();
  return { now: instant(moved) };
});

/** The demo workspace of a first start: the same records, drawn by the same code, every time. */
export async function seedDemo(): Promise<void> {
  await transaction(async (tx) => {
    const exists = await one(tx, 'SELECT 1 FROM users LIMIT 1');
    if (exists) return;
    const layerNames = ['Shadow', 'Body', 'Outline'] as const;
    const cels = Array.from({ length: 8 }, (_, f) => {
      const art = gumdropCels(f);
      return [art.shadow, art.body, art.outline];
    }).flatMap((layerRows, f) => layerRows.map((celRows, l) => ({ key: `c${f}-${l}`, frame: `f${f}`, layer: `l${l}`, rows: celRows })));
    const world: Json = {
      users: [
        { key: 'owner', email: 'demo@celmate.example', name: 'Demo Owner', password: 'celmate-demo-1' },
        { key: 'editor', email: 'demo-editor@celmate.example', name: 'Demo Editor', password: 'celmate-demo-2' },
        { key: 'reviewer', email: 'demo-reviewer@celmate.example', name: 'Demo Reviewer', password: 'celmate-demo-3' },
      ],
      projects: [{ key: 'p', name: 'Marzipan Demo', owner: 'owner' }],
      memberships: [
        { key: 'm1', project: 'p', user: 'editor', role: 'editor' },
        { key: 'm2', project: 'p', user: 'reviewer', role: 'reviewer' },
      ],
      palettes: [{ key: 'pal', swatches: GUMDROP_PALETTE.map((color, i) => ({ index: i + 1, color: i === 1 ? 'ff6fa8ff' : color })) }],
      sprites: [{ key: 's', project: 'p', palette: 'pal', name: 'Gumdrop Walker', width: GUMDROP_SIZE, height: GUMDROP_SIZE }],
      layers: layerNames.map((name, i) => ({ key: `l${i}`, sprite: 's', name, opacity: 100, blend: 'normal', visible: true, locked_by: null })),
      frames: Array.from({ length: 8 }, (_, f) => ({ key: `f${f}`, sprite: 's', duration_ms: 100 })),
      cels,
      tags: [
        { key: 'walk', sprite: 's', name: 'walk', from: 1, to: 8, direction: 'forward', repeat: 0 },
        { key: 'bounce', sprite: 's', name: 'bounce', from: 2, to: 5, direction: 'pingpong', repeat: 0 },
      ],
      tilesets: [{ key: 'ts', sprite: 's', name: 'Candy Ground', tile_size: 8, tiles: Array.from({ length: 16 }, (_, mask) => ({ key: `t${mask}`, rows: groundTile(mask) })) }],
      tilemaps: [{ key: 'tm', sprite: 's', tileset: 'ts', name: 'Courtyard', width: 12, height: 8, cells: courtyardCells() }],
      comments: [
        { key: 'k1', sprite: 's', author: 'reviewer', frame: 3, x: 9, y: 17, text: 'Outline breaks on the left foot here.', state: 'open' },
        { key: 'k2', sprite: 's', author: 'reviewer', frame: 5, x: 16, y: 29, text: 'Can the shadow sit one pixel lower?', state: 'open' },
        { key: 'k3', sprite: 's', author: 'reviewer', frame: 1, x: 14, y: 12, text: 'Colour pass looks right on this frame.', state: 'resolved' },
      ],
      snapshots: [{ key: 'first', sprite: 's', name: 'First pass' }],
      share_links: [{ key: 'link', sprite: 's', label: 'Client preview', token: 'demo-gumdrop', expires_at: '2030-01-01T00:00:00.000Z' }],
    };
    const ids = await seedWorld(tx, world);
    await tx.query('UPDATE swatches SET color = $2, version = version + 1 WHERE palette_id = $1 AND idx = 2', [ids.pal, GUMDROP_PALETTE[1]]);
    const sprite = await loadSpriteRow(tx, ids.s ?? 0);
    if (sprite) await captureSnapshot(tx, sprite, 'Colour pass', 0);
  });
}

