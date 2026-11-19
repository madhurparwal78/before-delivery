import { ApiError, sendJson } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix, addDays, daysBetween } from '../domain/time.js';
import { newId } from '../domain/id.js';
import { recordLedger } from './ledger.js';
import { broadcast, pushNoticeToPerson } from './events.js';
import { getFile, getFolder } from './access.js';
import { serializeFolder, serializeFile } from './serialize.js';
import type { RouteContext } from './routes.js';
import { searchPeople } from '../svc/directory.js';
import { isValidDate } from '../domain/time.js';

async function requireShareRights(ctx: RouteContext, itemType: 'folder' | 'file', itemId: string): Promise<{ itemName: string; folderId: string | null; projectId: string | null }> {
  const person = ctx.person!;
  const client = await pool.connect();
  try {
    if (itemType === 'folder') {
      const folder = await getFolder(client, itemId);
      if (!folder) throw new ApiError('not_found');
      const projectOwner = await projectOwnerFor(client, folder);
      if (person.kind !== 'staff' || (person.staffRole !== 'controller' && projectOwner !== person.id)) {
        throw new ApiError(person.kind === 'partner' ? 'not_found' : 'forbidden');
      }
      return { itemName: folder.name, folderId: itemId, projectId: folder.projectId };
    }
    const file = await getFile(client, itemId);
    if (!file) throw new ApiError('not_found');
    const projectFolder = file.folderId ? await client.query<{ id: string; name: string; project_id: string | null }>('SELECT id, name, project_id FROM folders WHERE id = $1', [file.folderId]) : null;
    const projectRow = projectFolder?.rows[0];
    if (person.kind !== 'staff') throw new ApiError('not_found');
    if (person.staffRole === 'controller') return { itemName: file.name, folderId: file.folderId, projectId: projectRow?.project_id ?? null };
    if (!file.folderId || !projectRow) throw new ApiError('forbidden');
    const project = await client.query<{ owner_id: string }>('SELECT owner_id FROM folders WHERE id = $1', [projectRow.project_id ?? file.folderId]);
    if (project.rows[0]?.owner_id !== person.id) throw new ApiError('forbidden');
    return { itemName: file.name, folderId: file.folderId, projectId: projectRow.project_id ?? null };
  } finally {
    client.release();
  }
}

async function projectOwnerFor(client: import('pg').PoolClient, folder: { id: string; projectId: string | null }): Promise<string | null> {
  const target = folder.projectId ?? folder.id;
  const res = await client.query<{ owner_id: string }>('SELECT owner_id FROM folders WHERE id = $1', [target]);
  return res.rows[0]?.owner_id ?? null;
}

export async function listGrants(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const itemType = ctx.url.searchParams.get('itemType');
  const itemId = ctx.url.searchParams.get('itemId');
  if (itemType !== 'folder' && itemType !== 'file') throw new ApiError('not_found');
  const client = await pool.connect();
  try {
    let itemName: string;
    if (itemType === 'folder') {
      const folder = await getFolder(client, itemId ?? '');
      if (!folder) throw new ApiError('not_found');
      itemName = folder.name;
    } else {
      const file = await getFile(client, itemId ?? '');
      if (!file) throw new ApiError('not_found');
      itemName = file.name;
    }
    const res = await client.query(
      `SELECT g.id, g.item_type, g.item_id, g.role, g.end_date::text AS end_date, g.status, g.ended_reason, p.id AS person_id, p.name AS person_name, p.firm
       FROM grants g JOIN people p ON p.id = g.person_id
       WHERE g.item_type = $1 AND g.item_id = $2 AND g.status = 'active'
       ORDER BY p.name`,
      [itemType, itemId],
    );
    const today = todayPhoenix(now());
    const grants = res.rows.map(r => ({
      id: r['id'],
      itemType,
      itemId,
      itemName,
      person: { id: r['person_id'], name: r['person_name'], firm: r['firm'] },
      role: r['role'],
      endDate: r['end_date'],
      daysLeft: daysBetween(today, r['end_date']),
      status: r['status'],
      endedReason: r['ended_reason'],
    }));
    sendJson(ctx.res, 200, { grants });
  } finally {
    client.release();
  }
}

