import type { PoolClient } from 'pg';
import { defaultEdgeTable } from '../shared/edges.js';
import { now } from './clock.js';
import { first, transact } from './db.js';
import { hashPassword } from './secrets.js';
import { captureSnapshot } from './snapshots.js';
import { tileBuffer } from './sprite.js';

const WIDTH = 32;
const HEIGHT = 32;
const FRAMES = 8;

const PALETTE = [
  'ff6fae ff',
  '2b1a2e ff',
  'ffe9f4 ff',
  '9be7ff ff',
  '2f7bd1 ff',
  'ffd166 ff',
  'f7f3e8 ff',
  '6ad8a0 ff',
  '3a7d5d ff',
  'ff9f4a ff',
  'b388ff ff',
  '12101a ff',
].map((colour) => colour.replace(/\s/g, ''));

interface Cel {
  shadow: Buffer;
  body: Buffer;
  outline: Buffer;
}

/** The walker is drawn by rule, so every first start makes the same artwork. */
function drawFrame(frame: number): Cel {
  const shadow = Buffer.alloc(WIDTH * HEIGHT);
  const body = Buffer.alloc(WIDTH * HEIGHT);
  const outline = Buffer.alloc(WIDTH * HEIGHT);
  const bounce = [0, 1, 2, 2, 1, 0, 0, 1][frame % FRAMES];
  const centreX = 16;
  const baseY = 24 - bounce;

  for (let x = 9; x <= 22; x += 1) {
    const spread = Math.round(3 - Math.abs(x - 15.5) / 3);
    for (let y = 26; y <= 26 + Math.max(0, spread - 2); y += 1) {
      shadow[y * WIDTH + x] = 12;
    }
  }

  for (let y = 6; y <= baseY; y += 1) {
    const span = Math.round(2 + 7 * Math.sin(((y - 4) / (baseY - 2)) * Math.PI * 0.65));
    for (let x = centreX - span; x <= centreX + span; x += 1) {
      const highlight = x < centreX - span + 3 && y < baseY - 6;
      const belly = y > baseY - 7;
      body[y * WIDTH + x] = highlight ? 3 : belly ? 6 : 1;
    }
  }

  for (let y = 5; y <= baseY + 1; y += 1) {
    for (let x = 4; x < WIDTH - 4; x += 1) {
      if (body[y * WIDTH + x] !== 0) continue;
      const near =
        body[(y - 1) * WIDTH + x] !== 0 ||
        body[(y + 1) * WIDTH + x] !== 0 ||
        body[y * WIDTH + x - 1] !== 0 ||
        body[y * WIDTH + x + 1] !== 0;
      if (near) outline[y * WIDTH + x] = 2;
    }
  }

  const eyeY = 13 - Math.floor(bounce / 2);
  for (const eyeX of [13, 19]) {
    outline[eyeY * WIDTH + eyeX] = 2;
    outline[eyeY * WIDTH + eyeX + 1] = 2;
    outline[(eyeY + 1) * WIDTH + eyeX] = 7;
  }
  const footOffset = frame % 2 === 0 ? 1 : -1;
  for (let x = 12 + footOffset; x <= 14 + footOffset; x += 1) outline[(baseY + 1) * WIDTH + x] = 10;
  for (let x = 18 - footOffset; x <= 20 - footOffset; x += 1) outline[(baseY + 1) * WIDTH + x] = 10;
  for (let x = 14; x <= 18; x += 1) body[(6 + (frame % 3)) * WIDTH + x] = 5;

  return { shadow, body, outline };
}

function drawTile(number: number): number[][] {
  const size = 8;
  const rows: number[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) {
      const edgeTop = (number - 1) & 1;
      const edgeRight = ((number - 1) >> 1) & 1;
      const edgeBottom = ((number - 1) >> 2) & 1;
      const edgeLeft = ((number - 1) >> 3) & 1;
      const onTop = y === 0 && edgeTop === 0;
      const onRight = x === size - 1 && edgeRight === 0;
      const onBottom = y === size - 1 && edgeBottom === 0;
      const onLeft = x === 0 && edgeLeft === 0;
      if (onTop || onRight || onBottom || onLeft) row.push(9);
      else row.push((x + y) % 4 === 0 ? 8 : 7);
    }
    rows.push(row);
  }
  return rows;
}

