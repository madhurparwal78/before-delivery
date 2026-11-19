/**
 * Stored assets: the server uploads any missing object at start and never
 * overwrites an existing one. A seeded view photograph counts as photographed
 * only once its stored object's size and checksum match the bytes sent.
 */

import { pool, query } from '../db';
import { queueIndexUpdate } from '../search/pending';
import { ensureBucket, headObject, putIfAbsent } from '../storage/s3';
import { md5Hex } from './image';
import type { StoredPhoto } from '../domain/photos';
import { buildFloorPlate, buildTowerShell, MODEL_KEYS } from './glb';
import { renderDuotoneRamp, renderFacadeTexture, renderViewPhotograph, TEXTURE_KEYS } from './views';
import { FLOOR_BANDS, stackSpec, viewTagFor, type BandId, type StackLetter } from '../../shared/units';

const RETRY_MS = 5000;

async function uploadModelsAndTextures(): Promise<void> {
  await putIfAbsent(MODEL_KEYS.shell, await buildTowerShell(), 'model/gltf-binary');
  for (const band of FLOOR_BANDS) {
    await putIfAbsent(MODEL_KEYS.plate(band.id), await buildFloorPlate(band.id), 'model/gltf-binary');
  }
  await putIfAbsent(TEXTURE_KEYS.facade, renderFacadeTexture(), 'image/png');
  await putIfAbsent(TEXTURE_KEYS.ramp, renderDuotoneRamp(), 'image/png');
}

/**
 * A seeded photograph is confirmed by the stored object's own size and
 * checksum, whether this instance uploaded it or another instance did first.
 */
async function confirmSeedPhotograph(key: string, bytes: Buffer): Promise<StoredPhoto | null> {
  const head = await headObject(key);
  if (!head || head.size === 0 || !/^[0-9a-f]{32}$/.test(head.etag)) return null;
  if (head.size === bytes.length && head.etag === md5Hex(bytes)) {
    return { key, size: bytes.length, checksum: head.etag };
  }
  return { key, size: head.size, checksum: head.etag };
}

interface PendingPhotoRow {
  seed_photo_key: string;
  band: BandId;
  stack: StackLetter;
  floor: number;
}

/** Uploads and confirms the seeded photographs that are not confirmed yet. */
async function confirmSeededPhotographs(): Promise<number> {
  const rows = await query<PendingPhotoRow>(
    pool,
    `select distinct seed_photo_key, band, stack, min(floor) over (partition by seed_photo_key) as floor
       from units where seed_photo_key is not null and not view_photographed`,
  );
  let outstanding = 0;
  for (const row of rows) {
    // Yield between images so reads and index updates keep flowing at start.
    await new Promise((resolve) => setImmediate(resolve));
    const bearing = stackSpec(row.stack).windowBearing;
    const bytes = renderViewPhotograph({
      band: row.band,
      stack: row.stack,
      bearing,
      viewTag: viewTagFor(row.stack, row.floor),
    });
    await putIfAbsent(row.seed_photo_key, bytes, 'image/png');
    const confirmed = await confirmSeedPhotograph(row.seed_photo_key, bytes);
    if (!confirmed) {
      outstanding += 1;
      continue;
    }
    const updated = await query<{ code: string }>(
      pool,
      `update units set view_photographed = true, view_photo_key = $1, view_photo_size = $2,
              view_photo_checksum = $3
         where seed_photo_key = $1 and not view_photographed
         returning code`,
      [confirmed.key, confirmed.size, confirmed.checksum],
    );
    for (const unit of updated) await queueIndexUpdate(pool, unit.code, 'upsert');
  }
  return outstanding;
}

export function startStorageBootstrap(): void {
  const run = async (): Promise<void> => {
    try {
      await ensureBucket();
      await uploadModelsAndTextures();
      if ((await confirmSeededPhotographs()) === 0) return;
    } catch {
      // Storage is unreachable: everything kept in Postgres keeps working.
    }
    setTimeout(run, RETRY_MS);
  };
  void run();
}
