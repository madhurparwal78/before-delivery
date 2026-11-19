import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, sendJson, sendNoContent, sendError, isOwnOrigin } from '../http/respond.js';
import { readJsonBody, hasBody, jsonBodyLimit, partBodyLimit } from '../http/body.js';
import { parseSessionCookie, getSession, destroySession, createSession } from './sessions.js';
import type { Person } from '../domain/types.js';
import { pool, withTransaction } from '../db/pool.js';
import { isValidDate, todayPhoenix, now, toInstant, addDays, phoenixMidnightAfter, clockBody, setClock, formatPhoenixDateTime } from '../domain/time.js';
import { validateName } from '../domain/names.js';
import { newId } from '../domain/id.js';
import { config } from '../config/runtime.js';
import { storageStatus, StorageDown, directoryStatus } from '../svc/status.js';
import { authenticate, searchPeople, DirectoryAuthError, upsertPerson } from '../svc/directory.js';
import * as storage from '../svc/storage.js';
import { createLinkToken, verifyLinkToken } from './links.js';
import { recordLedger } from './ledger.js';
import { broadcast, pushNoticeToPerson, registerConnection, dropConnection } from './events.js';
import { getFolder, getFile, folderAncestors, effectiveFolderAccess, effectiveFileAccess, activeGrantTop, fileAccessEndDate } from './access.js';
import { serializeFile, serializeFolder, visibleFolders } from './serialize.js';
import { sweep } from './sweep.js';
import { seedIfEmpty } from './seed.js';
import { handleMoveCompute } from './moves.js';
import {
  listUploads, getUpload, uploadPart as uploadPartHandler, pauseUpload, resumeUpload,
  completeUpload, deleteUpload, storageStats, uploadCreateWithBody,
} from './uploads.js';
import { listBin, binFiles, restoreFile, deleteForever } from './bin.js';
import {
  listGrants, createGrant, updateGrant, removeGrant, grantDefaults, sharedItems,
} from './grants.js';
import { listHandovers, offerHandover, decideHandover } from './handovers.js';
import { listPolicies, schedulePolicy, withdrawPolicy } from './policies.js';

type Handler = (ctx: RouteContext) => Promise<void>;

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  person: Person | null;
  body: Record<string, unknown> | null;
  rawBody: Buffer;
  params: Record<string, string>;
}

const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler; needsSession: boolean; allowNoBody: boolean }> = [];

function route(method: string, path: string, handler: Handler, opts: { session?: boolean; noBody?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern, keys, handler, needsSession: opts.session !== false, allowNoBody: opts.noBody === true });
}

function requireSession(ctx: RouteContext): Person {
  if (!ctx.person) throw new ApiError('unauthenticated');
  return ctx.person;
}

function requireStaff(ctx: RouteContext): Person {
  const person = requireSession(ctx);
  if (person.kind !== 'staff') throw new ApiError('not_found');
  return person;
}

function requireAdmin(ctx: RouteContext): Person {
  const person = requireStaff(ctx);
  if (person.staffRole !== 'admin') throw new ApiError('forbidden');
  return person;
}

function requireController(ctx: RouteContext): Person {
  const person = requireStaff(ctx);
  if (person.staffRole !== 'controller') throw new ApiError('forbidden');
  return person;
}

async function readBody(ctx: RouteContext): Promise<Record<string, unknown>> {
  if (ctx.body === null) throw new ApiError('unsupported_media_type');
  return ctx.body;
}

const SORTS = ['name-asc', 'name-desc', 'modified-desc', 'modified-asc', 'size-desc', 'size-asc'] as const;
type SortKey = typeof SORTS[number];

function sortClause(sort: string): string {
  switch (sort) {
    case 'name-desc': return 'name DESC, created_at DESC';
    case 'modified-desc': return 'modified_at DESC, created_at DESC';
    case 'modified-asc': return 'modified_at ASC, created_at DESC';
    case 'size-desc': return 'size DESC, created_at DESC';
    case 'size-asc': return 'size ASC, created_at DESC';
    default: return 'name ASC, created_at DESC';
  }
}

