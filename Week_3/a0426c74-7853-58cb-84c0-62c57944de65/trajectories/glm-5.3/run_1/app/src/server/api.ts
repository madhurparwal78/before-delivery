import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { configFromEnv, type AppConfig } from './config.js';
import { applySchema, createSession, dropSession, hashPassword, roleForDrawing, roleForFolder, sessionUser, verifyPassword, USERNAME_RE, foldersForUser, recordLoginAttempt, loginAttempts, roleAtLeast, type Role } from './auth.js';
import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { Router, JSON_LIMIT, originMismatch, parseCookies, readBody, sendJson, writeError, type RequestContext } from './http.js';
import { liveHub } from './live.js';
import { makeStorage, setStorageDown, sha256, type Storage } from './storage.js';
import { s3ConfigFromEnv } from './s3core.js';
import { applyGroup, loadDrawing, saveModel, takeTopUndo, removeUndoRow } from './ops.js';
import { DrawingEngine, handleNumber } from './engine.js';
import { compareVersions, publishVersion, sheetById, stampsFor, stepsFor, versionById, versionsForSheet, viewportsForSheet } from './sheets.js';
import { parsePlotfold, planMerge, serialisePlotfold, type ParsedFile } from '../shared/format.js';
import { sheetSvg, entityToElement } from '../shared/svg.js';
import { SHEET_SIZES, TITLE_BLOCK_TAGS, type DrawingModel, type SheetRecord, type ViewportRecord } from '../shared/model.js';
import { randomId, formatStamp, formatUtc } from '../shared/num.js';
import { runSeed } from './seed.js';
import { requireUser, drawingRole, requireRole, validRole, ERROR_TEXT as GUARD_TEXT } from './guards.js';
import { offsetNow, applyDeadlines } from './clock.js';
import type { Entity, Pt, ResolvedEntity } from '../shared/geometry.js';

const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
const publicDir = join(serverRoot, 'public');
const config: AppConfig = configFromEnv();
const storage: Storage = makeStorage(s3ConfigFromEnv());

function serverNow(): Date {
  return offsetNow();
}

const router = new Router();
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function indexDocument(): string {
  return readFileSync(join(publicDir, 'index.html'), 'utf8');
}

function sendHtml(response: http.ServerResponse, html: string, status = 200): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plotfold</title><link rel="stylesheet" href="/app.css"></head><body data-page="not-available"><main class="surface note"><h1 class="title">Not available</h1><p>We couldn\u2019t find that page.</p></main><script src="/app.js" type="module"></script></body></html>`;
}

function serveStatic(response: http.ServerResponse, path: string): boolean {
  const clean = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const protectedPrefixes = ['/src', '/dist/server', '/scripts', '/node_modules', '/tsconfig'];
  const protectedFiles = ['/package.json', '/package-lock.json', '/run.json', '/THIRD_PARTY_NOTICES.md', '/.env'];
  if (clean === '/' || clean === '') {
    sendHtml(response, indexDocument());
    return true;
  }
  if (protectedFiles.includes(clean) || protectedPrefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`))) {
    return false;
  }
  const target = join(publicDir, clean);
  if (!target.startsWith(publicDir + '/') && target !== publicDir) return false;
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  const body = readFileSync(target);
  const type = contentTypes[extname(target)] ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
  return true;
}

interface OpBody {
  base_revision: number;
  group_id: string;
  command: string;
  ops: Array<{ op_id: string; type: string } & Record<string, unknown>>;
}

const resolvedModel = (engine: DrawingEngine): Record<string, ResolvedEntity> => {
  const entities: Record<string, ResolvedEntity> = {};
  for (const handle of engine.model.order) {
    const entity = engine.model.entities[handle];
    if (entity) entities[handle] = entity as ResolvedEntity;
  }
  return entities;
};

