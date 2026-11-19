import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ApiError } from '../shared/errors.ts';
import { noticeQuota } from '../shared/rules.ts';
import type { Attachment, AttachmentType, DocTopic, MapDoc } from '../shared/model.ts';
import { serverNow, toIso } from './clock.ts';
import { config } from './config.ts';
import { StorageError } from './s3.ts';


export const IMAGE_MIME: Record<AttachmentType, string> = { png: 'image/png', jpg: 'image/jpeg' };

const SIGNATURES: Record<AttachmentType, readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
};

export const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** The image type, decided by the first bytes alone; null when the bytes are neither PNG nor JPEG. */
export function imageType(bytes: Uint8Array): AttachmentType | null {
  for (const type of ['png', 'jpg'] as const) {
    if (SIGNATURES[type].every((byte, at) => bytes[at] === byte)) return type;
  }
  return null;
}

export const attachmentKey = (mapId: string, attachment: Pick<Attachment, 'sha256' | 'type'>): string =>
  `attachments/${mapId}/${attachment.sha256}.${attachment.type}`;

/** Refuse when the map's distinct attached bytes plus the incoming files pass the quota (the quota itself is allowed). */
export function assertWithinQuota(doc: MapDoc, incoming: readonly Attachment[]): void {
  const distinct = new Map<string, number>();
  const attached = Object.values(doc.topics).flatMap((topic) => topic.attachments);
  for (const attachment of [...attached, ...incoming]) distinct.set(attachment.sha256, attachment.bytes);
  let total = 0;
  for (const bytes of distinct.values()) total += bytes;
  if (total > config.mapQuotaBytes) {
    throw new ApiError('quota_exceeded', noticeQuota(config.mapQuotaBytes));
  }
}

/** The topic holding an attachment and the attachment itself, or null. */
export function findAttachment(doc: MapDoc, attachmentId: string): { topic: DocTopic; attachment: Attachment } | null {
  for (const topic of Object.values(doc.topics)) {
    const attachment = topic.attachments.find((a) => a.id === attachmentId);
    if (attachment) return { topic, attachment };
  }
  return null;
}

/**
 * Record an attachment as pending, run the storage write, and settle it: stored when the write and its
 * existence check succeed, failed when the store is unreachable. Returns whether it is stored.
 */
export async function storeAttachment(
  client: pg.PoolClient,
  mapId: string,
  topicId: string,
  attachment: Attachment,
  write: () => Promise<void>,
): Promise<boolean> {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    return false;
  }
  await client.query(
    "INSERT INTO attachments (id, map_id, topic_id, sha256, bytes, type, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'stored', $7)",
    [attachment.id, mapId, topicId, attachment.sha256, attachment.bytes, attachment.type, toIso(serverNow())],
  );
  return true;
}
