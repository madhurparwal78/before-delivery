import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  SEED_PULL_HISTORY,
  SEED_REELS,
  SEED_REFERENCES,
  type SeedReference,
} from '../../shared/seed.js';
import { nowIso } from '../domain/clock.js';
import { extensionFor, sniffPhotoType } from '../domain/photo.js';
import { analysePhoto } from '../services/imageWork.js';
import { displayKey, getObject, originalKey, putObject } from '../services/storage.js';
import { drainSearchQueue } from '../workers/searchCatchUp.js';
import { LOCK, newId, pool, withAdvisoryLock, withTransaction } from './pool.js';
import { recordSearchUpdate } from './searchQueue.js';

/**
 * The seed runs only when the library has no references, and copies starting together take
 * the same lock so it runs once.
 */

function photoPath(slug: string): string {
  return fileURLToPath(new URL(`../public/assets/objects/${slug}.png`, import.meta.url));
}

async function storeSeedPhoto(
  reference: SeedReference,
  id: string,
): Promise<{
  swatch: string;
  width: number;
  height: number;
  bytes: Buffer;
  sha256: string;
  contentType: 'image/jpeg' | 'image/png';
  original: string;
  display: string;
}> {
  const bytes = await readFile(photoPath(reference.slug));
  const contentType = sniffPhotoType(bytes);
  if (!contentType) throw new Error(`seed photograph ${reference.slug} is not a JPEG or PNG`);
  const analysis = await analysePhoto(bytes, { wantDisplayCrop: true });
  const original = originalKey(id, extensionFor(contentType));
  const display = displayKey(id);
  await putObject(original, bytes, contentType);
  await putObject(display, analysis.display!, 'image/jpeg');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const readBack = await getObject(original);
  if (!readBack || createHash('sha256').update(readBack).digest('hex') !== sha256) {
    throw new Error(`seed photograph ${reference.slug} did not read back byte for byte`);
  }
  return {
    swatch: analysis.swatch,
    width: analysis.width,
    height: analysis.height,
    bytes,
    sha256,
    contentType,
    original,
    display,
  };
}

export async function seedIfEmpty(): Promise<boolean> {
  const seeded = await withAdvisoryLock(LOCK.seed, async () => {
    const existing = await pool.query('select 1 from reference limit 1');
    if (existing.rowCount !== 0) return true;

    const ids = new Map<string, string>();
    const stored = new Map<string, Awaited<ReturnType<typeof storeSeedPhoto>>>();
    for (const reference of SEED_REFERENCES) {
      const id = newId('ref');
      ids.set(reference.slug, id);
      stored.set(reference.slug, await storeSeedPhoto(reference, id));
    }

    await withTransaction(async (client) => {
      for (const reference of SEED_REFERENCES) {
        const id = ids.get(reference.slug)!;
        const photo = stored.get(reference.slug)!;
        await client.query(
          `insert into reference (
             id, state, version, title, maker, year, materials, finish, colour_family,
             source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
             swatch, swatch_source, captured_at, photo_content_type, photo_bytes,
             photo_sha256, photo_width, photo_height, original_key, display_key)
           values ($1, 'stored', 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, 'computed', $15::timestamptz, $16, $17, $18, $19, $20, $21, $22)`,
          [
            id,
            reference.title,
            reference.maker,
            reference.year,
            reference.materials,
            reference.finish,
            reference.colour_family,
            reference.source_url,
            reference.source_note,
            reference.notes,
            reference.size.width,
            reference.size.height,
            reference.size.depth,
            photo.swatch,
            reference.captured_at,
            photo.contentType,
            photo.bytes.length,
            photo.sha256,
            photo.width,
            photo.height,
            photo.original,
            photo.display,
          ],
        );
        await recordSearchUpdate(client, id, 'upsert', nowIso());
      }

      for (const [reelIndex, reel] of SEED_REELS.entries()) {
        const reelId = newId('reel');
        await client.query(
          `insert into reel (id, name, demo, version, created_at)
           values ($1, $2, $3, 1, $4::timestamptz + make_interval(secs => $5))`,
          [reelId, reel.name, reel.demo, nowIso(), reelIndex],
        );
        for (const [index, slug] of reel.slugs.entries()) {
          await client.query(
            'insert into reel_stop (reel_id, position, reference_id) values ($1, $2, $3)',
            [reelId, index + 1, ids.get(slug)!],
          );
        }
      }

      for (const pull of SEED_PULL_HISTORY) {
        await client.query(
          `insert into daily_pull (pull_day, reference_id, zone, picked_at)
           values ($1, $2, $3, $4::timestamptz) on conflict (pull_day) do nothing`,
          [pull.pull_day, ids.get(pull.slug)!, 'Europe/London', nowIso()],
        );
      }
    });
    return true;
  });
  if (seeded === null) return false;
  await drainSearchQueue().catch(() => undefined);
  return true;
}
