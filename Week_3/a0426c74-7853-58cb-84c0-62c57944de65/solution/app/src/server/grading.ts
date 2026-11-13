// The grading routes (seed, session, view, clock, operation batch, storage). They exist only when PLOT_GRADING is 1;
// otherwise the paths are simply unknown and answer `not_found` like any other.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { parseDrawingSeed, parseOperationGroup, seedDrawing, type SeedRecord } from '../shared/model/index.ts';
import { isRole, MINIMUM_ROLE } from '../shared/rules.ts';
import type { Role, Xref } from '../shared/types.ts';
import { hashPassword, isUsername, normalizeUsername, requireUser, startSession } from './auth.ts';
import { objectBody, stringField } from './body.ts';
import { clock, LAST_INSTANT_MS } from './clock.ts';
import { config } from './config.ts';
import { db, isUniqueViolation } from './db.ts';
import { createDrawing, getDrawing } from './drawings.ts';
import { submitGroup } from './ops.ts';
import { runSeedSteps, type SeedOutput } from './registry.ts';
import { drawingAccess, requireRole } from './roles.ts';
import { route } from './router.ts';
import { s3 } from './s3.ts';
import { scheduler } from './scheduler.ts';
import { lastPublishedModel } from './versions.ts';

interface SeedFolder { key: string; name: string; parent: string | null; roles: Array<{ username: string; role: Role }> }
interface SeedDrawingEntry { key: string; folder: string; name: string; sheets: unknown; record: SeedRecord }

function listField(body: Record<string, unknown>, name: string): unknown[] {
  const value = body[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw fieldError(name, copy.invalidValue(name));
  return value;
}

function parseFolder(raw: unknown): SeedFolder {
  const body = objectBody(raw);
  const roles = objectBody(body.roles ?? {});
  return {
    key: stringField(body, 'key'),
    name: stringField(body, 'name'),
    parent: typeof body.parent === 'string' ? body.parent : null,
    roles: Object.entries(roles).map(([username, role]) => {
      if (!isRole(role)) throw fieldError('roles', copy.ROLE_NAME);
      return { username: normalizeUsername(username), role };
    }),
  };
}

function parseDrawing(raw: unknown): SeedDrawingEntry {
  const body = objectBody(raw);
  return { key: stringField(body, 'key'), folder: stringField(body, 'folder'), name: stringField(body, 'name'), sheets: body.sheets, record: parseDrawingSeed(body) };
}

/** Parents before children, so every folder's parent exists when it is inserted. */
function foldersInOrder(folders: SeedFolder[]): SeedFolder[] {
  const placed = new Set<string>();
  const ordered: SeedFolder[] = [];
  for (let pending = folders; pending.length > 0;) {
    const ready = pending.filter((folder) => folder.parent === null || placed.has(folder.parent));
    if (ready.length === 0) throw fieldError('folders', copy.invalidValue('folders'));
    for (const folder of ready) placed.add(folder.key);
    ordered.push(...ready);
    pending = pending.filter((folder) => !ready.includes(folder));
  }
  return ordered;
}

/** Sources of xrefs before the drawings that attach them, so each source's versions exist when its host is built. */
function drawingsInOrder(drawings: SeedDrawingEntry[]): SeedDrawingEntry[] {
  const byKey = new Map(drawings.map((drawing) => [drawing.key, drawing]));
  const ordered: SeedDrawingEntry[] = [];
  const visiting = new Set<string>();
  const visit = (drawing: SeedDrawingEntry): void => {
    if (ordered.includes(drawing)) return;
    if (visiting.has(drawing.key)) throw fieldError('drawings', copy.invalidValue('drawings'));
    visiting.add(drawing.key);
    for (const xref of drawing.record.xrefs) {
      const source = byKey.get(xref.source);
      if (source) visit(source);
    }
    visiting.delete(drawing.key);
    ordered.push(drawing);
  };
  drawings.forEach(visit);
  return ordered;
}

async function seedUsers(users: unknown[]): Promise<string[]> {
  const entries = users.map((raw) => {
    const body = objectBody(raw);
    return { username: normalizeUsername(stringField(body, 'username')), password: stringField(body, 'password') };
  });
  for (const { username } of entries) if (!isUsername(username)) throw fieldError('username', copy.BAD_USERNAME);
  const hashes = await Promise.all(entries.map((entry) => hashPassword(entry.password)));
  try {
    await db.tx(async (q) => {
      for (const [i, { username }] of entries.entries()) await q.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hashes[i]]);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError('username_taken', copy.USERNAME_TAKEN);
    throw error;
  }
  return entries.map((entry) => entry.username);
}

async function seedFolders(folders: SeedFolder[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  await db.tx(async (q) => {
    for (const folder of foldersInOrder(folders)) {
      ids[folder.key] = randomUUID();
      await q.query('INSERT INTO folders (id, name, parent_id) VALUES ($1, $2, $3)', [ids[folder.key], folder.name, folder.parent === null ? null : ids[folder.parent]]);
      for (const { username, role } of folder.roles) {
        await q.query('INSERT INTO folder_roles (folder_id, username, role) VALUES ($1, $2, $3)', [ids[folder.key], username, role]);
      }
    }
  });
  return ids;
}

async function seedDrawings(entries: SeedDrawingEntry[], folderIds: Record<string, string>, output: SeedOutput): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const entry of drawingsInOrder(entries)) {
    const folderId = folderIds[entry.folder];
    if (folderId === undefined) throw fieldError('folder', copy.invalidValue('folder'));
    const xrefs: Xref[] = [];
    for (const xref of entry.record.xrefs) {
      const source = await lastPublishedModel(ids[xref.source]);
      xrefs.push({ ...xref, source: ids[xref.source], version_id: source.version_id, model: source.model });
    }
    const drawing = await createDrawing(folderId, entry.name, seedDrawing({ ...entry.record, xrefs }));
    ids[entry.key] = drawing.id;
    await runSeedSteps({ key: entry.key, id: drawing.id, folderId, name: entry.name, sheets: entry.sheets }, output);
  }
  return ids;
}