async function makePerson(
  client: PoolClient,
  name: string,
  email: string,
  password: string,
  at: Date,
): Promise<number> {
  const { hash, salt } = hashPassword(password);
  const made = await first<{ id: number }>(
    client,
    `INSERT INTO users (email, name, password_hash, password_salt, confirmed, created_at)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
    [email, name, hash, salt, at],
  );
  return (made as { id: number }).id;
}

/** A first start with no people generates the same demo project every time. */
export async function ensureDemoWorkspace(): Promise<void> {
  const at = await now();
  await transact(async (client) => {
    const people = await first<{ count: string }>(client, 'SELECT COUNT(*)::text AS count FROM users');
    if (people !== null && Number(people.count) > 0) return;

    const owner = await makePerson(client, 'Demo Owner', 'demo@celmate.example', 'celmate-demo-1', at);
    const editor = await makePerson(
      client,
      'Demo Editor',
      'demo-editor@celmate.example',
      'celmate-demo-2',
      at,
    );
    const reviewer = await makePerson(
      client,
      'Demo Reviewer',
      'demo-reviewer@celmate.example',
      'celmate-demo-3',
      at,
    );
    const project = await first<{ id: number }>(
      client,
      'INSERT INTO projects (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING id',
      ['Marzipan Demo', owner, at],
    );
    const projectId = (project as { id: number }).id;
    for (const [person, role] of [
      [editor, 'editor'],
      [reviewer, 'reviewer'],
    ] as const) {
      await client.query(
        'INSERT INTO memberships (project_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)',
        [projectId, person, role, at],
      );
    }

    const palette = await first<{ id: number }>(
      client,
      'INSERT INTO palettes (created_at) VALUES ($1) RETURNING id',
      [at],
    );
    const paletteId = (palette as { id: number }).id;
    for (let index = 0; index < PALETTE.length; index += 1) {
      await client.query(
        'INSERT INTO swatches (palette_id, index, color, version, present) VALUES ($1, $2, $3, 1, true)',
        [paletteId, index + 1, PALETTE[index]],
      );
    }

    const sprite = await first<{ id: number }>(
      client,
      `INSERT INTO sprites (project_id, palette_id, name, width, height, seq, created_at)
       VALUES ($1, $2, 'Gumdrop Walker', $3, $4, 0, $5) RETURNING id`,
      [projectId, paletteId, WIDTH, HEIGHT, at],
    );
    const spriteId = (sprite as { id: number }).id;
    const layerIds: Record<string, number> = {};
    const names = ['Shadow', 'Body', 'Outline'];
    for (let at2 = 0; at2 < names.length; at2 += 1) {
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO layers (sprite_id, name, opacity, blend, visible, position)
         VALUES ($1, $2, 100, 'normal', true, $3) RETURNING id`,
        [spriteId, names[at2], names.length - at2],
      );
      layerIds[names[at2]] = (made as { id: number }).id;
    }

    for (let frame = 0; frame < FRAMES; frame += 1) {
      const frameRow = await first<{ id: number }>(
        client,
        'INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, $2, 100) RETURNING id',
        [spriteId, frame + 1],
      );
      const frameId = (frameRow as { id: number }).id;
      const cel = drawFrame(frame);
      const buffers: [string, Buffer][] = [
        ['Shadow', cel.shadow],
        ['Body', cel.body],
        ['Outline', cel.outline],
      ];
      for (const [layerName, data] of buffers) {
        const buffer = await first<{ id: number }>(
          client,
          'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
          [spriteId, data],
        );
        await client.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [
          frameId,
          layerIds[layerName],
          (buffer as { id: number }).id,
        ]);
      }
    }

    await client.query(
      `INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat)
       VALUES ($1, 'walk', 1, 8, 'forward', 0), ($1, 'bounce', 2, 5, 'pingpong', 0)`,
      [spriteId],
    );

    const tileset = await first<{ id: number }>(
      client,
      `INSERT INTO tilesets (sprite_id, name, tile_size, edge_table)
       VALUES ($1, 'Candy Ground', 8, $2) RETURNING id`,
      [spriteId, defaultEdgeTable()],
    );
    const tilesetId = (tileset as { id: number }).id;
    for (let number = 1; number <= 16; number += 1) {
      await client.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [
        tilesetId,
        number,
        tileBuffer(drawTile(number)),
      ]);
    }
    const tilemap = await first<{ id: number }>(
      client,
      `INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height)
       VALUES ($1, $2, 'Courtyard', 12, 8) RETURNING id`,
      [spriteId, tilesetId],
    );
    const tilemapId = (tilemap as { id: number }).id;
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 2; x <= 9; x += 1) {
        const north = y > 2 ? 1 : 0;
        const east = x < 9 ? 2 : 0;
        const south = y < 5 ? 4 : 0;
        const west = x > 2 ? 8 : 0;
        await client.query(
          `INSERT INTO tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v)
           VALUES ($1, $2, $3, $4, false, false)`,
          [tilemapId, x, y, north + east + south + west + 1],
        );
      }
    }

    const spriteRow = await first<{
      id: number;
      project_id: number;
      palette_id: number;
      name: string;
      width: number;
      height: number;
      seq: number;
    }>(
      client,
      'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1',
      [spriteId],
    );
    for (const name of ['First pass', 'Colour pass']) {
      const payload = await captureSnapshot(client, spriteRow as never);
      await client.query(
        `INSERT INTO snapshots (sprite_id, name, seq, at, automatic, payload)
         VALUES ($1, $2, 0, $3, false, $4)`,
        [spriteId, name, at, JSON.stringify(payload)],
      );
    }

    const comments: [string, number, string, number, number][] = [
      ['Outline breaks on the left foot here.', 3, 'open', 11, 24],
      ['Can the shadow sit one pixel lower?', 5, 'open', 16, 26],
      ['Colour pass looks right on this frame.', 1, 'resolved', 18, 14],
    ];
    for (const [body, frame, state, x, y] of comments) {
      await client.query(
        `INSERT INTO comments (sprite_id, author_id, frame, x, y, text, state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [spriteId, reviewer, frame, x, y, body, state, at],
      );
    }

    await client.query(
      `INSERT INTO share_links (sprite_id, label, token, state, expires_at, created_at)
       VALUES ($1, 'Client preview', 'demo-gumdrop', 'active', $2, $3)`,
      [spriteId, new Date('2030-01-01T00:00:00.000Z'), at],
    );
  });
}
