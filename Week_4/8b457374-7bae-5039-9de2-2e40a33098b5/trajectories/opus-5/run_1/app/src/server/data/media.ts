import type { MediaKind, MediaStatus } from '../../shared/types.js';
import type { Db } from './db.js';

export interface MediaRow {
  id: string;
  campaign_id: string;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  bytes: number;
  object_key: string;
  filename: string | null;
  position: number;
}

const COLUMNS = `id, campaign_id, kind, status, content_type, bytes, object_key, filename, position`;

export async function insertMedia(
  db: Db,
  row: {
    id: string;
    campaign_id: string;
    kind: MediaKind;
    content_type: string;
    bytes: number;
    object_key: string;
    filename: string | null;
  },
): Promise<MediaRow> {
  const result = await db.query<MediaRow>(
    `insert into media (id, campaign_id, kind, status, content_type, bytes, object_key, filename, position)
     values ($1, $2, $3, 'uploading', $4, $5, $6, $7,
       coalesce((select max(position) + 1 from media where campaign_id = $2), 0))
     returning ${COLUMNS}`,
    [
      row.id,
      row.campaign_id,
      row.kind,
      row.content_type,
      row.bytes,
      row.object_key,
      row.filename,
    ],
  );
  return result.rows[0] as MediaRow;
}

export async function setMediaStatus(
  db: Db,
  id: string,
  status: MediaStatus,
): Promise<MediaRow | null> {
  const result = await db.query<MediaRow>(
    `update media set status = $2 where id = $1 returning ${COLUMNS}`,
    [id, status],
  );
  return result.rows[0] ?? null;
}

export async function findMedia(db: Db, id: string): Promise<MediaRow | null> {
  const result = await db.query<MediaRow>(`select ${COLUMNS} from media where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listMedia(db: Db, campaignId: string): Promise<MediaRow[]> {
  const result = await db.query<MediaRow>(
    `select ${COLUMNS} from media where campaign_id = $1
     order by (kind = 'cover') desc, position`,
    [campaignId],
  );
  return result.rows;
}

export async function deleteMedia(db: Db, id: string): Promise<void> {
  await db.query('delete from media where id = $1', [id]);
}

export async function findCover(db: Db, campaignId: string): Promise<MediaRow | null> {
  const result = await db.query<MediaRow>(
    `select ${COLUMNS} from media where campaign_id = $1 and kind = 'cover' limit 1`,
    [campaignId],
  );
  return result.rows[0] ?? null;
}

export async function countSpreads(db: Db, campaignId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `select count(*) as count from media where campaign_id = $1 and kind = 'spread'`,
    [campaignId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function coverIdsForCampaigns(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<{ campaign_id: string; id: string }>(
    `select campaign_id, id from media
     where campaign_id = any($1::text[]) and kind = 'cover' and status = 'stored'`,
    [[...ids]],
  );
  return new Map(result.rows.map((row) => [row.campaign_id, row.id]));
}

export async function listFailedSeedMedia(db: Db): Promise<MediaRow[]> {
  const result = await db.query<MediaRow>(
    `select ${COLUMNS} from media where status = 'failed'`,
  );
  return result.rows;
}