async function policyInForce(kind: 'bin_retention_days' | 'partner_grant_days', date: string): Promise<number> {
  const res = await pool.query<{ days: string }>(
    'SELECT days::text AS days FROM policies WHERE kind = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1',
    [kind, date],
  );
  return Number(res.rows[0]?.days ?? (kind === 'bin_retention_days' ? 30 : 30));
}

function hiddenFor(person: Person, visible: Set<string>): boolean {
  return person.kind === 'partner' && !visible.has(person.id);
}

route('GET', '/api/health', async (ctx) => {
  try {
    await pool.query('SELECT 1');
    sendJson(ctx.res, 200, { status: 'ok' });
  } catch {
    sendJson(ctx.res, 503, { status: 'starting' });
  }
}, { session: false, noBody: true });

route('GET', '/api/status', async (ctx) => {
  sendJson(ctx.res, 200, { storage: storageStatus(), directory: directoryStatus() });
}, { session: false, noBody: true });

route('GET', '/api/clock', async (ctx) => {
  sendJson(ctx.res, 200, clockBody());
}, { session: false, noBody: true });

route('PUT', '/api/clock', async (ctx) => {
  if (!config.clockControl) throw new ApiError('not_found');
  const body = await readBody(ctx);
  const instant = body['now'];
  if (typeof instant !== 'string' || Number.isNaN(Date.parse(instant))) {
    throw new ApiError('validation', { now: 'Enter a valid instant.' });
  }
  setClock(instant);
  await withTransaction(sweep);
  sendJson(ctx.res, 200, clockBody());
}, { session: false });