if (config.grading) {
  route('POST', '/api/grading/seed', async (ctx) => {
    const body = objectBody(ctx.json());
    const folders = listField(body, 'folders').map(parseFolder);
    const drawings = listField(body, 'drawings').map(parseDrawing);
    const output: SeedOutput = { sheets: {}, versions: {}, issues: {}, rfis: {}, links: {} };
    const users = await seedUsers(listField(body, 'users'));
    const folderIds = await seedFolders(folders);
    const drawingIds = await seedDrawings(drawings, folderIds, output);
    return ctx.reply(201, { users, folders: folderIds, drawings: drawingIds, ...output });
  }, { access: 'public' });

  route('POST', '/api/grading/session', async (ctx) => {
    const username = normalizeUsername(stringField(objectBody(ctx.json()), 'username'));
    if ((await db.query('SELECT 1 FROM users WHERE username = $1', [username])).length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
    return ctx.reply(200, { username }, { 'set-cookie': await startSession(username) });
  }, { access: 'public' });

  route('POST', '/api/grading/view', async (ctx) => {
    const user = requireUser(ctx);
    const body = objectBody(ctx.json());
    const [zoom, panX, panY] = ['zoom', 'pan_x', 'pan_y'].map((name) => {
      const value = body[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw fieldError(name, copy.invalidValue(name));
      return value;
    });
    const drawing = await getDrawing(stringField(body, 'drawing'));
    await db.query(
      `INSERT INTO drawing_views (token_hash, drawing_id, zoom, pan_x, pan_y) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token_hash, drawing_id) DO UPDATE SET zoom = EXCLUDED.zoom, pan_x = EXCLUDED.pan_x, pan_y = EXCLUDED.pan_y`,
      [user.session, drawing.id, zoom, panX, panY],
    );
    return ctx.reply(204);
  });

  route('POST', '/api/grading/clock', async (ctx) => {
    const advance = objectBody(ctx.json()).advance_ms;
    const movable = typeof advance === 'number' && Number.isFinite(advance) && advance >= 0 && clock.now() + advance <= LAST_INSTANT_MS;
    if (!movable) throw fieldError('advance_ms', copy.invalidValue('advance_ms'));
    clock.advance(advance);
    await scheduler.runDue();
    return ctx.reply(200, { now: clock.iso() });
  }, { access: 'public' });

  route('POST', '/api/grading/drawings/:id/ops', async (ctx) => {
    const { as, ...rest } = objectBody(ctx.json());
    const username = normalizeUsername(typeof as === 'string' ? as : '');
    const access = await drawingAccess(username, ctx.params.id);
    if (!access) throw new ApiError('not_found', copy.NOT_FOUND);
    requireRole(access.role, MINIMUM_ROLE.editDrawing);
    const group = parseOperationGroup({ command: 'EDIT', group_id: randomUUID(), ...rest });
    return ctx.reply(200, await submitGroup(await getDrawing(ctx.params.id), username, group));
  }, { access: 'public' });

  route('POST', '/api/grading/storage', async (ctx) => {
    const down = objectBody(ctx.json()).down;
    if (typeof down !== 'boolean') throw fieldError('down', copy.invalidValue('down'));
    s3.setDown(down);
    return ctx.reply(200, { down });
  }, { access: 'public' });
}
