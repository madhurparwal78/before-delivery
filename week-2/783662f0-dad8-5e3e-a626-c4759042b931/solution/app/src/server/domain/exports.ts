import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import {
  StorageUnreachable,
  deleteObject,
  exportKeys,
  getObject,
  manifestBytes,
  objectSha,
  putObject,
  saveKeys,
} from '../services/storage.js';
import { instant, newId } from '../util.js';
import type { ServerRow } from './servers.js';
import { type WorldRow, blocksOf, vehiclesOf } from './world.js';

/** A snapshot is compact JSON with blocks sorted by y then x and vehicles by id. */
export async function snapshotBytes(world: WorldRow): Promise<Buffer> {
  const blocks = await blocksOf(world.id);
  const vehicles = await vehiclesOf(world.id);
  return Buffer.from(
    JSON.stringify({
      world: world.slug,
      blocks: [...blocks]
        .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
        .map((block) => ({ x: block.x, y: block.y, material: block.material })),
      vehicles: [...vehicles]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((vehicle) => ({ id: vehicle.id, x: vehicle.x, y: vehicle.y })),
    }),
    'utf8',
  );
}

interface SaveRecord {
  readonly id: string;
  readonly number: number;
  readonly createdAt: Date;
  readonly restoredFrom: number | null;
  readonly snapshotKey: string;
  readonly manifestKey: string;
}

/**
 * A save writes its snapshot object, then its manifest object, then its row.
 * If either object write fails, what the save wrote is deleted, no row is
 * written and the answer is 503.
 */