route('POST', '/api/session', async (ctx) => {
  const body = await readBody(ctx);
  const email = typeof body['email'] === 'string' ? body['email'] : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  if (!email || !password) throw new ApiError('invalid_credentials');
  let person: Person;
  try {
    person = await authenticate(email, password);
  } catch (err) {
    if (err instanceof DirectoryAuthError) throw new ApiError('invalid_credentials');
    throw new ApiError('directory_unavailable');
  }
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO people (id, email, name, firm, kind, staff_role) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, name = EXCLUDED.name, firm = EXCLUDED.firm, kind = EXCLUDED.kind, staff_role = EXCLUDED.staff_role',
      [person.id, person.email, person.name, person.firm, person.kind, person.staffRole],
    );
  } finally {
    client.release();
  }
  const token = await createSession(person);
  ctx.res.setHeader('Set-Cookie', `lintel_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  sendJson(ctx.res, 200, { person });
}, { session: false });

route('GET', '/api/session', async (ctx) => {
  const person = requireSession(ctx);
  sendJson(ctx.res, 200, { person });
}, { noBody: true });

route('DELETE', '/api/session', async (ctx) => {
  const token = parseSessionCookie(ctx.req.headers.cookie);
  await destroySession(token);
  ctx.res.setHeader('Set-Cookie', 'lintel_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  sendNoContent(ctx.res);
}, { session: false, noBody: true });

route('GET', '/api/people', async (ctx) => {
  const person = requireStaff(ctx);
  const q = ctx.url.searchParams.get('q') ?? '';
  if (q.length < 1 || q.length > 100) throw new ApiError('validation', { q: 'Enter between 1 and 100 characters.' });
  const kind = ctx.url.searchParams.get('kind');
  let people: Person[];
  try {
    people = await searchPeople(q, kind === 'staff' || kind === 'partner' ? kind : undefined);
  } catch {
    throw new ApiError('directory_unavailable');
  }
  sendJson(ctx.res, 200, { people });
}, { noBody: true });

route('GET', '/api/folders', async (ctx) => {
  const person = requireSession(ctx);
  const client = await pool.connect();
  try {
    const ids = await visibleFolders(client, person);
    const folders = [];
    for (const id of ids) {
      folders.push(await serializeFolder(client, person, id));
    }
    sendJson(ctx.res, 200, { folders });
  } finally {
    client.release();
  }
}, { noBody: true });

route('POST', '/api/folders', async (ctx) => {
  const person = requireSession(ctx);
  const body = await readBody(ctx);
  const name = typeof body['name'] === 'string' ? body['name'] : undefined;
  const parentIdRaw = body['parentId'];
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : null;
  const nameError = validateName(name);
  if (nameError) throw new ApiError('validation', { name: nameError });
  const folder = await withTransaction(async (client) => {
    if (parentId) {
      const parent = await getFolder(client, parentId);
      if (!parent) throw new ApiError('not_found');
      if (person.kind === 'partner') {
        const grants = await activeGrantTop(client, person.id);
        const role = await effectiveFolderAccess(client, person, parentId, grants);
        if (role !== 'editor') throw new ApiError('not_found');
      }
      const result = await client.query<{ id: string }>(
        'INSERT INTO folders (id, name, parent_id, project_id, owner_id, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [newId('fol'), (name as string).trim(), parentId, parent.projectId, parent.ownerId, toInstant(now())],
      );
      const folderId = result.rows[0]!.id;
      await recordLedger(client, { id: person.id, name: person.name }, 'folder_created', null, folderId, { folderName: (name as string).trim() });
      return folderId;
    }
    if (person.kind === 'partner') throw new ApiError('not_found');
    const result = await client.query<{ id: string }>(
      'INSERT INTO folders (id, name, parent_id, project_id, owner_id, created_at) VALUES ($1,$2,NULL,$1,$3,$4) RETURNING id',
      [newId('fol'), (name as string).trim(), person.id, toInstant(now())],
    );
    const folderId = result.rows[0]!.id;
    await recordLedger(client, { id: person.id, name: person.name }, 'folder_created', null, folderId, { folderName: (name as string).trim() });
    return folderId;
  });
  const client = await pool.connect();
  try {
    const serialized = await serializeFolder(client, person, folder);
    broadcast({ type: 'folder_created', data: { folderId: folder } });
    sendJson(ctx.res, 201, { folder: serialized });
  } finally {
    client.release();
  }
});

route('GET', '/api/folders/:id', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const client = await pool.connect();
  try {
    const folder = await getFolder(client, id);
    if (!folder) throw new ApiError('not_found');
    if (person.kind === 'partner') {
      const grants = await activeGrantTop(client, person.id);
      const role = await effectiveFolderAccess(client, person, id, grants);
      if (!role) throw new ApiError('not_found');
    }
    const serialized = await serializeFolder(client, person, id);
    const ancestors = await folderAncestors(client, id);
    const path = [];
    const visibleSet = person.kind === 'partner' ? new Set((await visibleFolders(client, person))) : new Set(ancestors.map(a => a.id));
    for (const anc of ancestors) {
      if (person.kind === 'partner' && !visibleSet.has(anc.id)) continue;
      path.push({ id: anc.id, name: anc.name });
    }
    sendJson(ctx.res, 200, { folder: serialized, path });
  } finally {
    client.release();
  }
}, { noBody: true });

route('GET', '/api/folders/:id/activity', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const client = await pool.connect();
  try {
    const folder = await getFolder(client, id);
    if (!folder) throw new ApiError('not_found');
    if (person.kind === 'partner') {
      const grants = await activeGrantTop(client, person.id);
      const role = await effectiveFolderAccess(client, person, id, grants);
      if (!role) throw new ApiError('not_found');
    }
    const res = await client.query(
      `SELECT id, at::text AS at, actor_id, actor_name, action, file_id, folder_id, detail
       FROM ledger
       WHERE folder_id = $1 OR file_id IN (SELECT id FROM files WHERE folder_id = $1)
       ORDER BY at DESC LIMIT 200`,
      [id],
    );
    sendJson(ctx.res, 200, { entries: res.rows.map(r => formatLedger(r, person)) });
  } finally {
    client.release();
  }
}, { noBody: true });

function formatLedger(row: Record<string, unknown>, person: Person): Record<string, unknown> {
  const detail = typeof row['detail'] === 'string' ? (JSON.parse(row['detail'] as string) as Record<string, unknown>) : (row['detail'] as Record<string, unknown>) ?? {};
  const rawAt = String(row['at'] ?? '');
  const iso = rawAt.includes('T') ? rawAt : rawAt.replace(' ', 'T');
  const atIso = /[Z+]$/.test(iso) ? iso : `${iso}${iso.includes('.') ? '' : '.000'}Z`;
  return {
    id: row['id'],
    at: atIso,
    actor: row['actor_id'] ? { id: row['actor_id'], name: row['actor_name'] } : null,
    action: row['action'],
    fileId: row['file_id'],
    folderId: row['folder_id'],
    detail,
  };
}

route('GET', '/api/files', async (ctx) => {
  const person = requireSession(ctx);
  const folderId = ctx.url.searchParams.get('folderId');
  const sort = ctx.url.searchParams.get('sort') ?? 'name-asc';
  const q = ctx.url.searchParams.get('q') ?? '';
  if (!SORTS.includes(sort as SortKey)) throw new ApiError('validation', { sort: 'Choose a sort.' });
  if (q.length > 100) throw new ApiError('validation', { q: 'Enter up to 100 characters.' });
  const client = await pool.connect();
  try {
    if (folderId) {
      const folder = await getFolder(client, folderId);
      if (!folder) throw new ApiError('not_found');
      if (person.kind === 'partner') {
        const grants = await activeGrantTop(client, person.id);
        const role = await effectiveFolderAccess(client, person, folderId, grants);
        if (!role) throw new ApiError('not_found');
      }
      const subfolders = await client.query<{ id: string }>(
        'SELECT id FROM folders WHERE parent_id = $1 ORDER BY created_at, id',
        [folderId],
      );
      const foldersOut = [];
      for (const f of subfolders.rows) {
        const visible = person.kind === 'partner' ? (await visibleFolders(client, person)).includes(f.id) : true;
        if (person.kind === 'partner' && !visible) continue;
        foldersOut.push(await serializeFolder(client, person, f.id));
      }
      const filesRes = await client.query(
        `SELECT id, name, folder_id AS "folderId", size, content_type AS "contentType", modified_at AS "modifiedAt",
                locked, in_bin AS "inBin", last_activity AS "lastActivity"
         FROM files WHERE folder_id = $1 AND in_bin = false AND purged = false
         ORDER BY ${sortClause(sort)}`,
        [folderId],
      );
      const filesOut = [];
      for (const row of filesRes.rows) {
        filesOut.push(await serializeFile(client, person, row));
      }
      sendJson(ctx.res, 200, { folders: foldersOut, files: filesOut });
      return;
    }
    if (q.length > 0) {
      if (q.length < 1) throw new ApiError('validation', { q: 'Enter between 1 and 100 characters.' });
      const filesRes = await client.query(
        `SELECT id, name, folder_id AS "folderId", size, content_type AS "contentType", modified_at AS "modifiedAt",
                locked, in_bin AS "inBin", last_activity AS "lastActivity"
         FROM files WHERE in_bin = false AND purged = false AND name ILIKE $1
         ORDER BY ${sortClause(sort)}`,
        [`%${q}%`],
      );
      const filesOut = [];
      const visibleSet = new Set(await visibleFolders(client, person));
      for (const row of filesRes.rows) {
        if (row['folder_id'] && !visibleSet.has(row['folder_id'] as string)) continue;
        filesOut.push(await serializeFile(client, person, row));
      }
      sendJson(ctx.res, 200, { folders: [], files: filesOut });
      return;
    }
    if (person.kind === 'staff') {
      const subfolders = await client.query<{ id: string }>('SELECT id FROM folders WHERE parent_id IS NULL ORDER BY created_at, id');
      const foldersOut = [];
      for (const f of subfolders.rows) {
        foldersOut.push(await serializeFolder(client, person, f.id));
      }
      sendJson(ctx.res, 200, { folders: foldersOut, files: [] });
      return;
    }
    sendJson(ctx.res, 200, { folders: [], files: [] });
  } finally {
    client.release();
  }
}, { noBody: true });

route('GET', '/api/files/recent', async (ctx) => {
  const person = requireSession(ctx);
  const client = await pool.connect();
  try {
    const visibleSet = new Set(await visibleFolders(client, person));
    const res = await client.query(
      `SELECT f.id, f.name, f.folder_id AS "folderId", f.size, f.content_type AS "contentType", f.modified_at AS "modifiedAt",
              f.locked, f.in_bin AS "inBin", f.last_activity AS "lastActivity"
       FROM files f
       WHERE f.in_bin = false AND f.purged = false
       ORDER BY f.last_activity DESC LIMIT 200`,
    );
    const filesOut = [];
    for (const row of res.rows) {
      if (row['folder_id'] && !visibleSet.has(row['folder_id'] as string)) continue;
      filesOut.push(await serializeFile(client, person, row));
      if (filesOut.length >= 50) break;
    }
    sendJson(ctx.res, 200, { files: filesOut });
  } finally {
    client.release();
  }
}, { noBody: true });

route('GET', '/api/files/:id', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    if (!file) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFileAccess(client, person, file, grants);
    if (!role) throw new ApiError('not_found');
    if (person.kind === 'partner' && file.inBin) throw new ApiError('not_found');
    const serialized = await serializeFile(client, person, file);
    const path = [];
    if (file.folderId) {
      const ancestors = await folderAncestors(client, file.folderId);
      const visibleSet = new Set(await visibleFolders(client, person));
      for (const anc of ancestors) {
        if (person.kind === 'partner' && !visibleSet.has(anc.id)) continue;
        path.push({ id: anc.id, name: anc.name });
      }
    }
    sendJson(ctx.res, 200, { file: serialized, path });
  } finally {
    client.release();
  }
}, { noBody: true });

route('PATCH', '/api/files/:id', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const body = await readBody(ctx);
  const name = body['name'];
  const nameError = validateName(name);
  if (nameError) throw new ApiError('validation', { name: nameError });
  const updated = await withTransaction(async (client) => {
    const file = await getFile(client, id);
    if (!file || file.inBin) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFileAccess(client, person, file, grants);
    if (!role) throw new ApiError('not_found');
    if (role !== 'editor') throw new ApiError('forbidden');
    if (file.locked) throw new ApiError('locked');
    const newName = (name as string).trim();
    await client.query('UPDATE files SET name = $2, modified_at = $3, last_activity = $3 WHERE id = $1', [id, newName, toInstant(now())]);
    await recordLedger(client, { id: person.id, name: person.name }, 'renamed', id, file.folderId, { fileName: newName, oldName: file.name });
    return { fileId: id, folderId: file.folderId, newName };
  });
  broadcast({ type: 'file_renamed', data: { fileId: id, folderId: updated.folderId, name: updated.newName } });
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    sendJson(ctx.res, 200, { file: await serializeFile(client, person, file!) });
  } finally {
    client.release();
  }
});

route('GET', '/api/files/:id/activity', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    if (!file) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFileAccess(client, person, file, grants);
    if (!role) throw new ApiError('not_found');
    const res = await client.query(
      `SELECT id, at::text AS at, actor_id, actor_name, action, file_id, folder_id, detail
       FROM ledger WHERE file_id = $1 ORDER BY at DESC LIMIT 100`,
      [id],
    );
    sendJson(ctx.res, 200, { entries: res.rows.map(r => formatLedger(r, person)) });
  } finally {
    client.release();
  }
}, { noBody: true });

route('POST', '/api/files/:id/links', async (ctx) => {
  const person = requireSession(ctx);
  const id = ctx.params['id']!;
  const body = await readBody(ctx);
  const purpose = body['purpose'];
  if (purpose !== 'preview' && purpose !== 'download') throw new ApiError('validation', { purpose: 'Choose preview or download.' });
  const sessionTokenForLink = parseSessionCookie(ctx.req.headers.cookie) ?? '';
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    if (!file || file.inBin) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFileAccess(client, person, file, grants);
    if (!role) throw new ApiError('not_found');
    if (purpose === 'preview') {
      const previewable = file.contentType === 'image/png' || file.contentType === 'image/jpeg' || file.contentType === 'application/pdf';
      if (!previewable) throw new ApiError('validation', { purpose: 'This file type cannot be previewed.' });
    }
    sendJson(ctx.res, 201, createLinkToken({ fileId: id, purpose, sessionId: sessionTokenForLink, issuedAt: now() }));
  } finally {
    client.release();
  }
});

route('GET', '/api/content/:token', async (ctx) => {
  const person = requireSession(ctx);
  const token = ctx.params['token']!;
  const payload = verifyLinkToken(token);
  if (payload === 'bad' || payload === 'expired') {
    if (payload === 'expired') throw new ApiError('link_expired');
    throw new ApiError('not_found');
  }
  const sessionToken = parseSessionCookie(ctx.req.headers.cookie);
  if (payload.sessionId !== (sessionToken ?? '')) {
    throw new ApiError('not_found');
  }
  const client = await pool.connect();
  try {
    const file = await getFile(client, payload.fileId);
    if (!file || (file.inBin && person.kind === 'partner')) throw new ApiError('not_found');
    const grants = await activeGrantTop(client, person.id);
    const role = await effectiveFileAccess(client, person, file, grants);
    if (!role) throw new ApiError('not_found');
    let stream;
    try {
      stream = await storage.getObjectStream(file.id);
    } catch {
      throw new ApiError('storage_unavailable');
    }
    const disposition = payload.purpose === 'preview' ? 'inline' : `attachment; filename="${file.name.replace(/"/g, '')}"`;
    ctx.res.writeHead(200, {
      'Content-Type': file.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': disposition,
      ...(payload.purpose === 'preview' ? { 'Content-Security-Policy': 'sandbox' } : {}),
    });
    stream.pipe(ctx.res);
    await new Promise<void>((resolve) => { ctx.res.on('close', resolve); });
  } finally {
    client.release();
  }
}, { noBody: true });

