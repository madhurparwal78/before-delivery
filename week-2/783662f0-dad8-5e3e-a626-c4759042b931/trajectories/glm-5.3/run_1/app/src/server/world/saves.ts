/** World saves, restores and owner exports: all-or-nothing writes to the bucket. */

import type { Pool } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { writePair, readObject, readManifest, verifySha256, deletePair, StorageUnavailableError, putObject } from "../storage/objects.js";
import { isoInstant } from "../time.js";

/** A save's snapshot: compact JSON, blocks sorted by y then x, vehicles by id. */
export async function snapshotOf(pool: Pool, worldSlug: string, worldId: string): Promise<string> {
  void worldSlug;
  const world = (await pool.query<{ slug: string }>("SELECT slug FROM worlds WHERE id = $1", [worldId])).rows[0];
  if (world === undefined) throw new Error("World missing");
  const blocks = await pool.query<{ x: number; y: number; material: string }>(
    "SELECT x, y, material FROM blocks WHERE world_id = $1 ORDER BY y, x",
    [worldId]
  );
  const vehicles = await pool.query<{ id: string; x: number; y: number }>(
    "SELECT id, x, y FROM vehicles WHERE world_id = $1 ORDER BY id",
    [worldId]
  );
  return JSON.stringify({ world: world.slug, blocks: blocks.rows, vehicles: vehicles.rows });
}

export interface SaveRow {
  id: string;
  world_id: string;
  number: number;
  created_at: Date;
  restored_from: number | null;
}

/** Saves a world: snapshot object, then manifest, then the row. Numbers run per world from 1. */
export async function saveWorld(pool: Pool, serverId: string, worldId: string, worldSlug: string): Promise<SaveRow> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [`save:${worldId}`]);
    const data = await snapshotOf(pool, worldSlug, worldId);
    const saveId = newId();
    const dataKey = `servers/${serverId}/worlds/${worldSlug}/saves/${saveId}/snapshot.json`;
    const manifestKey = `servers/${serverId}/worlds/${worldSlug}/saves/${saveId}/manifest.json`;
    try {
      await writePair({ kind: "world_save", serverId, dataKey, manifestKey, data });
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      throw err;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const next = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM world_saves WHERE world_id = $1", [worldId])).rows[0];
      const number = Number(next?.n ?? 0) + 1;
      await client.query(
        "INSERT INTO world_saves (id, server_id, world_id, number, snapshot_key, manifest_key) VALUES ($1,$2,$3,$4,$5,$6)",
        [saveId, serverId, worldId, number, dataKey, manifestKey]
      );
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // already closed
      }
      await deletePair(dataKey, manifestKey).catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const row = (await pool.query<SaveRow>("SELECT id, world_id, number, created_at, restored_from FROM world_saves WHERE id = $1", [saveId])).rows[0];
    return row!;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [`save:${worldId}`]).catch(() => undefined);
    lockClient.release();
  }
}

export interface SaveView {
  id: string;
  number: number;
  created_at: string;
  restored_from: number | null;
  objects: number;
}

export async function savesOf(pool: Pool, worldId: string): Promise<SaveView[]> {
  const rows = await pool.query<SaveRow>(
    "SELECT id, world_id, number, created_at, restored_from FROM world_saves WHERE world_id = $1 ORDER BY number DESC",
    [worldId]
  );
  return rows.rows.map((r) => ({ id: r.id, number: r.number, created_at: isoInstant(r.created_at), restored_from: r.restored_from, objects: 2 }));
}

/** Restores a world to a save: a new save whose snapshot bytes are a copy, then the tiles change. */
export async function restoreWorld(pool: Pool, serverId: string, worldId: string, worldSlug: string, saveId: string): Promise<{ ok: boolean; save?: SaveRow }> {
  const chosen = (await pool.query<SaveRow & { snapshot_key: string; manifest_key: string }>(
    "SELECT * FROM world_saves WHERE id = $1 AND world_id = $2",
    [saveId, worldId]
  )).rows[0];
  if (chosen === undefined) return { ok: false };
  let data: string;
  try {
    data = await readObject(chosen.snapshot_key);
    const manifest = await readManifest(chosen.manifest_key);
    if (!verifySha256(data, manifest)) return { ok: false };
  } catch {
    return { ok: false };
  }
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [`save:${worldId}`]);
    const newSaveId = newId();
    const dataKey = `servers/${serverId}/worlds/${worldSlug}/saves/${newSaveId}/snapshot.json`;
    const manifestKey = `servers/${serverId}/worlds/${worldSlug}/saves/${newSaveId}/manifest.json`;
    try {
      await writePair({ kind: "world_save", serverId, dataKey, manifestKey, data });
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      throw err;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const next = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM world_saves WHERE world_id = $1", [worldId])).rows[0];
      const number = Number(next?.n ?? 0) + 1;
      await client.query(
        "INSERT INTO world_saves (id, server_id, world_id, number, restored_from, snapshot_key, manifest_key) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [newSaveId, serverId, worldId, number, chosen.number, dataKey, manifestKey]
      );
      const snapshot = JSON.parse(data) as { blocks: { x: number; y: number; material: string }[]; vehicles: { id: string; x: number; y: number }[] };
      await client.query("DELETE FROM blocks WHERE world_id = $1", [worldId]);
      for (const b of snapshot.blocks) {
        await client.query("INSERT INTO blocks (server_id, world_id, x, y, material) VALUES ($1,$2,$3,$4,$5)", [serverId, worldId, b.x, b.y, b.material]);
      }
      for (const v of snapshot.vehicles) {
        await client.query("UPDATE vehicles SET x = $2, y = $3 WHERE id = $1", [v.id, v.x, v.y]);
      }
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // already closed
      }
      throw err;
    } finally {
      client.release();
    }
    const row = (await pool.query<SaveRow>("SELECT id, world_id, number, created_at, restored_from FROM world_saves WHERE id = $1", [newSaveId])).rows[0];
    return { ok: true, save: row };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [`save:${worldId}`]).catch(() => undefined);
    lockClient.release();
  }
}