export async function writeSave(
  server: ServerRow,
  world: WorldRow,
  snapshot: Buffer,
  restoredFrom: number | null,
): Promise<SaveRecord> {
  const id = newId();
  const keys = saveKeys(server.id, world.slug, id);
  const createdAt = new Date();

  try {
    await putObject(keys.snapshot, snapshot);
    await putObject(
      keys.manifest,
      manifestBytes({
        kind: 'world_save',
        server_id: server.id,
        object: keys.snapshot,
        sha256: objectSha(snapshot),
        bytes: snapshot.length,
        created_at: instant(createdAt),
      }),
    );
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      await deleteObject(keys.manifest);
      await deleteObject(keys.snapshot);
      throw fail('storage_unavailable');
    }
    throw error;
  }

  const number = await tx(async (client) => {
    /* Saves are numbered per world from 1, so the count is taken under a lock
       held for the transaction. */
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`save:${world.id}`]);
    const next = await client.query<{ number: number }>(
      'SELECT coalesce(max(number), 0) + 1 AS number FROM world_saves WHERE world_id = $1',
      [world.id],
    );
    const value = next.rows[0]?.number ?? 1;
    await client.query(
      `INSERT INTO world_saves (id, server_id, world_id, number, restored_from,
                                snapshot_key, manifest_key, sha256, bytes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        server.id,
        world.id,
        value,
        restoredFrom,
        keys.snapshot,
        keys.manifest,
        objectSha(snapshot),
        snapshot.length,
        createdAt,
      ],
    );
    return value;
  });

  return {
    id,
    number,
    createdAt,
    restoredFrom,
    snapshotKey: keys.snapshot,
    manifestKey: keys.manifest,
  };
}

interface SaveRow {
  id: string;
  world_id: string;
  number: number;
  restored_from: number | null;
  snapshot_key: string;
  manifest_key: string;
  sha256: string;
  created_at: Date;
}

export const savesOf = (worldId: string): Promise<SaveRow[]> =>
  query<SaveRow>('SELECT * FROM world_saves WHERE world_id = $1 ORDER BY number DESC', [worldId]);

const latestSave = (worldId: string): Promise<SaveRow | null> =>
  one<SaveRow>('SELECT * FROM world_saves WHERE world_id = $1 ORDER BY number DESC LIMIT 1', [
    worldId,
  ]);

interface Snapshot {
  world: string;
  blocks: { x: number; y: number; material: string }[];
  vehicles: { id: string; x: number; y: number }[];
}

/**
 * A restore reads the chosen save's snapshot, checks it against its manifest's
 * sha256, writes a new save whose snapshot bytes are a copy, and only then
 * replaces the world's blocks and vehicle tiles.
 */
export async function restoreWorld(
  server: ServerRow,
  world: WorldRow,
  saveId: string,
): Promise<{ save: SaveRecord; chosen: number }> {
  const chosen = await one<SaveRow>(
    'SELECT * FROM world_saves WHERE id = $1 AND world_id = $2',
    [saveId, world.id],
  );
  if (chosen === null) throw fail('not_found');

  let bytes: Buffer | null;
  let manifest: Buffer | null;
  try {
    bytes = await getObject(chosen.snapshot_key);
    manifest = await getObject(chosen.manifest_key);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw fail('storage_unavailable');
    throw error;
  }
  if (bytes === null || manifest === null) throw fail('storage_unavailable');

  const declared = JSON.parse(manifest.toString('utf8')) as { sha256?: string };
  if (declared.sha256 !== objectSha(bytes)) throw fail('storage_unavailable');

  const save = await writeSave(server, world, bytes, chosen.number);

  const snapshot = JSON.parse(bytes.toString('utf8')) as Snapshot;
  await tx(async (client) => {
    await client.query('DELETE FROM blocks WHERE world_id = $1', [world.id]);
    for (const block of snapshot.blocks) {
      await client.query(
        `INSERT INTO blocks (server_id, world_id, x, y, material) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (world_id, x, y) DO UPDATE SET material = $5`,
        [server.id, world.id, block.x, block.y, block.material],
      );
    }
    for (const vehicle of snapshot.vehicles) {
      await client.query('UPDATE vehicles SET x = $2, y = $3 WHERE id = $1 AND world_id = $4', [
        vehicle.id,
        vehicle.x,
        vehicle.y,
        world.id,
      ]);
    }
    await client.query('UPDATE worlds SET revision = revision + 1 WHERE id = $1', [world.id]);
  });

  return { save, chosen: chosen.number };
}

/* The owner export: one uncompressed POSIX ustar archive. */

const BLOCK = 512;

function tarHeader(name: string, size: number, modifiedSeconds: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write(`${Math.floor(modifiedSeconds).toString(8).padStart(11, '0')}\0`, 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  // Owner and group names stay empty.
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return header;
}

const padding = (size: number): Buffer =>
  Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK, 0);

function buildTar(
  entries: readonly { name: string; body: Buffer; modifiedSeconds: number }[],
): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry.name, entry.body.length, entry.modifiedSeconds));
    parts.push(entry.body);
    parts.push(padding(entry.body.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

interface ExportRecord {
  readonly id: string;
  readonly key: string;
}

/**
 * The latest save of every world as one archive, holding only this server's
 * worlds and byte-identical when nothing has changed.
 */
export async function buildExport(server: ServerRow): Promise<ExportRecord> {
  const worlds = await query<WorldRow>(
    'SELECT * FROM worlds WHERE server_id = $1 ORDER BY slug',
    [server.id],
  );

  const included: { world: WorldRow; save: SaveRow; body: Buffer }[] = [];
  try {
    for (const world of worlds) {
      const save = await latestSave(world.id);
      if (save === null) continue;
      const body = await getObject(save.snapshot_key);
      if (body === null) throw fail('storage_unavailable');
      included.push({ world, save, body });
    }
  } catch (error) {
    if (error instanceof StorageUnreachable) throw fail('storage_unavailable');
    throw error;
  }

  const newest = included.reduce<Date | null>(
    (latest, entry) =>
      latest === null || entry.save.created_at.getTime() > latest.getTime()
        ? entry.save.created_at
        : latest,
    null,
  );
  const manifestTime = newest ?? server.created_at;

  const descriptor = Buffer.from(
    JSON.stringify({
      server: { id: server.id, name: server.name },
      worlds: included.map((entry) => ({
        slug: entry.world.slug,
        name: entry.world.name,
        save_number: entry.save.number,
        save_created_at: instant(entry.save.created_at),
      })),
    }),
    'utf8',
  );

  const archive = buildTar([
    {
      name: 'export.json',
      body: descriptor,
      modifiedSeconds: Math.floor(manifestTime.getTime() / 1000),
    },
    ...included.map((entry) => ({
      name: `${entry.world.slug}/snapshot.json`,
      body: entry.body,
      modifiedSeconds: Math.floor(entry.save.created_at.getTime() / 1000),
    })),
  ]);

  const id = newId();
  const keys = exportKeys(server.id, id);
  try {
    await putObject(keys.archive, archive, 'application/x-tar');
    await putObject(
      keys.manifest,
      manifestBytes({
        kind: 'export',
        server_id: server.id,
        object: keys.archive,
        sha256: objectSha(archive),
        bytes: archive.length,
        created_at: instant(new Date()),
      }),
    );
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      await deleteObject(keys.manifest);
      await deleteObject(keys.archive);
      throw fail('storage_unavailable');
    }
    throw error;
  }

  await query(
    `INSERT INTO world_exports (id, server_id, key, manifest_key, sha256, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, server.id, keys.archive, keys.manifest, objectSha(archive), archive.length],
  );
  return { id, key: keys.archive };
}

export async function readExport(server: ServerRow, exportId: string): Promise<Buffer> {
  const record = await one<{ key: string }>(
    'SELECT key FROM world_exports WHERE id = $1 AND server_id = $2',
    [exportId, server.id],
  );
  if (record === null) throw fail('not_found');
  try {
    const body = await getObject(record.key);
    if (body === null) throw fail('storage_unavailable');
    return body;
  } catch (error) {
    if (error instanceof StorageUnreachable) throw fail('storage_unavailable');
    throw error;
  }
}
