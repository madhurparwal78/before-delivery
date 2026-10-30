import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { one, text, type Queryable } from '../db';

export interface FileLinkTarget {
  objectKey: string;
  contentType: string;
  filename: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** An unguessable, short-lived path that serves one stored object. */
export async function issueFileLink(
  client: Queryable,
  target: FileLinkTarget,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await client.query(
    `insert into file_links (token_hash, object_key, content_type, filename, expires_at)
     values ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)`,
    [
      hashToken(token),
      target.objectKey,
      target.contentType,
      target.filename,
      String(config.fileUrlTtlSeconds),
    ],
  );
  return `/files/${token}`;
}

export async function readFileLink(
  client: Queryable,
  token: string,
): Promise<(FileLinkTarget & { expired: boolean }) | null> {
  const row = await one(
    client,
    `select object_key, content_type, filename, (expires_at <= now()) as expired
       from file_links where token_hash = $1`,
    [hashToken(token)],
  );
  if (row === null) return null;
  return {
    objectKey: text(row.object_key),
    contentType: text(row.content_type),
    filename: text(row.filename),
    expired: row.expired === true,
  };
}
