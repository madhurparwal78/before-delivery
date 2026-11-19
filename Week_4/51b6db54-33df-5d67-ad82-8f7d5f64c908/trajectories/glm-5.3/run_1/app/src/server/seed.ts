// Deterministic demo workspace created on a first start with no people.
import { q, one } from './db.js';
import { now } from './clock.js';
import { hashPassword } from './config.js';
import { captureState } from './review.js';
import { writeCel, blankRows } from './sprites.js';

const PALETTE = [
  '1a0c22ff', 'f2e9e4ff', 'ffb3c7ff', 'ff5d8fff', 'ff8040ff', 'ffc44dff',
  'fff2b2ff', '9ce966ff', '4ecdc4ff', '44c1ffff', '6a5acdff', 'b8a9d9ff'
];

interface Person { email: string; name: string; password: string; role: string }

const PEOPLE: Person[] = [
  { email: 'demo@celmate.example', name: 'Demo Owner', password: 'celmate-demo-1', role: 'owner' },
  { email: 'demo-editor@celmate.example', name: 'Demo Editor', password: 'celmate-demo-2', role: 'editor' },
  { email: 'demo-reviewer@celmate.example', name: 'Demo Reviewer', password: 'celmate-demo-3', role: 'reviewer' }
];

export async function seedDemo(): Promise<void> {
  const anyUser = await one<{ id: string }>('select id::text from users limit 1');
  if (anyUser) return;
  const at = await now();
  const ids: number[] = [];
  for (const p of PEOPLE) {
    const row = await one<{ id: string }>(
      `insert into users (email, name, password_hash, confirm_code, confirmed, number_format, time_zone, created_at)
       values ($1, $2, $3, null, true, 'en-US', 'UTC', $4) returning id::text`,
      [p.email, p.name, hashPassword(p.password), at]
    );
    ids.push(Number(row!.id));
  }
  const project = await one<{ id: string }>('insert into projects (name, owner_id, created_at) values ($1, $2, $3) returning id::text',
    ['Marzipan Demo', ids[0], at]);
  for (let i = 0; i < PEOPLE.length; i++) {
    await q('insert into memberships (project_id, user_id, role, joined_at) values ($1, $2, $3, $4)',
      [project!.id, ids[i], PEOPLE[i].role, at]);
  }
  // sprite: Gumdrop Walker, 32x32, 8 frames, layers Shadow Body Outline
  const palette = await one<{ id: string }>('insert into palettes (sprite_id, seq_at_creation) values (0, 0) returning id::text');
  const sprite = await one<{ id: string }>(
    'insert into sprites (project_id, palette_id, name, width, height, seq, created_at) values ($1, $2, $3, 32, 32, 0, $4) returning id::text',
    [project!.id, palette!.id, 'Gumdrop Walker', at]
  );
  await q('update palettes set sprite_id = $1 where id = $2', [sprite!.id, palette!.id]);
  for (let i = 0; i < PALETTE.length; i++) {
    await q('insert into swatches (palette_id, index, color, version, last_version) values ($1, $2, $3, 1, 1)',
      [palette!.id, i + 1, PALETTE[i]]);
  }
  for (const [position, name] of [[3, 'Shadow'], [2, 'Body'], [1, 'Outline']] as [number, string][]) {
    await q('insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, $3, $4, true, null, $5)',
      [sprite!.id, name, name === 'Shadow' ? 60 : 100, 'normal', position]);
  }
  const layerIds: Record<string, string> = {};
  for (const name of ['Shadow', 'Body', 'Outline']) {
    const row = await one<{ id: string }>('select id::text from layers where sprite_id = $1 and name = $2', [sprite!.id, name]);
    layerIds[name] = row!.id;
  }
  // 8 frames of 100ms with a walking bounce
  const frameIds: string[] = [];
  for (let f = 1; f <= 8; f++) {
    const row = await one<{ id: string }>(
      'insert into frames (sprite_id, position, duration_ms) values ($1, $2, 100) returning id::text',
      [sprite!.id, f]
    );
    frameIds.push(row!.id);
    const bounce = f <= 4 ? f - 1 : 8 - f; // 0..3..0
    const body = drawGumdrop(32, 32, bounce);
    await writeCel(Number(row!.id), Number(layerIds['Body']), body);
    await writeCel(Number(row!.id), Number(layerIds['Outline']), outlineOf(body, 2));
    await writeCel(Number(row!.id), Number(layerIds['Shadow']), shadowOf(32, 32, bounce));
  }
  await q('insert into tags (sprite_id, name, from_frame, to_frame, direction, repeat) values ($1, $2, 1, 8, $3, 0)',
    [sprite!.id, 'walk', 'forward']);
  await q('insert into tags (sprite_id, name, from_frame, to_frame, direction, repeat) values ($1, $2, 2, 5, $3, 0)',
    [sprite!.id, 'bounce', 'pingpong']);
  // tileset: Candy Ground, tile size 8, 16 tiles, default edge table
  const tileset = await one<{ id: string }>(
    'insert into tilesets (sprite_id, name, tile_size, edge_table) values ($1, $2, 8, $3::jsonb) returning id::text',
    [sprite!.id, 'Candy Ground', JSON.stringify(Array.from({ length: 16 }, (_, i) => i + 1))]
  );
  for (let t = 1; t <= 16; t++) {
    const rows = drawTile(t);
    await q('insert into tiles (tileset_id, num, rows) values ($1, $2, $3::jsonb)', [tileset!.id, t, JSON.stringify(rows)]);
  }
  const tilemap = await one<{ id: string }>(
    'insert into tilemaps (sprite_id, tileset_id, name, width, height) values ($1, $2, $3, 12, 8) returning id::text',
    [sprite!.id, tileset!.id, 'Courtyard']
  );
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const tile = 1 + ((x + y * 12) % 16);
      await q('insert into tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) values ($1, $2, $3, $4, false, false)',
        [tilemap!.id, x, y, tile]);
    }
  }
  // comments by Demo Reviewer
  const comments: [number, number, number, string, string][] = [
    [3, 14, 20, 'Outline breaks on the left foot here.', 'open'],
    [5, 15, 21, 'Can the shadow sit one pixel lower?', 'open'],
    [1, 16, 10, 'Colour pass looks right on this frame.', 'resolved']
  ];
  for (const [frame, x, y, text, state] of comments) {
    await q('insert into comments (sprite_id, author_id, frame, x, y, text, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [sprite!.id, ids[2], frame, x, y, text, state, at]);
  }
  // snapshots: First pass then Colour pass
  const first = await captureState(Number(sprite!.id));
  await q('insert into snapshots (sprite_id, name, seq, state, at) values ($1, $2, 0, $3::jsonb, $4)',
    [sprite!.id, 'First pass', JSON.stringify(first), at]);
  const second = await captureState(Number(sprite!.id));
  await q('insert into snapshots (sprite_id, name, seq, state, at) values ($1, $2, 0, $3::jsonb, $4)',
    [sprite!.id, 'Colour pass', JSON.stringify(second), at]);
  // read-only link
  await q('insert into share_links (sprite_id, label, token, state, expires_at, created_at) values ($1, $2, $3, $4, $5, $6)',
    [sprite!.id, 'Client preview', 'demo-gumdrop', 'active', '2030-01-01T00:00:00.000Z', at]);
}

