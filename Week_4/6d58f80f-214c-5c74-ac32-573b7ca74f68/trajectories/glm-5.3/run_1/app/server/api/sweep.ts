import pg from 'pg';
import { todayPhoenix, now, phoenixMidnightAfter, toInstant, addDays } from '../domain/time.js';
import { deleteObject, abortMultipart } from '../svc/storage.js';
import { recordLedger } from './ledger.js';
import { pool } from '../db/pool.js';
import { broadcast, pushNoticeToPerson } from './events.js';

export async function sweep(): Promise<void> {
  const client = await pool.connect();
  try {
    await endGrantsByDate(client);
    await lapseHandovers(client);
    await expireUploads(client);
    await purgeBin(client);
  } finally {
    client.release();
  }
}

async function endGrantsByDate(client: pg.PoolClient): Promise<void> {
  const today = todayPhoenix(now());
  const res = await client.query<{ id: string; item_type: string; item_id: string; person_id: string; role: string; end_date: string }>(
    `SELECT id, item_type, item_id, person_id, role, end_date FROM grants
     WHERE status = 'active' AND end_date < $1`,
    [today],
  );
  for (const grant of res.rows) {
    await client.query(
      `UPDATE grants SET status = 'ended', ended_reason = 'date', ended_at = $2 WHERE id = $1`,
      [grant.id, toInstant(now())],
    );
    await recordLedger(client, null, 'access_ended', grant.item_type === 'file' ? grant.item_id : null, grant.item_type === 'folder' ? grant.item_id : null, {
      grantId: grant.id, personId: grant.person_id, itemType: grant.item_type, itemId: grant.item_id, reason: 'date', endDate: grant.end_date,
    });
    const parentAccess = await partnerAccessAfterGrantEnd(client, grant.person_id, grant.item_type, grant.item_id);
    const itemName = await itemDisplayName(client, grant.item_type, grant.item_id);
    pushNoticeToPerson(grant.person_id, parentAccess ? 'editor_parent' : 'gone', {
      item: itemName, date: grant.end_date,
    });
    broadcast({ type: 'grant_ended', data: { grantId: grant.id, itemId: grant.item_id, itemType: grant.item_type, personId: grant.person_id } });
  }
}