route('POST', '/api/files/:id/lock', async (ctx) => {
  const person = requireController(ctx);
  const id = ctx.params['id']!;
  const result = await withTransaction(async (client) => {
    const file = await getFile(client, id);
    if (!file || file.inBin) throw new ApiError('not_found');
    if (file.locked) throw new ApiError('already_locked');
    await client.query('UPDATE files SET locked = true WHERE id = $1', [id]);
    await recordLedger(client, { id: person.id, name: person.name }, 'locked', id, file.folderId, { fileName: file.name });
    return { folderId: file.folderId, fileId: id };
  });
  broadcast({ type: 'file_locked', data: { fileId: id, folderId: result.folderId, locked: true } });
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    sendJson(ctx.res, 200, { file: await serializeFile(client, person, file!) });
  } finally {
    client.release();
  }
}, { noBody: true });

route('DELETE', '/api/files/:id/lock', async (ctx) => {
  const person = requireController(ctx);
  const id = ctx.params['id']!;
  const result = await withTransaction(async (client) => {
    const file = await getFile(client, id);
    if (!file || file.inBin) throw new ApiError('not_found');
    if (!file.locked) throw new ApiError('not_locked');
    await client.query('UPDATE files SET locked = false WHERE id = $1', [id]);
    await recordLedger(client, { id: person.id, name: person.name }, 'unlocked', id, file.folderId, { fileName: file.name });
    return { folderId: file.folderId };
  });
  broadcast({ type: 'file_locked', data: { fileId: id, folderId: result.folderId, locked: false } });
  const client = await pool.connect();
  try {
    const file = await getFile(client, id);
    sendJson(ctx.res, 200, { file: await serializeFile(client, person, file!) });
  } finally {
    client.release();
  }
}, { noBody: true });

