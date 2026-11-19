import type { PoolClient } from 'pg';
import { defaultEdgeTable } from '../shared/edges.js';
import { isColourText } from '../shared/colour.js';
import { now } from './clock.js';
import { config } from './config.js';
import { first, transact } from './db.js';
import { unprocessable } from './errors.js';
import { hashPassword } from './secrets.js';
import { captureSnapshot } from './snapshots.js';
import { tileBuffer } from './sprite.js';

type Json = Record<string, unknown>;

function list(body: Json, field: string): Json[] {
  const value = body[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw unprocessable({ [field]: 'Send a list' });
  return value as Json[];
}

class Keys {
  private readonly values = new Map<string, number>();

  set(key: unknown, id: number): void {
    if (typeof key === 'string' && key !== '') this.values.set(key, id);
  }

  need(field: string, key: unknown): number {
    const found = typeof key === 'string' ? this.values.get(key) : undefined;
    if (found === undefined) throw unprocessable({ [field]: `Unknown reference ${String(key)}` });
    return found;
  }

  all(): Record<string, number> {
    return Object.fromEntries(this.values);
  }
}

async function seedSprite(
  client: PoolClient,
  keys: Keys,
  sprite: Json,
  at: Date,
): Promise<{ id: number; width: number; height: number }> {
  const width = Number(sprite.width);
  const height = Number(sprite.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > config.spriteMax ||
    height > config.spriteMax
  ) {
    throw unprocessable({ sprites: `Largest size is ${config.spriteMax}` });
  }
  const projectId = keys.need('sprites', sprite.project);
  const paletteId = keys.need('sprites', sprite.palette);
  const made = await first<{ id: number }>(
    client,
    `INSERT INTO sprites (project_id, palette_id, name, width, height, seq, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING id`,
    [projectId, paletteId, String(sprite.name ?? 'Sprite'), width, height, at],
  );
  const id = (made as { id: number }).id;
  keys.set(sprite.key, id);
  return { id, width, height };
}

/** The grading seed: every record in one call, or nothing at all. */
export async function seedRecords(body: Json): Promise<Record<string, number>> {
  const at = await now();
  return transact(async (client) => {
    const keys = new Keys();

    for (const user of list(body, 'users')) {
      const email = String(user.email ?? '').toLowerCase();
      const taken = await first<{ id: number }>(client, 'SELECT id FROM users WHERE email = $1', [email]);
      if (taken !== null) throw unprocessable({ users: `Already registered: ${email}` });
      const { hash, salt } = hashPassword(String(user.password ?? 'celmate-seed-1'));
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO users (email, name, password_hash, password_salt, confirmed, number_format, time_zone, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          email,
          String(user.name ?? 'Person'),
          hash,
          salt,
          user.confirmed !== false,
          String(user.number_format ?? 'en-US'),
          String(user.time_zone ?? 'UTC'),
          at,
        ],
      );
      keys.set(user.key, (made as { id: number }).id);
    }

    for (const project of list(body, 'projects')) {
      const made = await first<{ id: number }>(
        client,
        'INSERT INTO projects (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING id',
        [String(project.name ?? 'Project'), keys.need('projects', project.owner), at],
      );
      keys.set(project.key, (made as { id: number }).id);
    }

    for (const membership of list(body, 'memberships')) {
      const userId = keys.need('memberships', membership.user);
      await client.query(
        `INSERT INTO memberships (project_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3`,
        [keys.need('memberships', membership.project), userId, String(membership.role ?? 'editor'), at],
      );
      keys.set(membership.key, userId);
    }

    for (const palette of list(body, 'palettes')) {
      const made = await first<{ id: number }>(
        client,
        'INSERT INTO palettes (created_at) VALUES ($1) RETURNING id',
        [at],
      );
      const paletteId = (made as { id: number }).id;
      const swatches = Array.isArray(palette.swatches) ? (palette.swatches as Json[]) : [];
      if (swatches.length > config.paletteMax) {
        throw unprocessable({ palettes: `Palette limit is ${config.paletteMax} swatches` });
      }
      for (const swatch of swatches) {
        const colour = String(swatch.color ?? '');
        const index = Number(swatch.index);
        if (!isColourText(colour) || !Number.isInteger(index) || index < 1 || index > config.paletteMax) {
          throw unprocessable({ palettes: 'Use eight lowercase hex digits' });
        }
        await client.query(
          'INSERT INTO swatches (palette_id, index, color, version, present) VALUES ($1, $2, $3, 1, true)',
          [paletteId, index, colour],
        );
      }
      keys.set(palette.key, paletteId);
    }

    const spriteSizes = new Map<number, { width: number; height: number }>();
    for (const sprite of list(body, 'sprites')) {
      const made = await seedSprite(client, keys, sprite, at);
      spriteSizes.set(made.id, { width: made.width, height: made.height });
    }

    const layerPosition = new Map<number, number>();
    const layerSprite = new Map<number, number>();
    for (const layer of [...list(body, 'layers')].reverse()) {
      const spriteId = keys.need('layers', layer.sprite);
      const position = (layerPosition.get(spriteId) ?? 0) + 1;
      layerPosition.set(spriteId, position);
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO layers (sprite_id, name, opacity, blend, visible, locked_by, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          spriteId,
          String(layer.name ?? `Layer ${position}`),
          layer.opacity === undefined ? 100 : Number(layer.opacity),
          String(layer.blend ?? 'normal'),
          layer.visible !== false,
          layer.locked_by === undefined || layer.locked_by === null
            ? null
            : keys.need('layers', layer.locked_by),
          position,
        ],
      );
      const layerId = (made as { id: number }).id;
      keys.set(layer.key, layerId);
      layerSprite.set(layerId, spriteId);
    }

    const frameNumbers = new Map<number, number>();
    const frameIds = new Map<string, number>();
    const frameSprite = new Map<number, number>();
    for (const frame of list(body, 'frames')) {
      const spriteId = keys.need('frames', frame.sprite);
      const number = (frameNumbers.get(spriteId) ?? 0) + 1;
      frameNumbers.set(spriteId, number);
      const duration = frame.duration_ms === undefined ? 100 : Number(frame.duration_ms);
      if (!Number.isInteger(duration) || duration < config.frameMinMs || duration > config.frameMaxMs) {
        throw unprocessable({ frames: `Use ${config.frameMinMs} to ${config.frameMaxMs} ms` });
      }
      const made = await first<{ id: number }>(
        client,
        'INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, $2, $3) RETURNING id',
        [spriteId, number, duration],
      );
      const frameId = (made as { id: number }).id;
      if (typeof frame.key === 'string') frameIds.set(frame.key, frameId);
      frameSprite.set(frameId, spriteId);
      keys.set(frame.key, number);
    }

    const celBuffers = new Map<string, number>();
    for (const cel of list(body, 'cels')) {
      const frameKey = String(cel.frame ?? '');
      const frameId = frameIds.get(frameKey);
      if (frameId === undefined) throw unprocessable({ cels: `Unknown reference ${frameKey}` });
      const layerId = keys.need('cels', cel.layer);
      const spriteId = frameSprite.get(frameId) as number;
      const size = spriteSizes.get(spriteId) as { width: number; height: number };
      if (cel.link_to !== undefined && cel.link_to !== null) {
        const sourceFrame = frameIds.get(String(cel.link_to));
        if (sourceFrame === undefined) {
          throw unprocessable({ cels: `Unknown reference ${String(cel.link_to)}` });
        }
        const source = await first<{ buffer_id: number }>(
          client,
          'SELECT buffer_id FROM cels WHERE frame_id = $1 AND layer_id = $2',
          [sourceFrame, layerId],
        );
        if (source === null) throw unprocessable({ cels: 'Link to a cel that exists' });
        await client.query(
          `INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)
           ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3`,
          [frameId, layerId, source.buffer_id],
        );
        keys.set(cel.key, source.buffer_id);
        continue;
      }
      const rows = cel.rows;
      if (
        !Array.isArray(rows) ||
        rows.length !== size.height ||
        (rows as unknown[][]).some((row) => !Array.isArray(row) || row.length !== size.width)
      ) {
        throw unprocessable({ cels: `Send ${size.height} rows of ${size.width} indices` });
      }
      const data = Buffer.alloc(size.width * size.height);
      (rows as number[][]).forEach((row, y) => {
        row.forEach((index, x) => {
          data[y * size.width + x] = Number(index);
        });
      });
      const buffer = await first<{ id: number }>(
        client,
        'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
        [spriteId, data],
      );
      const bufferId = (buffer as { id: number }).id;
      await client.query(
        `INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)
         ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3`,
        [frameId, layerId, bufferId],
      );
      celBuffers.set(String(cel.key ?? ''), bufferId);
      keys.set(cel.key, bufferId);
    }

    for (const tag of list(body, 'tags')) {
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          keys.need('tags', tag.sprite),
          String(tag.name ?? 'tag'),
          Number(tag.from ?? 1),
          Number(tag.to ?? 1),
          String(tag.direction ?? 'forward'),
          tag.repeat === undefined ? 0 : Number(tag.repeat),
        ],
      );
      keys.set(tag.key, (made as { id: number }).id);
    }

    const tilesetIds = new Map<string, number>();
    for (const tileset of list(body, 'tilesets')) {
      const size = Number(tileset.tile_size ?? 8);
      if (size !== 8 && size !== 16) throw unprocessable({ tilesets: 'Use 8 or 16' });
      const made = await first<{ id: number }>(
        client,
        'INSERT INTO tilesets (sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4) RETURNING id',
        [
          keys.need('tilesets', tileset.sprite),
          String(tileset.name ?? 'Tileset'),
          size,
          Array.isArray(tileset.edge_table) ? (tileset.edge_table as number[]) : defaultEdgeTable(),
        ],
      );
      const tilesetId = (made as { id: number }).id;
      if (typeof tileset.key === 'string') tilesetIds.set(tileset.key, tilesetId);
      keys.set(tileset.key, tilesetId);
      const tiles = Array.isArray(tileset.tiles) ? (tileset.tiles as Json[]) : [];
      let number = 1;
      for (const tile of tiles) {
        const rows = tile.rows;
        if (
          !Array.isArray(rows) ||
          rows.length !== size ||
          (rows as unknown[][]).some((row) => !Array.isArray(row) || row.length !== size)
        ) {
          throw unprocessable({ tilesets: `Send ${size} rows of ${size} indices` });
        }
        await client.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [
          tilesetId,
          number,
          tileBuffer((rows as number[][]).map((row) => row.map((value) => Number(value)))),
        ]);
        keys.set(tile.key, number);
        number += 1;
      }
    }

    for (const tilemap of list(body, 'tilemaps')) {
      const tilesetKey = String(tilemap.tileset ?? '');
      const tilesetId = tilesetIds.get(tilesetKey);
      if (tilesetId === undefined) throw unprocessable({ tilemaps: `Unknown reference ${tilesetKey}` });
      const made = await first<{ id: number }>(
        client,
        'INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [
          keys.need('tilemaps', tilemap.sprite),
          tilesetId,
          String(tilemap.name ?? 'Map'),
          Number(tilemap.width ?? 8),
          Number(tilemap.height ?? 8),
        ],
      );
      const tilemapId = (made as { id: number }).id;
      keys.set(tilemap.key, tilemapId);
      for (const cell of Array.isArray(tilemap.cells) ? (tilemap.cells as Json[]) : []) {
        await client.query(
          `INSERT INTO tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tilemapId,
            Number(cell.x),
            Number(cell.y),
            Number(cell.tile),
            cell.flip_h === true,
            cell.flip_v === true,
          ],
        );
      }
    }

    for (const comment of list(body, 'comments')) {
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO comments (sprite_id, author_id, frame, x, y, text, state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          keys.need('comments', comment.sprite),
          keys.need('comments', comment.author),
          Number(comment.frame ?? 1),
          Number(comment.x ?? 0),
          Number(comment.y ?? 0),
          String(comment.text ?? ''),
          String(comment.state ?? 'open'),
          at,
        ],
      );
      keys.set(comment.key, (made as { id: number }).id);
    }

    for (const snapshot of list(body, 'snapshots')) {
      const spriteId = keys.need('snapshots', snapshot.sprite);
      const sprite = await first<{
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
      const payload = await captureSnapshot(client, sprite as never);
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO snapshots (sprite_id, name, seq, at, automatic, payload)
         VALUES ($1, $2, 0, $3, false, $4) RETURNING id`,
        [spriteId, String(snapshot.name ?? 'Snapshot'), at, JSON.stringify(payload)],
      );
      keys.set(snapshot.key, (made as { id: number }).id);
    }

    for (const link of list(body, 'share_links')) {
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO share_links (sprite_id, label, token, state, expires_at, created_at)
         VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
        [
          keys.need('share_links', link.sprite),
          String(link.label ?? 'Link'),
          String(link.token ?? ''),
          link.expires_at === undefined || link.expires_at === null
            ? null
            : new Date(String(link.expires_at)),
          at,
        ],
      );
      keys.set(link.key, (made as { id: number }).id);
    }

    for (const invite of list(body, 'invites')) {
      const made = await first<{ id: number }>(
        client,
        `INSERT INTO invites (project_id, email, role, token, state, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
        [
          keys.need('invites', invite.project),
          String(invite.email ?? '').toLowerCase(),
          String(invite.role ?? 'editor'),
          String(invite.token ?? ''),
          at,
          new Date(String(invite.expires_at ?? at.toISOString())),
        ],
      );
      keys.set(invite.key, (made as { id: number }).id);
    }

    return keys.all();
  });
}
