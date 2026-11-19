// One-to-one invariant between reference rows and stored objects, plus
// writing seed objects once storage is reachable.

import type { Db } from './db.js';
import { many } from './db.js';
import type { Storage } from './services/storage.js';
import { placeholderPng, sampleClipWebm } from './services/placeholders.js';
import { scrub, sniffKind } from './services/media.js';

export interface SeedRefRow {
  id: string;
  workspace_slug: string;
  kind: string;
  title: string;
  ext: string;
  content_type: string;
}

export function objectKey(workspaceSlug: string, referenceId: string, ext: string): string {
  return `references/${workspaceSlug}/${referenceId}.${ext}`;
}

/** Write any missing seed objects to storage; idempotent. */
export async function syncSeedObjects(db: Db, storage: Storage): Promise<void> {
  const rows = await many<SeedRefRow>(
    db,
    `select r.id, w.slug as workspace_slug, r.kind, r.title, r.ext, r.content_type
       from reference_items r join workspaces w on w.id = r.workspace_id
      where r.stored_at is null`,
  );
  if (rows.length === 0) return;
  const clip = await sampleClipWebm();
  let seed = 1;
  for (const row of rows) {
    const key = objectKey(row.workspace_slug, row.id, row.ext);
    const exists = await storage.exists(key);
    if (!exists) {
      let body: Buffer;
      if (row.kind === 'clip') {
        body = clip;
      } else {
        body = placeholderPng((seed++ * 7 + row.id.charCodeAt(0)) % 251);
        const kind = sniffKind(body);
        if (kind !== row.ext && kind !== 'unknown') {
          // keep ext aligned with the actual bytes we write
          body = scrub(kind, body);
        }
      }
      await storage.put({ key, body, contentType: row.content_type });
    }
    await db.query(`update reference_items set stored_at = now() where id = $1`, [row.id]);
  }
}