route('POST', '/api/moves', async (ctx) => {
  await handleMoveDirect(ctx, requireSession(ctx));
});

async function handleMoveDirect(ctx: RouteContext, person: Person): Promise<void> {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length >= 1 && key.length <= 100) {
    const existing = await pool.query<{ status: number; response: string; body: string; person_id: string }>(
      'SELECT status, response, body, person_id FROM idempotency WHERE key = $1', [key],
    );
    const row = existing.rows[0];
    if (row) {
      if (row['body'] !== JSON.stringify(ctx.body ?? {}) || row['person_id'] !== person.id) throw new ApiError('idempotency_key_reused');
      ctx.res.setHeader('Idempotent-Replayed', 'true');
      sendJson(ctx.res, row['status'], JSON.parse(row['response']));
      return;
    }
    const result = await handleMoveCompute(ctx, person);
    const status = 200;
    await pool.query(
      'INSERT INTO idempotency (key, person_id, path, body, status, response, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [key, person.id, '/api/moves', JSON.stringify(ctx.body ?? {}), status, JSON.stringify(result), toInstant(now())],
    );
    sendJson(ctx.res, status, result);
    return;
  }
  const result = await handleMoveCompute(ctx, person);
  sendJson(ctx.res, 200, result);
}

route('POST', '/api/uploads', async (ctx) => {
  const person = requireSession(ctx);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length >= 1 && key.length <= 100) {
    const existing = await pool.query<{ status: number; response: string; body: string; person_id: string }>(
      'SELECT status, response, body, person_id FROM idempotency WHERE key = $1', [key],
    );
    const row = existing.rows[0];
    if (row) {
      if (row['body'] !== JSON.stringify(ctx.body ?? {}) || row['person_id'] !== person.id) throw new ApiError('idempotency_key_reused');
      ctx.res.setHeader('Idempotent-Replayed', 'true');
      sendJson(ctx.res, row['status'], JSON.parse(row['response']));
      return;
    }
    const { status, body } = await uploadCreateWithBody(ctx, person);
    await pool.query(
      'INSERT INTO idempotency (key, person_id, path, body, status, response, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [key, person.id, '/api/uploads', JSON.stringify(ctx.body ?? {}), status, JSON.stringify(body), toInstant(now())],
    );
    sendJson(ctx.res, status, body);
    return;
  }
  const { status, body } = await uploadCreateWithBody(ctx, person);
  sendJson(ctx.res, status, body);
});