export async function createGrant(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const body = ctx.body ?? {};
  const itemType = body['itemType'];
  const itemId = body['itemId'];
  const personId = body['personId'];
  const role = body['role'];
  const endDate = body['endDate'];
  if (itemType !== 'folder' && itemType !== 'file') throw new ApiError('validation', { itemType: 'Choose a folder or file.' });
  if (typeof itemId !== 'string') throw new ApiError('validation', { itemId: 'Choose an item.' });
  if (typeof personId !== 'string' || personId.length < 1) throw new ApiError('validation', { personId: 'Choose a person.' });
  if (role !== 'viewer' && role !== 'editor') throw new ApiError('validation', { role: 'Choose viewer or editor.' });
  const item = await requireShareRights(ctx, itemType, itemId);
  let target: { id: string; name: string; kind: string } | undefined;
  try {
    const matches = await searchPeople('', undefined);
    target = matches.find(m => m.id === personId);
    if (!target) {
      const res = await pool.query('SELECT id, name, kind FROM people WHERE id = $1', [personId]);
      target = res.rows[0] as { id: string; name: string; kind: string } | undefined;
    }
  } catch {
    throw new ApiError('directory_unavailable');
  }
  if (!target) throw new ApiError('validation', { personId: 'Choose a person.' });
  if (target.kind !== 'partner') throw new ApiError('validation', { personId: 'Only outside partners get timed access.' });
  const today = todayPhoenix(now());
  let finalEnd: string;
  if (typeof endDate === 'string' && endDate.length > 0) {
    if (!isValidDate(endDate)) throw new ApiError('validation', { endDate: `Choose a date from ${today} to ${addDays(today, 365)}.` });
    const min = today;
    const max = addDays(today, 365);
    if (endDate < min || endDate > max) throw new ApiError('validation', { endDate: `Choose a date from ${min} to ${max}.` });
    finalEnd = endDate;
  } else {
    finalEnd = addDays(today, await grantDaysDefault());
  }
  const grantId = newId('grt');
  const result = await withTransaction(async (client) => {
    const exists = await client.query(`SELECT id FROM grants WHERE item_type = $1 AND item_id = $2 AND person_id = $3 AND status = 'active'`, [itemType, itemId, personId]);
    if (exists.rows.length > 0) throw new ApiError('grant_exists');
    await client.query(
      `INSERT INTO grants (id, item_type, item_id, person_id, role, end_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`,
      [grantId, itemType, itemId, personId, role, finalEnd, toInstant(now())],
    );
    await recordLedger(client, { id: person.id, name: person.name }, 'shared', itemType === 'file' ? itemId : null, itemType === 'folder' ? itemId : null, {
      grantId, personName: target!.name, role, endDate: finalEnd, itemName: item.itemName,
    });
    return { grantId };
  });
  broadcast({ type: 'grant_created', data: { grantId, itemType, itemId, personId, role, endDate: finalEnd, itemName: item.itemName } });
  pushNoticeToPerson(personId, 'shared', { item: item.itemName });
  sendJson(ctx.res, 201, {
    grant: {
      id: grantId, itemType, itemId, itemName: item.itemName,
      person: { id: personId, name: target.name, firm: '' },
      role, endDate: finalEnd, daysLeft: daysBetween(today, finalEnd), status: 'active', endedReason: null,
    },
  });
}

async function grantDaysDefault(): Promise<number> {
  const today = todayPhoenix(now());
  const res = await pool.query<{ days: string }>(
    'SELECT days::text AS days FROM policies WHERE kind = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1',
    ['partner_grant_days', today],
  );
  return Number(res.rows[0]?.days ?? 30);
}

export async function updateGrant(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const body = ctx.body ?? {};
  const res = await pool.query<{ item_type: string; item_id: string; person_id: string; role: string; end_date: string; status: string; name: string }>(
    `SELECT g.item_type, g.item_id, g.person_id, g.role, g.end_date::text AS end_date, g.status, p.name
     FROM grants g JOIN people p ON p.id = g.person_id WHERE g.id = $1`, [id],
  );
  const grant = res.rows[0];
  if (!grant) throw new ApiError('not_found');
  if (grant['status'] !== 'active') throw new ApiError('grant_ended');
  await requireShareRights(ctx, grant['item_type'] as 'folder' | 'file', grant['item_id']);
  const today = todayPhoenix(now());
  let newRole = grant['role'];
  let newEnd = grant['end_date'];
  if (typeof body['role'] === 'string') {
    if (body['role'] !== 'viewer' && body['role'] !== 'editor') throw new ApiError('validation', { role: 'Choose viewer or editor.' });
    newRole = body['role'];
  }
  if (typeof body['endDate'] === 'string' && body['endDate'].length > 0) {
    if (!isValidDate(body['endDate'])) throw new ApiError('validation', { endDate: `Choose a date from ${today} to ${addDays(today, 365)}.` });
    if (body['endDate'] < today || body['endDate'] > addDays(today, 365)) {
      throw new ApiError('validation', { endDate: `Choose a date from ${today} to ${addDays(today, 365)}.` });
    }
    newEnd = body['endDate'];
  }
  const itemName = await itemDisplayName(grant['item_type'], grant['item_id']);
  await withTransaction(async (client) => {
    await client.query('UPDATE grants SET role = $2, end_date = $3 WHERE id = $1', [id, newRole, newEnd]);
    await recordLedger(client, { id: person.id, name: person.name }, 'access_changed', grant['item_type'] === 'file' ? grant['item_id'] : null, grant['item_type'] === 'folder' ? grant['item_id'] : null, {
      grantId: id, personName: grant['name'], role: newRole, endDate: newEnd, itemName,
    });
  });
  broadcast({ type: 'grant_changed', data: { grantId: id, itemType: grant['item_type'], itemId: grant['item_id'], personId: grant['person_id'], role: newRole, endDate: newEnd } });
  pushNoticeToPerson(grant['person_id'], newRole === 'viewer' ? 'downgraded' : 'upgraded', { item: itemName });
  sendJson(ctx.res, 200, {
    grant: {
      id, itemType: grant['item_type'], itemId: grant['item_id'], itemName,
      person: { id: grant['person_id'], name: grant['name'], firm: '' },
      role: newRole, endDate: newEnd, daysLeft: daysBetween(today, newEnd), status: 'active', endedReason: null,
    },
  });
}

