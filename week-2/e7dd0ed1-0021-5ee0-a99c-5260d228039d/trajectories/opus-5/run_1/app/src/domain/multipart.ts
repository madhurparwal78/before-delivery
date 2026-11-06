import type { PoolClient } from '../db';
import { one, query, row, rows } from '../db';
import { limits } from '../config';
import { s3Error } from '../errors';
import { randomId, unwrapDataKey, wrapDataKey } from '../crypto/seal';
import {
  ciphertextLength,
  decryptBytes,
  encryptBytes,
  encryptStream,
  md5Hex,
  multipartEtag,
  newDataKey,
} from '../crypto/objects';
import { deleteBytes, getBytes, listKeys, partObjectKey, putBytes, putStream, regionObjectKey } from '../services/storage';
import type { BucketRecord } from './buckets';
import { newVersionId, writeVersion, type VersionRecord } from './versions';
import { releaseReservation, releaseReservationsByRefPrefix } from './quota';

export interface UploadRecord {
  upload_id: string;
  bucket: string;
  object_key: string;
  workspace_slug: string;
  content_type: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksum_algorithm: string | null;
  wrapped_data_key: string;
  key_generation: number;
  initiated_at: string;
  state: string;
  completed_part_list: string | null;
  completed_response: Record<string, unknown> | null;
}

const columns = `upload_id, bucket, object_key, workspace_slug, content_type, metadata, tags, checksum_algorithm,
  wrapped_data_key, key_generation, initiated_at, state, completed_part_list, completed_response`;

export interface PartRecord {
  upload_id: string;
  part_number: number;
  size: string;
  md5: string;
  checksum_algorithm: string | null;
  checksum_value: string | null;
}

export async function findUpload(uploadId: string): Promise<UploadRecord | null> {
  return one<UploadRecord>(`select ${columns} from multipart_uploads where upload_id = $1`, [uploadId]) as Promise<
    UploadRecord | null
  >;
}

export async function findUploadIn(client: PoolClient, uploadId: string): Promise<UploadRecord | null> {
  return row<UploadRecord>(client, `select ${columns} from multipart_uploads where upload_id = $1 for update`, [uploadId]);
}

export async function createUpload(
  client: PoolClient,
  input: {
    bucket: BucketRecord;
    key: string;
    contentType: string;
    metadata: Record<string, string>;
    tags: Record<string, string>;
    checksumAlgorithm: string | null;
    keyGeneration: number;
  },
): Promise<UploadRecord> {
  const uploadId = randomId('mpu');
  const dataKey = newDataKey();
  const created = await row<UploadRecord>(
    client,
    `insert into multipart_uploads (upload_id, bucket, object_key, workspace_slug, content_type, metadata, tags,
        checksum_algorithm, wrapped_data_key, key_generation, initiated_at, state)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('second', now()), 'open') returning ${columns}`,
    [
      uploadId,
      input.bucket.name,
      input.key,
      input.bucket.workspace_slug,
      input.contentType,
      JSON.stringify(input.metadata),
      JSON.stringify(input.tags),
      input.checksumAlgorithm,
      wrapDataKey(input.bucket.workspace_slug, input.keyGeneration, dataKey),
      input.keyGeneration,
    ],
  );
  return created as UploadRecord;
}

export function uploadDataKey(upload: UploadRecord): Buffer {
  return unwrapDataKey(upload.workspace_slug, upload.key_generation, upload.wrapped_data_key);
}

export async function listParts(uploadId: string): Promise<PartRecord[]> {
  return query<PartRecord>(
    `select upload_id, part_number, size::text as size, md5, checksum_algorithm, checksum_value
     from multipart_parts where upload_id = $1 order by part_number`,
    [uploadId],
  );
}

export async function storePart(
  client: PoolClient,
  upload: UploadRecord,
  partNumber: number,
  bytes: Buffer,
  checksum: { algorithm: string; value: string } | null,
): Promise<{ etag: string }> {
  const dataKey = uploadDataKey(upload);
  await putBytes(partObjectKey(upload.upload_id, partNumber), encryptBytes(dataKey, bytes));
  const md5 = md5Hex(bytes);
  await client.query(
    `insert into multipart_parts (upload_id, part_number, size, md5, checksum_algorithm, checksum_value)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (upload_id, part_number) do update set size = $3, md5 = $4, checksum_algorithm = $5, checksum_value = $6`,
    [upload.upload_id, partNumber, bytes.length, md5, checksum?.algorithm ?? null, checksum?.value ?? null],
  );
  return { etag: `"${md5}"` };
}