route('GET', '/api/uploads', listUploads, { noBody: true });
route('GET', '/api/uploads/:id', getUpload, { noBody: true });
route('PUT', '/api/uploads/:id/parts/:n', uploadPartHandler);
route('POST', '/api/uploads/:id/pause', pauseUpload, { noBody: true });
route('POST', '/api/uploads/:id/resume', resumeUpload, { noBody: true });
route('POST', '/api/uploads/:id/complete', completeUpload, { noBody: true });
route('DELETE', '/api/uploads/:id', deleteUpload, { noBody: true });

route('GET', '/api/storage', storageStats, { noBody: true });
route('GET', '/api/bin', listBin, { noBody: true });
route('POST', '/api/bin', binFiles);
route('POST', '/api/bin/:fileId/restore', restoreFile, { noBody: true });
route('DELETE', '/api/bin/:fileId', deleteForever, { noBody: true });

route('GET', '/api/grants', listGrants, { noBody: true });
route('POST', '/api/grants', createGrant);
route('PATCH', '/api/grants/:id', updateGrant);
route('DELETE', '/api/grants/:id', removeGrant, { noBody: true });
route('GET', '/api/grants/defaults', grantDefaults, { noBody: true });
route('GET', '/api/shared', sharedItems, { noBody: true });

route('GET', '/api/policies', listPolicies, { noBody: true });
route('POST', '/api/policies', schedulePolicy);
route('DELETE', '/api/policies/:id', withdrawPolicy, { noBody: true });

route('GET', '/api/handovers', listHandovers, { noBody: true });
route('POST', '/api/handovers', offerHandover);
route('POST', '/api/handovers/:id/accept', (ctx) => decideHandover(ctx, 'accepted'), { noBody: true });
route('POST', '/api/handovers/:id/decline', (ctx) => decideHandover(ctx, 'declined'), { noBody: true });

export { routes };
