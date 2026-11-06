import { query, transaction } from '../db';
import { decryptBytes, md5Hex, multipartEtag, quotedEtag } from '../crypto/objects';
import { unwrapDataKey } from '../crypto/seal';
import { deleteBytes, getBytes, putBytes, regionObjectKey } from '../services/storage';
import { countAttempt, markFailed, markSettled } from '../domain/replicas';

interface PendingCopy {
  version_id: string;
  region: string;
  bucket: string;
  object_key: string;
  size: string;
  etag: string;
  part_sizes: number[] | null;
  acknowledged_at: string;
  wrapped_data_key: string;
  key_generation: number;
  workspace_slug: string;
  origin: string;
  region_state: string;
}

async function pendingCopies(): Promise<PendingCopy[]> {
  return query<PendingCopy>(
    `select r.version_id, r.region, v.bucket, v.object_key, v.size::text as size, v.etag, v.part_sizes,
            v.acknowledged_at, v.wrapped_data_key, v.key_generation, b.workspace_slug, b.placement[1] as origin,
            g.state as region_state
     from replicas r
     join object_versions v on v.version_id = r.version_id
     join buckets b on b.name = v.bucket
     join regions g on g.id = r.region
     where r.state = 'pending' and r.role = 'replica' and v.is_current
     order by v.acknowledged_at limit 8`,
  );
}

/** Recomputes a copy's ETag from its decrypted bytes, using recorded part sizes for multipart. */
function etagOf(plaintext: Buffer, partSizes: number[] | null): string {
  if (!partSizes || partSizes.length === 0) return quotedEtag(md5Hex(plaintext));
  const digests: string[] = [];
  let offset = 0;
  for (const size of partSizes) {
    digests.push(md5Hex(plaintext.subarray(offset, offset + size)));
    offset += size;
  }
  return multipartEtag(digests);
}

async function copyOne(copy: PendingCopy): Promise<void> {
  await transaction(async (client) => countAttempt(client, copy.version_id, copy.region));
  if (copy.region_state === 'offline') {
    await transaction(async (client) => markFailed(client, copy.version_id, copy.region, 'region_offline'));
    return;
  }
  const targetKey = regionObjectKey(copy.region, copy.bucket, copy.version_id);
  try {
    const ciphertext = await getBytes(regionObjectKey(copy.origin, copy.bucket, copy.version_id));
    if (ciphertext === null) {
      await transaction(async (client) => markFailed(client, copy.version_id, copy.region, 'copy_failed'));
      return;
    }
    await putBytes(targetKey, ciphertext);
    const readBack = await getBytes(targetKey);
    if (readBack === null) {
      await transaction(async (client) => markFailed(client, copy.version_id, copy.region, 'copy_failed'));
      return;
    }
    const dataKey = unwrapDataKey(copy.workspace_slug, copy.key_generation, copy.wrapped_data_key);
    const plaintext = decryptBytes(dataKey, readBack);
    if (plaintext.length !== Number(copy.size) || etagOf(plaintext, copy.part_sizes) !== copy.etag) {
      await transaction(async (client) => markFailed(client, copy.version_id, copy.region, 'etag_mismatch'));
      return;
    }
    const settled = await transaction(async (client) => {
      const still = await client.query('select is_current from object_versions where version_id = $1', [copy.version_id]);
      if (still.rowCount === 0) return false;
      if (still.rows[0].is_current !== true) return false;
      return markSettled(client, copy.version_id, copy.region, new Date(), new Date(copy.acknowledged_at));
    });
    if (!settled) {
      const stillThere = await query('select 1 from object_versions where version_id = $1', [copy.version_id]);
      if (stillThere.length === 0) await deleteBytes(targetKey);
    }
  } catch {
    await transaction(async (client) => markFailed(client, copy.version_id, copy.region, 'copy_failed'));
  }
}

let running = false;

export async function replicationTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const copies = await pendingCopies();
    await Promise.all(copies.map(copyOne));
  } catch {
    /* a dependency is down; the next tick retries */
  } finally {
    running = false;
  }
}
