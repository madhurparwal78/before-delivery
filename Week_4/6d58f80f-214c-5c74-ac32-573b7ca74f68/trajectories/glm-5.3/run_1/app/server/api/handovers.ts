import { ApiError, sendJson } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix, addDays, daysBetween, isValidDate } from '../domain/time.js';
import { newId } from '../domain/id.js';
import { recordLedger } from './ledger.js';
import { broadcast, pushNoticeToPerson } from './events.js';
import { getFolder } from './access.js';
import type { RouteContext } from './routes.js';

export async function listHandovers(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const res = await pool.query(
    `SELECT h.id, h.folder_id, h.from_person, h.to_person, h.offered_date::text AS offered_date, h.lapse_date::text AS lapse_date, h.status,
            f.name AS folder_name, pf.name AS from_name, pt.name AS to_name
     FROM handovers h
     JOIN folders f ON f.id = h.folder_id
     JOIN people pf ON pf.id = h.from_person
     JOIN people pt ON pt.id = h.to_person
     ORDER BY h.created_at DESC`,
  );
  const rows = res.rows.filter(r => person.staffRole === 'controller' || r['from_person'] === person.id || r['to_person'] === person.id);
  sendJson(ctx.res, 200, {
    handovers: rows.map(r => ({
      id: r['id'],
      folder: { id: r['folder_id'], name: r['folder_name'] },
      from: { id: r['from_person'], name: r['from_name'] },
      to: { id: r['to_person'], name: r['to_name'] },
      offeredDate: r['offered_date'],
      lapseDate: r['lapse_date'],
      status: r['status'],
    })),
  });
}

export async function offerHandover(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const body = ctx.body ?? {};
  const folderId = body['folderId'];
  const toPersonId = body['toPersonId'];
  const days = body['days'];
  if (typeof folderId !== 'string' || folderId.length < 1) throw new ApiError('validation', { folderId: 'Choose a project folder.' });
  const client = await pool.connect();
  let folderName = '';
  try {
    const folder = await getFolder(client, folderId);
    if (!folder) throw new ApiError('not_found');
    folderName = folder.name;
    const ownerId = folder.projectId ? (await client.query<{ owner_id: string }>('SELECT owner_id FROM folders WHERE id = $1', [folder.projectId])).rows[0]?.owner_id : folder.ownerId;
    if (person.kind !== 'staff' || (person.staffRole !== 'controller' && ownerId !== person.id)) {
      throw new ApiError(person.kind === 'partner' ? 'not_found' : 'forbidden');
    }
    if (folder.parentId !== null) throw new ApiError('validation', { folderId: 'Choose a top-level project folder.' });
  } finally {
    client.release();
  }
  if (typeof toPersonId !== 'string' || toPersonId.length < 1) throw new ApiError('validation', { toPersonId: 'Choose a staff member.' });
  const target = await pool.query<{ name: string; kind: string; id: string }>('SELECT name, kind, id FROM people WHERE id = $1', [toPersonId]);
  const targetPerson = target.rows[0];
  if (!targetPerson) throw new ApiError('validation', { toPersonId: 'Choose a staff member other than the current owner.' });
  if (targetPerson['kind'] !== 'staff') throw new ApiError('validation', { toPersonId: 'Choose a staff member other than the current owner.' });
  if (targetPerson['id'] === person.id) throw new ApiError('validation', { toPersonId: 'Choose a staff member other than the current owner.' });
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 14) {
    throw new ApiError('validation', { days: 'Enter whole days from 1 to 14.' });
  }
  const today = todayPhoenix(now());
  const lapseDate = addDays(today, days);
  const handoverId = newId('hnd');
  await withTransaction(async (txClient) => {
    const open = await txClient.query(`SELECT id FROM handovers WHERE folder_id = $1 AND status = 'offered'`, [folderId]);
    if (open.rows.length > 0) throw new ApiError('handover_open');
    await txClient.query(
      `INSERT INTO handovers (id, folder_id, from_person, to_person, offered_date, lapse_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'offered',$7)`,
      [handoverId, folderId, person.id, toPersonId, today, lapseDate, toInstant(now())],
    );
    await recordLedger(txClient, { id: person.id, name: person.name }, 'handover_offered', null, folderId, {
      handoverId, folderName, toName: targetPerson['name'], lapseDate,
    });
  });
  broadcast({ type: 'handover_offered', data: { handoverId, folderId, folderName, fromId: person.id, toId: toPersonId, lapseDate } });
  pushNoticeToPerson(toPersonId, 'handover_offered', { folder: folderName });
  const toName = targetPerson['name'] as string;
  sendJson(ctx.res, 201, {
    handover: {
      id: handoverId, folder: { id: folderId, name: folderName },
      from: { id: person.id, name: person.name }, to: { id: toPersonId, name: toName },
      offeredDate: today, lapseDate, status: 'offered',
    },
  });
}

export async function decideHandover(ctx: RouteContext, decision: 'accepted' | 'declined'): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query(
    `SELECT h.folder_id, h.from_person, h.to_person, h.status, h.lapse_date::text AS lapse_date, f.name AS folder_name
     FROM handovers h JOIN folders f ON f.id = h.folder_id WHERE h.id = $1`, [id],
  );
  const h = res.rows[0];
  if (!h) throw new ApiError('not_found');
  if (h['to_person'] !== person.id) {
    if (person.kind === 'partner') throw new ApiError('not_found');
    if (person.staffRole !== 'controller' && h['from_person'] !== person.id) throw new ApiError('not_found');
    throw new ApiError('forbidden');
  }
  if (h['status'] !== 'offered') throw new ApiError(`handover_${h['status']}` as 'handover_lapsed');
  const today = todayPhoenix(now());
  if (h['lapse_date'] < today) {
    await withTransaction(async (client) => {
      await client.query(`UPDATE handovers SET status = 'lapsed' WHERE id = $1`, [id]);
      await recordLedger(client, null, 'handover_lapsed', null, h['folder_id'], { handoverId: id });
    });
    throw new ApiError('handover_lapsed');
  }
  await withTransaction(async (client) => {
    if (decision === 'accepted') {
      await client.query(`UPDATE folders SET owner_id = $2 WHERE id = $1`, [h['folder_id'], person.id]);
      const folder = await getFolder(client, h['folder_id']);
      if (folder?.projectId) {
        await client.query(`UPDATE folders SET owner_id = $2 WHERE id = $1`, [folder.projectId, person.id]);
      }
    }
    await client.query(`UPDATE handovers SET status = $2 WHERE id = $1`, [id, decision]);
    await recordLedger(client, { id: person.id, name: person.name }, `handover_${decision}`, null, h['folder_id'], {
      handoverId: id, folderName: h['folder_name'], byPerson: person.name,
    });
  });
  broadcast({
    type: `handover_${decision}`,
    data: { handoverId: id, folderId: h['folder_id'], folderName: h['folder_name'], fromId: h['from_person'], toId: person.id },
  });
  pushNoticeToPerson(h['from_person'], decision === 'accepted' ? 'handover_accepted' : 'handover_declined', {
    person: person.name, folder: h['folder_name'],
  });
  sendJson(ctx.res, 200, {
    handover: {
      id, folder: { id: h['folder_id'], name: h['folder_name'] },
      from: { id: h['from_person'], name: '' }, to: { id: person.id, name: person.name },
      offeredDate: '', lapseDate: h['lapse_date'], status: decision,
    },
  });
}