export async function removeGrant(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  const id = ctx.params['id']!;
  const res = await pool.query<{ item_type: string; item_id: string; person_id: string; status: string; name: string }>(
    `SELECT g.item_type, g.item_id, g.person_id, g.status, p.name FROM grants g JOIN people p ON p.id = g.person_id WHERE g.id = $1`, [id],
  );
  const grant = res.rows[0];
  if (!grant) throw new ApiError('not_found');
  if (grant['status'] !== 'active') throw new ApiError('grant_ended');
  await requireShareRights(ctx, grant['item_type'] as 'folder' | 'file', grant['item_id']);
  const itemName = await itemDisplayName(grant['item_type'], grant['item_id']);
  await withTransaction(async (client) => {
    await client.query(`UPDATE grants SET status = 'ended', ended_reason = 'removed', ended_at = $2 WHERE id = $1`, [id, toInstant(now())]);
    await recordLedger(client, { id: person.id, name: person.name }, 'access_removed', grant['item_type'] === 'file' ? grant['item_id'] : null, grant['item_type'] === 'folder' ? grant['item_id'] : null, {
      grantId: id, personName: grant['name'], itemName,
    });
  });
  broadcast({ type: 'grant_removed', data: { grantId: id, itemType: grant['item_type'], itemId: grant['item_id'], personId: grant['person_id'] } });
  pushNoticeToPerson(grant['person_id'], 'removed', { item: itemName });
  ctx.res.writeHead(204);
  ctx.res.end();
}

async function itemDisplayName(itemType: string, itemId: string): Promise<string> {
  const client = await pool.connect();
  try {
    if (itemType === 'folder') {
      const folder = await getFolder(client, itemId);
      return folder?.name ?? '';
    }
    const file = await getFile(client, itemId);
    return file?.name ?? '';
  } finally {
    client.release();
  }
}

export async function grantDefaults(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const today = todayPhoenix(now());
  const days = await grantDaysDefault();
  sendJson(ctx.res, 200, { today, defaultEndDate: addDays(today, days), maxEndDate: addDays(today, 365) });
}

export async function sharedItems(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'staff') throw new ApiError('forbidden');
  const client = await pool.connect();
  try {
    const today = todayPhoenix(now());
    const res = await client.query<{ item_type: string; item_id: string; role: string; end_date: string }>(
      `SELECT item_type, item_id, role, end_date::text AS end_date FROM grants
       WHERE person_id = $1 AND status = 'active' AND end_date >= $2 ORDER BY created_at`,
      [person.id, today],
    );
    const items = [];
    for (const g of res.rows) {
      const role = g['role'];
      const endDate = g['end_date'];
      const daysLeft = daysBetween(today, endDate);
      if (g['item_type'] === 'folder') {
        const folder = await getFolder(client, g['item_id']);
        if (folder) {
          items.push({ itemType: 'folder', folder: await serializeFolder(client, person, folder.id), file: null, role, endDate, daysLeft });
        }
      } else {
        const file = await getFile(client, g['item_id']);
        if (file && !file.inBin) {
          items.push({ itemType: 'file', folder: null, file: await serializeFile(client, person, file), role, endDate, daysLeft });
        }
      }
    }
    sendJson(ctx.res, 200, { items });
  } finally {
    client.release();
  }
}
