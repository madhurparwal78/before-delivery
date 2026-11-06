import type { PoolClient } from '../db';
import { encryptBytes, md5Hex, newDataKey, quotedEtag } from '../crypto/objects';
import { wrapDataKey } from '../crypto/seal';
import { putBytes, regionObjectKey } from '../services/storage';
import type { BucketRecord } from './buckets';
import { lockKey, newVersionId, writeVersion, type VersionRecord } from './versions';

export interface SingleUploadInput {
  bucket: BucketRecord;
  workspaceSlug: string;
  keyGeneration: number;
  key: string;
  bytes: Buffer;
  contentType: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksumAlgorithm?: string | null;
  checksumValue?: string | null;
  meterRequestUnit: boolean;
  emitCreated?: boolean;
}

/**
 * Stores one upload: a fresh data key, AES-256-GCM ciphertext in the origin region, then the index
 * row, replicas, counters, usage and event in a single change.
 */
export async function storeSingleUpload(client: PoolClient, input: SingleUploadInput): Promise<VersionRecord> {
  const versionId = newVersionId();
  const dataKey = newDataKey();
  const wrapped = wrapDataKey(input.workspaceSlug, input.keyGeneration, dataKey);
  await putBytes(regionObjectKey(input.bucket.placement[0], input.bucket.name, versionId), encryptBytes(dataKey, input.bytes));
  return writeVersion(client, {
    bucket: input.bucket,
    key: input.key,
    size: input.bytes.length,
    etag: quotedEtag(md5Hex(input.bytes)),
    contentType: input.contentType,
    metadata: input.metadata,
    tags: input.tags,
    checksumAlgorithm: input.checksumAlgorithm ?? null,
    checksumValue: input.checksumValue ?? null,
    wrappedDataKey: wrapped,
    keyGeneration: input.keyGeneration,
    versionId,
    meterRequestUnit: input.meterRequestUnit,
    emitCreated: input.emitCreated,
  });
}

export { lockKey };
