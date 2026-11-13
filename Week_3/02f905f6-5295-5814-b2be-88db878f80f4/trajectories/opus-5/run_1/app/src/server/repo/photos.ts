import type { PoolClient } from 'pg';
import { query, queryOne } from '../db/pool';

export interface PhotoRow {
  id: string;
  uploader_id: string;
  content_type: string;
  bytes: number;
  sha256: string;
  attached: boolean;
}

export async function createPhoto(args: {
  id: string;
  uploaderId: string;
  contentType: string;
  bytes: number;
  sha256: string;
}): Promise<PhotoRow> {
  const rows = await query<PhotoRow>(
    `insert into photos (id, uploader_id, content_type, bytes, sha256)
     values ($1, $2, $3, $4, $5) returning *`,
    [args.id, args.uploaderId, args.contentType, args.bytes, args.sha256],
  );
  return rows[0] as PhotoRow;
}

export async function findPhoto(id: unknown): Promise<PhotoRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<PhotoRow>('select * from photos where id = $1', [id]);
}

/** Claims a photo for a piece or a damage report. One claim only. */
export async function attachPhoto(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(
    'update photos set attached = true where id = $1 and attached = false returning id',
    [id],
  );
  return result.rowCount === 1;
}

/** Who may read a photo: its uploader, any staff, or the owning member. */
export async function photoViewerIds(photoId: string): Promise<string[]> {
  const rows = await query<{ owner_user_id: string | null }>(
    `select p.owner_user_id from pieces p where p.intake_photo_id = $1
     union all
     select p.owner_user_id from pieces p
       join damage_reports d on d.piece_number = p.number
     where d.unload_photo_id = $1`,
    [photoId],
  );
  return rows.map((row) => row.owner_user_id).filter((id): id is string => id !== null);
}
