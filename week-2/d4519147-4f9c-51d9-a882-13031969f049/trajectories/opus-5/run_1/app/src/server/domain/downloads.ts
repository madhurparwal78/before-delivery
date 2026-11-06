import { config } from '../config';
import { randomToken, sha256Hex } from '../crypto';
import { query, queryOne } from '../db';
import { errors } from '../http/errors';
import { getObject } from '../services/storage';
import { diagramAccess } from './access';
import type { SessionUser } from './sessions';

export interface DownloadTarget {
  objectKey: string;
  fileName: string;
  contentType: string;
  sha256: string | null;
}

/** Each successful request to a file path creates a new link bound to one person. */
export async function issueDownloadLink(userId: string, diagramId: string, target: DownloadTarget): Promise<string> {
  const token = randomToken();
  await query(
    `insert into download_links (token_hash, user_id, diagram_id, object_key, file_name, content_type, sha256)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256Hex(token), userId, diagramId, target.objectKey, target.fileName, target.contentType, target.sha256],
  );
  return token;
}

interface LinkRow {
  user_id: string;
  diagram_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  sha256: string | null;
  created_at: Date;
}

export interface ResolvedDownload {
  bytes: Buffer;
  target: DownloadTarget;
}

/** A link streams only for its own person, while they still hold a role, and only while young. */
export async function resolveDownload(token: string, user: SessionUser): Promise<ResolvedDownload> {
  const row = await queryOne<LinkRow>(
    `select user_id, diagram_id, object_key, file_name, content_type, sha256, created_at
     from download_links where token_hash = $1`,
    [sha256Hex(token)],
  );
  if (!row || row.user_id !== user.id) throw errors.notFound();
  const access = await diagramAccess(row.diagram_id, user);
  if (!access) throw errors.notFound();
  if (Date.now() - row.created_at.getTime() > config.downloadLinkSeconds * 1000) {
    throw errors.gone('link_expired', 'This download link has expired.');
  }
  const bytes = await getObject(row.object_key);
  if (!bytes) throw errors.notFound();
  return {
    bytes,
    target: {
      objectKey: row.object_key,
      fileName: row.file_name,
      contentType: row.content_type,
      sha256: row.sha256,
    },
  };
}

/** `<slug>-<YYYY-MM-DD>.<format>` from the diagram title and the export's UTC date. */
export function exportFileName(title: string, createdAt: Date, format: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${slug}-${createdAt.toISOString().slice(0, 10)}.${format}`;
}