async function sheetPayload(engine: DrawingEngine, sheet: SheetRecord & { viewports: ViewportRecord[] }) {
  void engine;
  return { id: sheet.id, name: sheet.name, size: sheet.size, number: sheet.number, locked: sheet.locked, locked_by: sheet.locked_by, created_by: sheet.created_by, attributes: sheet.attributes, viewports: sheet.viewports };
}

async function loadSheets(drawingId: string) {
  const rows = await pool.query('SELECT id, drawing_id, name, size, number, locked, locked_by, created_by, attributes FROM sheets WHERE drawing_id = $1 ORDER BY number ASC', [drawingId]);
  const sheets: Array<Record<string, unknown>> = [];
  for (const row of rows.rows) {
    sheets.push({
      id: row.id,
      name: row.name,
      size: row.size,
      number: row.number,
      locked: row.locked,
      locked_by: row.locked_by,
      created_by: row.created_by,
      attributes: row.attributes ?? {},
      viewports: await viewportsForSheet(row.id),
    });
  }
  return sheets;
}

function requireSheetRole(sheetId: string, username: string): Promise<{ drawingId: string; role: Role }> {
  return (async () => {
    const sheet = await sheetById(sheetId);
    if (!sheet) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
    const role = await roleForDrawing(sheet.drawing_id, username);
    if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
    return { drawingId: sheet.drawing_id, role };
  })();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

router.add('POST', '/api/auth/register', async (context) => {
  const body = (context.body ?? {}) as { username?: unknown; password?: unknown };
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const fields: Record<string, string> = {};
  if (!USERNAME_RE.test(username)) fields.username = ERROR_TEXT.badUsername;
  if (password.length < 8) fields.password = ERROR_TEXT.shortPassword;
  if (Object.keys(fields).length) throw new ApiError('invalid', 'Check the form and try again.', { fields });
  const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
  if (existing.rows[0]) throw new ApiError('username_taken', ERROR_TEXT.usernameTaken);
  await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hashPassword(password)]);
  const token = await createSession(username);
  sendJson(context.response, 201, { username }, { 'set-cookie': `plot_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
  return undefined;
});

router.add('POST', '/api/auth/login', async (context) => {
  const body = (context.body ?? {}) as { username?: unknown; password?: unknown };
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const attempts = await loginAttempts(username, config.loginRate, 60000, serverNow());
  if (attempts >= config.loginRate) throw new ApiError('rate_limited', ERROR_TEXT.loginRate);
  const result = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE username = $1', [username]);
  const stored = result.rows[0]?.password_hash;
  if (!stored || !verifyPassword(password, stored)) {
    await recordLoginAttempt(username, false, serverNow());
    throw new ApiError('unauthenticated', ERROR_TEXT.wrongCredentials);
  }
  await recordLoginAttempt(username, true, serverNow());
  const token = await createSession(username);
  sendJson(context.response, 200, { username }, { 'set-cookie': `plot_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
  return undefined;
});

router.add('POST', '/api/auth/logout', async (context) => {
  const token = context.cookies['plot_session'] ?? null;
  if (token) await dropSession(token);
  context.response.writeHead(204, { 'set-cookie': 'plot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  context.response.end();
  return undefined;
});

router.add('GET', '/api/me', async (context) => {
  const username = await requireUser(context);
  return { username };
});

// The page receives only the client-side settings it needs.
router.add('GET', '/api/client-settings', async () => {
  return {
    toast_ms: config.toastMs,
    dom_margin_px: config.domMarginPx,
    dom_ceiling: config.domCeiling,
  };
});

// ---------------------------------------------------------------------------
// Folders and drawings
// ---------------------------------------------------------------------------

router.add('GET', '/api/folders', async (context) => {
  const username = await requireUser(context);
  return { folders: await foldersForUser(username) };
});

router.add('POST', '/api/folders', async (context) => {
  const username = await requireUser(context);
  const body = (context.body ?? {}) as { name?: unknown; parent_id?: unknown };
  const name = String(body.name ?? '');
  if (!name) throw new ApiError('invalid', 'Give the folder a name.');
  const parentId = body.parent_id === null || body.parent_id === undefined || body.parent_id === '' ? null : String(body.parent_id);
  if (parentId) {
    const parentRole = await roleForFolder(parentId, username);
    if (!parentRole) throw new ApiError('not_found', 'We couldn\u2019t find that folder.');
    requireRole(parentRole, 'edit');
  }
  const id = randomId('f');
  await pool.query('INSERT INTO folders (id, name, parent_id, created_by) VALUES ($1,$2,$3,$4)', [id, name, parentId, username]);
  await pool.query('INSERT INTO folder_roles (folder_id, username, role) VALUES ($1,$2,$3) ON CONFLICT (folder_id, username) DO UPDATE SET role = $3', [id, username, 'manage']);
  return { id, name, parent_id: parentId, role: 'manage' };
});

router.add('PUT', '/api/folders/:id/roles/:username', async (context) => {
  const username = await requireUser(context);
  const folderId = context.params.id;
  const role = await roleForFolder(folderId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that folder.');
  requireRole(role, 'manage');
  const body = (context.body ?? {}) as { role?: unknown };
  const newRole = String(body.role ?? '');
  if (!validRole(newRole)) throw new ApiError('invalid', 'Pick a real role.');
  await pool.query('INSERT INTO folder_roles (folder_id, username, role) VALUES ($1,$2,$3) ON CONFLICT (folder_id, username) DO UPDATE SET role = $3', [folderId, context.params.username, newRole]);
  const drawings = await pool.query<{ id: string }>('SELECT id FROM drawings WHERE folder_id = $1', [folderId]);
  for (const drawing of drawings.rows) {
    liveHub.broadcast(drawing.id, 'role', { folder_id: folderId, username: context.params.username, role: newRole });
  }
  return { username: context.params.username, role: newRole, inherited: false };
});

router.add('DELETE', '/api/folders/:id/roles/:username', async (context) => {
  const username = await requireUser(context);
  const folderId = context.params.id;
  const role = await roleForFolder(folderId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that folder.');
  requireRole(role, 'manage');
  await pool.query('DELETE FROM folder_roles WHERE folder_id = $1 AND username = $2', [folderId, context.params.username]);
  const drawings = await pool.query<{ id: string }>('SELECT id FROM drawings WHERE folder_id = $1', [folderId]);
  for (const drawing of drawings.rows) {
    liveHub.broadcast(drawing.id, 'role', { folder_id: folderId, username: context.params.username, role: null });
  }
  context.response.writeHead(204);
  context.response.end();
  return undefined;
});

router.add('GET', '/api/folders/:id/drawings', async (context) => {
  const username = await requireUser(context);
  const folderId = context.params.id;
  const role = await roleForFolder(folderId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that folder.');
  const drawings = await pool.query<{ id: string; name: string }>('SELECT id, name FROM drawings WHERE folder_id = $1 ORDER BY created_at ASC, id ASC', [folderId]);
  const result = [];
  for (const drawing of drawings.rows) {
    const sheetRows = await pool.query<{ id: string; name: string }>('SELECT id, name FROM sheets WHERE drawing_id = $1 ORDER BY number ASC', [drawing.id]);
    const sheetList = [];
    for (const sheet of sheetRows.rows) {
      const versions = await versionsForSheet(sheet.id);
      sheetList.push({ id: sheet.id, name: sheet.name, versions: versions.map((v) => ({ id: v.id, number: v.number, state: v.state })) });
    }
    result.push({ id: drawing.id, name: drawing.name, sheets: sheetList });
  }
  return { drawings: result };
});

router.add('POST', '/api/folders/:id/drawings', async (context) => {
  const username = await requireUser(context);
  const folderId = context.params.id;
  const role = await roleForFolder(folderId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that folder.');
  requireRole(role, 'edit');
  const body = (context.body ?? {}) as { name?: unknown };
  const name = String(body.name ?? '');
  if (!name) throw new ApiError('invalid', 'Give the drawing a name.');
  const id = randomId('d');
  await pool.query('INSERT INTO drawings (id, folder_id, name, created_by) VALUES ($1,$2,$3,$4)', [id, folderId, name, username]);
  const fresh = await loadDrawing(id);
  const engine = fresh?.engine;
  if (!engine) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  await saveModel(id, engine, 0);
  return { id, name, revision: 0 };
});

router.add('GET', '/api/drawings/:id', async (context) => {
  const { role } = await drawingRole(context, context.params.id);
  const loaded = await loadDrawing(context.params.id);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  const { engine, row } = loaded;
  engine.refreshAssociations();
  const underlays = await pool.query('SELECT id, key, bytes, x1, y1, x2, y2 FROM underlays WHERE drawing_id = $1', [row.id]);
  return {
    id: row.id,
    name: row.name,
    folder_id: row.folder_id,
    role,
    revision: row.revision,
    next_handle: engine.nextHandle,
    layers: engine.model.layers,
    entities: resolvedModel(engine),
    blocks: engine.model.blocks,
    dim_styles: engine.model.dim_styles,
    parameters: engine.model.parameters,
    constraints: engine.model.constraints,
    xrefs: engine.model.xrefs,
    layer_states: engine.model.layer_states,
    current_layer: engine.model.current_layer,
    underlays: underlays.rows,
    sheets: await loadSheets(row.id),
  };
});

router.add('GET', '/api/drawings/:id/entities/:handle/history', async (context) => {
  await drawingRole(context, context.params.id);
  const rows = await pool.query<{ revision: string; username: string; command: string; at: Date }>(
    'SELECT revision, username, command, at FROM entity_history WHERE drawing_id = $1 AND handle = $2 ORDER BY revision DESC, at DESC',
    [context.params.id, context.params.handle],
  );
  return { history: rows.rows.map((row) => ({ revision: Number(row.revision), username: row.username, command: row.command, at: formatUtc(row.at) })) };
});

// ---------------------------------------------------------------------------
// Operations, undo and redo
// ---------------------------------------------------------------------------

interface OpGroupResult {
  revision: number;
  results: Array<{ op_id: string; status: string; handles: string[]; message: string | null }>;
}

async function applyOperationGroup(
  drawingId: string,
  username: string,
  body: OpBody,
  options: { command?: string; groupId?: string },
): Promise<OpGroupResult> {
  const now = serverNow();
  const applied = await applyGroup(
    {
      drawingId,
      username,
      command: options.command ?? String(body.command ?? 'EDIT'),
      groupId: options.groupId ?? String(body.group_id ?? randomId('g')),
      baseRevision: Number(body.base_revision ?? 0),
      ops: body.ops,
    },
    { opWindow: config.opWindow, opRate: config.opRate, undoDepth: config.undoDepth, now },
  );
  liveHub.broadcast(drawingId, 'ops', {
    revision: applied.revision,
    group_id: applied.groupId,
    command: applied.command,
    author: applied.author,
    results: applied.results,
    ops: body.ops,
  });
  for (const notice of applied.notices) {
    const target = notice.recipient ?? applied.author;
    liveHub.notice(drawingId, target, notice.text);
  }
  return { revision: applied.revision, results: applied.results };
}

router.add('POST', '/api/drawings/:id/ops', async (context) => {
  const { username, role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  const body = (context.body ?? {}) as unknown as OpBody;
  return applyOperationGroup(context.params.id, username, body, {});
});

async function undoOrRedo(drawingId: string, username: string, kind: 'undo' | 'redo'): Promise<{ revision: number; command: string }> {
  const loaded = await loadDrawing(drawingId);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  // A superseded group is skipped and dropped; the next undo takes the one before it.
  for (;;) {
    const target = await takeTopUndo(drawingId, username, kind);
    if (!target) throw new ApiError(kind === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo', kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
    const payload = (typeof target.payload === 'string' ? JSON.parse(target.payload) : target.payload) as { before: DrawingModel; after: DrawingModel; command: string };
    const supersededBy = await findSuperseder(drawingId, payload, target.at, username);
    if (supersededBy) {
      await removeUndoRow(drawingId, username, kind, target.group_id);
      throw new ApiError('undo_superseded', `Can't undo: ${supersededBy}`);
    }
    const snapshot = structuredClone(kind === 'undo' ? payload.before : payload.after);
    const engine = new DrawingEngine(snapshot, loaded.engine.nextHandle);
    engine.refreshAssociations();
    const revision = loaded.row.revision + 1;
    await saveModel(drawingId, engine, revision);
    const command = payload.command;
    await pool.query(
      'INSERT INTO operations (drawing_id, op_id, group_id, command, author, base_revision, revision, payload, result, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [drawingId, randomId('op'), randomId('g'), kind === 'undo' ? `Undo: ${command}` : `Redo: ${command}`, username, loaded.row.revision, revision, JSON.stringify({}), JSON.stringify({ op_id: '', status: 'applied', handles: [], message: null }), serverNow()],
    );
    await removeUndoRow(drawingId, username, kind, target.group_id);
    await pool.query('INSERT INTO undo_stack (drawing_id, username, kind, group_id, command, payload, at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      drawingId,
      username,
      kind === 'undo' ? 'redo' : 'undo',
      target.group_id,
      command,
      JSON.stringify(payload),
      serverNow(),
    ]);
    liveHub.broadcast(drawingId, 'ops', {
      revision,
      group_id: randomId('g'),
      command: kind === 'undo' ? `Undo: ${command}` : `Redo: ${command}`,
      author: username,
      results: [{ op_id: '', status: 'applied', handles: [], message: null }],
      ops: [],
    });
    return { revision, command };
  }
}

// Someone else changed a target of this group since it was made: skip it.
async function findSuperseder(drawingId: string, payload: { before: DrawingModel; after: DrawingModel }, at: Date, username: string): Promise<string | null> {
  const handles = new Set([...Object.keys(payload.after.entities ?? {})]);
  if (!handles.size) return null;
  const rows = await pool.query<{ username: string; handle: string }>(
    'SELECT username, handle FROM entity_history WHERE drawing_id = $1 AND handle = ANY($2) AND username <> $3 AND at > $4 ORDER BY at DESC LIMIT 1',
    [drawingId, [...handles], username, at],
  );
  const row = rows.rows[0];
  return row ? `${row.username} changed ${row.handle} after you.` : null;
}

router.add('POST', '/api/drawings/:id/undo', async (context) => {
  const { username, role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  return undoOrRedo(context.params.id, username, 'undo');
});

router.add('POST', '/api/drawings/:id/redo', async (context) => {
  const { username, role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  return undoOrRedo(context.params.id, username, 'redo');
});

export {
  router,
  config,
  storage,
  serverNow,
  setStorageDown,
  liveHub,
  sha256,
  readBody,
  JSON_LIMIT,
  originMismatch,
  parseCookies,
  writeError,
  sendJson,
  serveStatic,
  sendHtml,
  notFoundHtml,
  indexDocument,
  drawingRole,
  requireRole,
  requireUser,
  runSeed,
  applySchema,
  sessionUser,
  sheetById,
  versionsForSheet,
  versionById,
  compareVersions,
  publishVersion,
  stampsFor,
  stepsFor,
  viewportsForSheet,
  parsePlotfold,
  planMerge,
  serialisePlotfold,
  entityToElement,
  sheetSvg,
  SHEET_SIZES,
  TITLE_BLOCK_TAGS,
  DrawingEngine,
  loadDrawing,
  saveModel,
  takeTopUndo,
  removeUndoRow,
  handleNumber,
  formatStamp,
  formatUtc,
  randomId,
  requireSheetRole,
  applyOperationGroup,
  resolvedModel,
  loadSheets,
  contentTypes,
  publicDir,
  type OpBody,
};
export type { Role, DrawingModel, SheetRecord, ViewportRecord, Entity, Pt, ResolvedEntity, ParsedFile, RequestContext };