export interface RequestedPart {
  partNumber: number;
  etag: string;
  checksums: Record<string, string>;
}

/** Completes an upload: validates the part list, then re-encrypts the parts into one version. */
export async function completeUpload(
  client: PoolClient,
  bucket: BucketRecord,
  upload: UploadRecord,
  requested: RequestedPart[],
  keyGeneration: number,
): Promise<VersionRecord> {
  const stored = await rows<PartRecord>(
    client,
    `select upload_id, part_number, size::text as size, md5, checksum_algorithm, checksum_value
     from multipart_parts where upload_id = $1 order by part_number`,
    [upload.upload_id],
  );
  const byNumber = new Map(stored.map((part) => [part.part_number, part]));
  for (let index = 1; index < requested.length; index += 1) {
    if (requested[index].partNumber <= requested[index - 1].partNumber) throw s3Error('InvalidPartOrder');
  }
  if (requested.length === 0) throw s3Error('InvalidPart');
  const chosen: PartRecord[] = [];
  for (const entry of requested) {
    const part = byNumber.get(entry.partNumber);
    if (!part) throw s3Error('InvalidPart');
    if (part.md5 !== entry.etag.replace(/"/g, '')) throw s3Error('InvalidPart');
    for (const [algorithm, value] of Object.entries(entry.checksums)) {
      if (part.checksum_algorithm !== algorithm || part.checksum_value !== value) throw s3Error('InvalidPart');
    }
    chosen.push(part);
  }
  for (let index = 0; index < chosen.length - 1; index += 1) {
    if (Number(chosen[index].size) < limits.partMin) throw s3Error('EntityTooSmall');
  }
  const total = chosen.reduce((sum, part) => sum + Number(part.size), 0);
  if (total > limits.multipartTotal) throw s3Error('EntityTooLarge');

  const versionId = newVersionId();
  const dataKey = newDataKey();
  const partKey = uploadDataKey(upload);
  const chosenNumbers = chosen.map((part) => part.part_number);
  async function* plaintext(): AsyncGenerator<Buffer> {
    for (const number of chosenNumbers) {
      const ciphertext = await getBytes(partObjectKey(upload.upload_id, number));
      if (ciphertext === null) throw s3Error('InvalidPart');
      yield decryptBytes(partKey, ciphertext);
    }
  }
  await putStream(
    regionObjectKey(bucket.placement[0], bucket.name, versionId),
    encryptStream(dataKey, plaintext()),
    ciphertextLength(total),
  );

  const version = await writeVersion(client, {
    bucket,
    key: upload.object_key,
    size: total,
    etag: multipartEtag(chosen.map((part) => part.md5)),
    contentType: upload.content_type,
    metadata: upload.metadata,
    tags: upload.tags,
    checksumAlgorithm: null,
    checksumValue: null,
    partMd5s: chosen.map((part) => part.md5),
    partSizes: chosen.map((part) => Number(part.size)),
    wrappedDataKey: wrapDataKey(bucket.workspace_slug, keyGeneration, dataKey),
    keyGeneration,
    versionId,
    meterRequestUnit: true,
  });

  for (const part of stored) await releaseReservation(client, `res_${upload.upload_id}_${part.part_number}`);
  await client.query('delete from multipart_parts where upload_id = $1', [upload.upload_id]);
  return version;
}

export function partListFingerprint(requested: RequestedPart[]): string {
  return requested.map((part) => `${part.partNumber}:${part.etag.replace(/"/g, '')}`).join(',');
}

export async function markCompleted(
  client: PoolClient,
  uploadId: string,
  fingerprint: string,
  response: Record<string, unknown>,
): Promise<void> {
  await client.query(
    "update multipart_uploads set state = 'completed', completed_part_list = $2, completed_response = $3 where upload_id = $1",
    [uploadId, fingerprint, JSON.stringify(response)],
  );
}

export async function abortUpload(client: PoolClient, upload: UploadRecord): Promise<void> {
  await releaseReservationsByRefPrefix(client, `upload:${upload.upload_id}`);
  await client.query('delete from multipart_parts where upload_id = $1', [upload.upload_id]);
  await client.query('delete from multipart_uploads where upload_id = $1', [upload.upload_id]);
}

export async function discardStagedBytes(uploadId: string): Promise<void> {
  for (const key of await listKeys(`uploads/${uploadId}/`)) await deleteBytes(key);
}