/** A generated gumdrop walker frame: candy body, feet, highlight. */
function drawGumdrop(w: number, h: number, bounce: number): number[][] {
  const rows = blankRows(w, h);
  const put = (x: number, y: number, idx: number): void => {
    if (x < 0 || y < 0 || y >= h || x >= w) return;
    rows[y][x] = idx;
  };
  const cx = 15;
  const top = 9 - bounce;
  // dome body (indices: 4 body, 3 deep pink, 6 shine, 5 rim)
  for (let y = 0; y < 14; y++) {
    const t = y / 13;
    const half = Math.round(9 - t * t * 4.5);
    for (let x = -half; x <= half; x++) put(cx + x, top + y, 4);
  }
  // feet with alternating step
  const step = bounce % 2 === 0 ? 0 : 1;
  for (let fx = 0; fx < 3; fx++) {
    put(cx - 6 + fx, top + 14 + (step === 1 && fx < 2 ? 0 : 0), 3);
    put(cx + 3 + fx, top + 14 + (step === 0 && fx < 2 ? 0 : 0), 3);
  }
  for (let fx = 0; fx < 3; fx++) {
    put(cx - 6 + fx, top + 14, 3);
    put(cx + 3 + fx, top + 14 - step, 3);
  }
  // shine
  for (let i = 0; i < 4; i++) {
    put(cx - 4 + i, top + 3, 6);
    put(cx - 5 + i, top + 4, 6);
  }
  // candy rim
  for (let x = -10; x <= 10; x += 1) {
    if (Math.abs(x) <= 10) put(cx + x, top + 12, 5);
  }
  return rows;
}

function outlineOf(body: number[][], colorIdx: number): number[][] {
  const h = body.length, w = body[0].length;
  const rows = blankRows(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const filled = body[y][x] !== 0;
      const neighbourEmpty = (x === 0 || body[y][x - 1] === 0) || (x === w - 1 || body[y][x + 1] === 0) ||
        (y === 0 || body[y - 1][x] === 0) || (y === h - 1 || body[y + 1][x] === 0);
      if (filled && neighbourEmpty) rows[y][x] = colorIdx;
    }
  }
  return rows;
}

function shadowOf(w: number, h: number, bounce: number): number[][] {
  const rows = blankRows(w, h);
  const y = 25 - Math.floor(bounce / 2);
  for (let x = 7; x <= 24; x++) {
    const half = Math.max(0, 6 - Math.abs((x - 15.5) / 2));
    for (let dy = 0; dy < Math.max(1, Math.round(half / 3)); dy++) {
      if (y + dy < h) rows[y + dy][x] = 1;
    }
  }
  return rows;
}

function drawTile(n: number): number[][] {
  const rows = blankRows(8, 8);
  const base = 7 + (n % 3);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const speck = (x * 3 + y * 5 + n * 7) % 11 === 0;
      rows[y][x] = speck ? 8 : base;
    }
  }
  return rows;
}