/** POSIX ustar tar header. */
function tarHeader(name: string, size: number, mtimeSeconds: number): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (text: string, offset: number, length: number): void => {
    header.set(enc.encode(text.slice(0, length)), offset);
  };
  put(name, 0, 100);
  put("0000644 ", 100, 8);
  put("0000000 ", 108, 8);
  put("0000000 ", 116, 8);
  put(size.toString(8).padStart(11, "0"), 124, 11);
  header[124 + 11] = 0;
  put(mtimeSeconds.toString(8).padStart(11, "0"), 136, 11);
  header[136 + 11] = 0;
  header[148] = " ".charCodeAt(0);
  header[149] = " ".charCodeAt(0);
  header[150] = " ".charCodeAt(0);
  header[151] = " ".charCodeAt(0);
  header[152] = " ".charCodeAt(0);
  header[153] = " ".charCodeAt(0);
  header[154] = " ".charCodeAt(0);
  header[155] = " ".charCodeAt(0);
  header[156] = "0".charCodeAt(0);
  header[157] = "0".charCodeAt(0);
  put("ustar ", 257, 6);
  put("00", 263, 2);
  let checksum = 0;
  for (const b of header) checksum += b;
  put(checksum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0;
  header[155] = " ".charCodeAt(0);
  return header;
}

function tarEntry(name: string, data: Uint8Array, mtimeSeconds: number): Uint8Array {
  const header = tarHeader(name, data.byteLength, mtimeSeconds);
  const padding = (512 - (data.byteLength % 512)) % 512;
  const out = new Uint8Array(512 + data.byteLength + padding);
  out.set(header, 0);
  out.set(data, 512);
  return out;
}

/** One archive in POSIX ustar format: export.json first, then each world's latest snapshot. */
export async function exportArchive(pool: Pool, serverId: string): Promise<{ id: string; key: string; bytes: Uint8Array }> {
  const server = (await pool.query<{ id: string; name: string; created_at: Date }>("SELECT id, name, created_at FROM servers WHERE id = $1", [serverId])).rows[0];
  if (server === undefined) throw new Error("Server missing");
  const worlds = await pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM worlds WHERE server_id = $1 ORDER BY slug",
    [serverId]
  );
  const latest = new Map<string, { number: number; created_at: Date; snapshot_key: string }>();
  for (const world of worlds.rows) {
    const row = (await pool.query<{ number: number; created_at: Date; snapshot_key: string }>(
      "SELECT number, created_at, snapshot_key FROM world_saves WHERE world_id = $1 ORDER BY number DESC LIMIT 1",
      [world.id]
    )).rows[0];
    if (row !== undefined) latest.set(world.slug, row);
  }
  const exportJson = {
    server: { id: server.id, name: server.name },
    worlds: worlds.rows
      .filter((w) => latest.has(w.slug))
      .map((w) => ({
        slug: w.slug,
        name: w.name,
        save_number: latest.get(w.slug)!.number,
        save_created_at: isoInstant(latest.get(w.slug)!.created_at),
      })),
  };
  const newest = [...latest.values()].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
  const exportMtime = Math.floor((newest?.created_at ?? server.created_at).getTime() / 1000);
  const chunks: Uint8Array[] = [];
  chunks.push(tarEntry("export.json", new TextEncoder().encode(JSON.stringify(exportJson)), exportMtime));
  for (const world of worlds.rows) {
    const save = latest.get(world.slug);
    if (save === undefined) continue;
    const data = new TextEncoder().encode(await readObject(save.snapshot_key));
    chunks.push(tarEntry(`${world.slug}/snapshot.json`, data, Math.floor(save.created_at.getTime() / 1000)));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const exportId = newId();
  const key = `servers/${serverId}/exports/${exportId}.tar`;
  const manifestKey = `servers/${serverId}/exports/${exportId}.manifest.json`;
  try {
    await writePair({ kind: "export", serverId, dataKey: key, manifestKey, data: archive });
  } catch (err) {
    if (err instanceof StorageUnavailableError) throw err;
    throw err;
  }
  await pool.query("INSERT INTO exports (id, server_id, key, manifest_key) VALUES ($1,$2,$3,$4)", [exportId, serverId, key, manifestKey]);
  return { id: exportId, key, bytes: archive };
}

export async function readExport(pool: Pool, serverId: string, exportId: string): Promise<{ bytes: Uint8Array } | null> {
  const row = (await pool.query<{ key: string }>("SELECT key FROM exports WHERE id = $1 AND server_id = $2", [exportId, serverId])).rows[0];
  if (row === undefined) return null;
  const text = await readObject(row.key);
  return { bytes: new TextEncoder().encode(text) };
}

export { StorageUnavailableError, putObject };
