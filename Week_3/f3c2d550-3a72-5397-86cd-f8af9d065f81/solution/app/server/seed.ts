import { readFile } from "node:fs/promises";
import { DEMO_REEL, HALDEN_KICKOFF, PULL_HISTORY, SEED_PHOTOS, SEED_REFERENCES, type SeedReference } from "./seedData.js";
import type { PoolClient } from "pg";
import { SEED_LOCK, query, transaction } from "./db.js";
import { measurePhoto } from "./images.js";
import { readHeader } from "./photo.js";
import { displayKey, newId, originalKey } from "./references.js";
import { confirmSearchWrites, recordSearchUpdate } from "./search.js";
import { deleteObject, putConfirmed, putObject, sha256Hex } from "./storage.js";

async function insertReference(client: PoolClient, seed: SeedReference, written: string[]): Promise<string> {
  const bytes = await readFile(new URL(seed.file, SEED_PHOTOS));
  const header = readHeader(bytes);
  if (!header) throw new Error(`${seed.file} is not a JPEG or PNG`);
  const measurement = await measurePhoto({ bytes, header, point: null, crop: true });
  const id = newId("ref");
  const contentType = header.type === "png" ? "image/png" : "image/jpeg";
  await putConfirmed(originalKey(id, contentType), bytes, contentType);
  written.push(originalKey(id, contentType));
  if (!measurement.display) throw new Error("the display crop was not made");
  await putObject(displayKey(id), measurement.display, "image/jpeg");
  written.push(displayKey(id));
  const [width, height, depth] = seed.size;
  await client.query(
    `INSERT INTO deck_reference (id, state, version, title, maker, year, materials, finish, colour_family, source_url, source_note,
       notes, width_tenths, height_tenths, depth_tenths, swatch, swatch_source, captured_at, photo_content_type, photo_bytes,
       photo_sha256, photo_width, photo_height)
     VALUES ($1, 'stored', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'computed', $15, $16, $17, $18, $19, $20)`,
    [
      id, seed.title, seed.maker, seed.year, seed.materials, seed.finish, seed.colour,
      "link" in seed.source ? seed.source.link : null, "note" in seed.source ? seed.source.note : "", seed.notes,
      width, height, depth, measurement.computed, seed.capturedAt, contentType, bytes.length, sha256Hex(bytes), header.width, header.height,
    ],
  );
  await recordSearchUpdate(client, id);
  return id;
}

async function insertReel(client: PoolClient, name: string, demo: boolean, titles: string[], ids: Map<string, string>): Promise<void> {
  const id = newId("reel");
  await client.query("INSERT INTO reel (id, name, demo, version) VALUES ($1, $2, $3, 1)", [id, name, demo]);
  for (const [index, title] of titles.entries()) {
    await client.query("INSERT INTO reel_stop (reel_id, reference_id, position) VALUES ($1, $2, $3)", [id, ids.get(title), index + 1]);
  }
}

/** Seeds the library when the database has no references; copies starting together seed once. */
export async function seedIfEmpty(): Promise<void> {
  const [existing] = await query<{ total: number }>("SELECT count(*)::int AS total FROM deck_reference");
  if (existing && existing.total > 0) return;
  const written: string[] = [];
  try {
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
      const [again] = await query<{ total: number }>("SELECT count(*)::int AS total FROM deck_reference", [], client);
      if (again && again.total > 0) return;
      const ids = new Map<string, string>();
      for (const seed of SEED_REFERENCES) ids.set(seed.title, await insertReference(client, seed, written));
      await insertReel(client, "Demo reel", true, DEMO_REEL, ids);
      await insertReel(client, "Halden kickoff", false, HALDEN_KICKOFF, ids);
      for (const [day, title] of PULL_HISTORY) {
        await client.query("INSERT INTO daily_pull (pull_day, reference_id, picked_at) VALUES ($1, $2, $3)", [day, ids.get(title), `${day}T06:00:00Z`]);
      }
    });
  } catch (error) {
    await Promise.allSettled(written.map((key) => deleteObject(key)));
    throw error;
  }
  await confirmSearchWrites();
}