async function partnerAccessAfterGrantEnd(client: pg.PoolClient, personId: string, itemType: string, itemId: string): Promise<string | null> {
  const today = todayPhoenix(now());
  const res = await client.query<{ itemType: string; itemId: string; role: string }>(
    `SELECT item_type AS "itemType", item_id AS "itemId", role FROM grants
     WHERE person_id = $1 AND status = 'active' AND end_date >= $2`,
    [personId, today],
  );
  const map = new Map<string, string>();
  for (const g of res.rows) map.set(`${g.itemType}:${g.itemId}`, g.role);
  if (itemType === 'folder') {
    const children = await client.query<{ id: string }>(
      `WITH RECURSIVE down AS (
         SELECT id FROM folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM folders f JOIN down ON f.parent_id = down.id
       ) SELECT id FROM down`,
      [itemId],
    );
    const covered = children.rows.map(r => r.id);
    for (const cid of covered) {
      const ancestors = await client.query<{ id: string; parent_id: string | null }>(
        `WITH RECURSIVE up AS (
           SELECT id, parent_id FROM folders WHERE id = $1
           UNION ALL
           SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
         ) SELECT id, parent_id FROM up`,
        [cid],
      );
      for (const anc of ancestors.rows) {
        const role = map.get(`folder:${anc.id}`);
        if (role) return role;
      }
    }
    return null;
  }
  const file = await client.query<{ folder_id: string | null }>('SELECT folder_id FROM files WHERE id = $1', [itemId]);
  const folderId = file.rows[0]?.folder_id;
  if (!folderId) return null;
  const ancestors = await client.query<{ id: string }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
     ) SELECT id FROM up`,
    [folderId],
  );
  for (const anc of ancestors.rows) {
    const role = map.get(`folder:${anc.id}`);
    if (role) return role;
  }
  return null;
}

async function itemDisplayName(client: pg.PoolClient, itemType: string, itemId: string): Promise<string> {
  if (itemType === 'folder') {
    const res = await client.query<{ name: string }>('SELECT name FROM folders WHERE id = $1', [itemId]);
    return res.rows[0]?.name ?? '';
  }
  const res = await client.query<{ name: string }>('SELECT name FROM files WHERE id = $1', [itemId]);
  return res.rows[0]?.name ?? '';
}

async function lapseHandovers(client: pg.PoolClient): Promise<void> {
  const today = todayPhoenix(now());
  const res = await client.query<{ id: string; folder_id: string; from_person: string; to_person: string; lapse_date: string }>(
    `SELECT id, folder_id, from_person, to_person, lapse_date FROM handovers WHERE status = 'offered' AND lapse_date < $1`,
    [today],
  );
  for (const h of res.rows) {
    await client.query(`UPDATE handovers SET status = 'lapsed' WHERE id = $1`, [h.id]);
    await recordLedger(client, null, 'handover_lapsed', null, h.folder_id, { handoverId: h.id, toName: null });
    const folder = await client.query<{ name: string }>('SELECT name FROM folders WHERE id = $1', [h.folder_id]);
    const toPerson = await client.query<{ name: string }>('SELECT name FROM people WHERE id = $1', [h.to_person]);
    pushNoticeToPerson(h.from_person, 'handover_lapsed', {
      folder: folder.rows[0]?.name ?? '', person: toPerson.rows[0]?.name ?? '',
    });
    broadcast({ type: 'handover_lapsed', data: { handoverId: h.id, folderId: h.folder_id, status: 'lapsed', fromId: h.from_person, toId: h.to_person } });
  }
}

async function expireUploads(client: pg.PoolClient): Promise<void> {
  const cutoff = toInstant(now() - (Number(process.env.UPLOAD_PAUSE_TTL_SECONDS ?? '86400')) * 1000);
  const res = await client.query<{ id: string; state: string; s3_upload_id: string | null; person_id: string; name: string }>(
    `SELECT id, state, s3_upload_id, person_id, name FROM uploads
     WHERE state IN ('started','uploading','paused') AND last_progress_at < $1`,
    [cutoff],
  );
  for (const u of res.rows) {
    await client.query(`UPDATE uploads SET state = 'abandoned' WHERE id = $1`, [u.id]);
    if (u.s3_upload_id) {
      try { await abortMultipart(u.id, u.s3_upload_id); } catch { /* retried on next sweep */ }
    }
    broadcast({ type: 'upload_expired', data: { uploadId: u.id, personId: u.person_id, name: u.name } });
  }
}

async function purgeBin(client: pg.PoolClient): Promise<void> {
  const today = todayPhoenix(now());
  const res = await client.query<{ id: string; name: string; folder_id: string | null; binned_date: string; retention_days: number }>(
    `SELECT f.id, f.name, f.folder_id, b.binned_date::text AS binned_date, b.retention_days
     FROM files f JOIN bin b ON b.file_id = f.id
     WHERE f.purged = false AND (b.binned_date + b.retention_days) <= $1`,
    [today],
  );
  for (const row of res.rows) {
    try {
      await deleteObject(row.id);
    } catch {
      await client.query(`UPDATE files SET bin_purge_pending = true WHERE id = $1`, [row.id]);
      continue;
    }
    await client.query('DELETE FROM bin WHERE file_id = $1', [row.id]);
    await client.query('UPDATE files SET purged = true, folder_id = NULL, bin_purge_pending = false WHERE id = $1', [row.id]);
    await client.query(`UPDATE grants SET status = 'ended', ended_reason = 'purged', ended_at = $2 WHERE item_type = 'file' AND item_id = $1 AND status = 'active'`, [row.id, toInstant(now())]);
    const folderId = row.folder_id ?? null;
    await recordLedger(client, null, 'purged', row.id, folderId, { fileName: row.name, fromFolder: row.folder_id });
    broadcast({ type: 'file_purged', data: { fileId: row.id, folderId: row.folder_id, name: row.name } });
  }
}
