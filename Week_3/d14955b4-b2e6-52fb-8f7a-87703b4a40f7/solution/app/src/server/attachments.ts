import type { PoolClient } from 'pg';
import type { AttachmentType } from '../shared/attachments.js';
import type { AttachmentBody, AttachmentStatus } from '../shared/types.js';
import { pool } from './db.js';
import { newId } from './ids.js';
import { getObject, objectSize, putObject } from './s3.js';

const FILENAME_UNITS = 120;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export function detectType(bytes: Buffer): AttachmentType | null {
  if (bytes.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (bytes.subarray(0, JPEG.length).equals(JPEG)) return 'image/jpeg';
  if (bytes.length > 0 && !bytes.includes(0)) {
    try {
      strictUtf8.decode(bytes);
      return 'text/plain';
    } catch {
      return null;
    }
  }
  return null;
}

export function storedFilename(submitted: string): string {
  let name = submitted.replace(/^.*[/\\]/s, '');
  name = name.replace(/[\u0000-\u001f\u007f"]/g, '').replace(/^ +| +$/g, '');
  if (name.length > FILENAME_UNITS) {
    name = name.slice(0, FILENAME_UNITS);
    if (/[\ud800-\udbff]$/.test(name)) name = name.slice(0, -1);
  }
  name = name.replace(/ +$/, '');
  return name === '' ? 'attachment' : name;
}

export function servedContentType(type: string): string {
  return type === 'text/plain' ? 'text/plain; charset=utf-8' : type;
}

export function contentDisposition(filename: string): string {
  const fallback = [...filename].map((char) => ((char.codePointAt(0) as number) > 0x7e ? '_' : char)).join('');
  const encoded = [...Buffer.from(filename, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const objectKey = (gameSlug: string, attachmentId: string): string => `attachments/${gameSlug}/${attachmentId}`;

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  status: AttachmentStatus;
}

export const attachmentBody = (row: AttachmentRow): AttachmentBody => ({
  id: row.id, message_id: row.message_id, filename: row.filename, content_type: row.content_type, size: row.size, status: row.status,
});

export async function createAttachment(
  tx: PoolClient,
  input: { gameId: string; playerId: string; messageId: string; filename: string; contentType: AttachmentType; size: number },
): Promise<AttachmentRow> {
  const id = newId();
  await tx.query(
    `insert into attachments (id, game_id, player_id, message_id, filename, content_type, size, status) values ($1, $2, $3, $4, $5, $6, $7, 'uploading')`,
    [id, input.gameId, input.playerId, input.messageId, input.filename, input.contentType, input.size],
  );
  return { id, message_id: input.messageId, filename: input.filename, content_type: input.contentType, size: input.size, status: 'uploading' };
}

async function putAndConfirm(gameSlug: string, attachment: AttachmentRow, bytes: Buffer): Promise<boolean> {
  const key = objectKey(gameSlug, attachment.id);
  await putObject(key, bytes, servedContentType(attachment.content_type));
  return (await objectSize(key)) === attachment.size;
}

export async function storeAttachment(gameSlug: string, attachment: AttachmentRow, bytes: Buffer): Promise<AttachmentStatus> {
  const stored = await putAndConfirm(gameSlug, attachment, bytes).catch(() => false);
  const status: AttachmentStatus = stored ? 'attached' : 'failed';
  await pool.query('update attachments set status = $2 where id = $1', [attachment.id, status]);
  return status;
}

export const readStoredAttachment = (gameSlug: string, attachmentId: string): Promise<Buffer> => getObject(objectKey(gameSlug, attachmentId));
