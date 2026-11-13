import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { router, config, storage, serverNow, liveHub, sha256, requireUser, drawingRole, requireRole, versionById, parsePlotfold, planMerge, serialisePlotfold, entityToElement, sheetSvg, randomId, formatUtc, loadDrawing, saveModel, DrawingEngine, applyOperationGroup, requireSheetRole, resolvedModel } from './api.js';
import { roleForDrawing } from './auth.js';
import type { SheetSnapshot } from './sheets.js';
import type { Entity, ResolvedEntity } from '../shared/geometry.js';
import { serialisePlotfold as toPlotText } from '../shared/format.js';

// ---------------------------------------------------------------------------
// Issues, RFIs, uploads, imports and exports.
// ---------------------------------------------------------------------------

const ISSUE_TRANSITIONS: Record<string, string[]> = {
  open: ['answered'],
  answered: ['closed'],
  closed: ['open'],
};

const RFI_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent'],
  sent: ['answered'],
  answered: ['closed', 'sent'],
};

router.add('POST', '/api/versions/:id/issues', async (context) => {
  const username = await requireUser(context);
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  requireRole(role, 'markup');
  const body = (context.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? '');
  if (!title) throw new ApiError('invalid', 'Give the issue a title.');
  const issue = {
    id: randomId('i'),
    version_id: version.id,
    drawing_id: version.drawing_id,
    title,
    x: Number(body.x ?? 0),
    y: Number(body.y ?? 0),
    state: 'open',
    creator: username,
  };
  await pool.query('INSERT INTO issues (id, version_id, drawing_id, title, x, y, state, creator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    issue.id, issue.version_id, issue.drawing_id, issue.title, issue.x, issue.y, issue.state, issue.creator,
  ]);
  liveHub.broadcast(version.drawing_id, 'issue', { ...issue, rfi_ids: [] });
  return issue;
});

router.add('GET', '/api/drawings/:id/issues', async (context) => {
  const { role } = await drawingRole(context, context.params.id);
  void role;
  const rows = await pool.query('SELECT id, version_id, drawing_id, title, x, y, state, creator FROM issues WHERE drawing_id = $1 ORDER BY created_at ASC', [context.params.id]);
  const issues = [];
  for (const row of rows.rows) {
    const rfiRows = await pool.query<{ id: string }>('SELECT id FROM rfis WHERE issue_id = $1 ORDER BY created_at ASC', [row.id]);
    issues.push({ ...row, rfi_ids: rfiRows.rows.map((r) => r.id) });
  }
  return { issues };
});

router.add('POST', '/api/issues/:id/transitions', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ id: string; version_id: string; drawing_id: string; title: string; x: number; y: number; state: string; creator: string }>(
    'SELECT id, version_id, drawing_id, title, x, y, state, creator FROM issues WHERE id = $1',
    [context.params.id],
  );
  const issue = row.rows[0];
  if (!issue) throw new ApiError('not_found', 'We couldn\u2019t find that issue.');
  const role = await roleForDrawing(issue.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that issue.');
  const body = (context.body ?? {}) as { to?: unknown };
  const to = String(body.to ?? '');
  const allowed = ISSUE_TRANSITIONS[issue.state] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError('illegal_transition', ERROR_TEXT.issueTransition(issue.state, to));
  }
  if (to === 'open') {
    if (!role || (role !== 'manage' && issue.creator !== username)) {
      throw new ApiError('forbidden', 'Only the issue\u2019s creator or a manager may reopen it.');
    }
  }
  if (to === 'closed') {
    const open = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM rfis WHERE issue_id = $1 AND state <> 'closed'", [issue.id]);
    if (Number(open.rows[0]?.count ?? 0) > 0) throw new ApiError('rfi_open', ERROR_TEXT.rfiOpen);
  }
  await pool.query('UPDATE issues SET state = $2 WHERE id = $1', [issue.id, to]);
  const updated = { ...issue, state: to };
  liveHub.broadcast(issue.drawing_id, 'issue', { ...updated, rfi_ids: await rfiIds(issue.id) });
  return updated;
});

async function rfiIds(issueId: string): Promise<string[]> {
  const rows = await pool.query<{ id: string }>('SELECT id FROM rfis WHERE issue_id = $1 ORDER BY created_at ASC', [issueId]);
  return rows.rows.map((r) => r.id);
}

router.add('POST', '/api/issues/:id/rfis', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ version_id: string; drawing_id: string }>('SELECT version_id, drawing_id FROM issues WHERE id = $1', [context.params.id]);
  const issue = row.rows[0];
  if (!issue) throw new ApiError('not_found', 'We couldn\u2019t find that issue.');
  const role = await roleForDrawing(issue.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that issue.');
  requireRole(role, 'markup');
  const body = (context.body ?? {}) as Record<string, unknown>;
  const question = String(body.question ?? '');
  const addressee = String(body.addressee ?? '');
  if (!question) throw new ApiError('invalid', 'Ask a question.');
  if (!addressee) throw new ApiError('invalid', 'Pick an addressee.');
  const id = randomId('r');
  const rfi = {
    id,
    issue_id: issue.version_id ? context.params.id : context.params.id,
    question,
    answer: null as string | null,
    asker: username,
    addressee,
    state: 'draft',
    ball_in_court: username,
  };
  await pool.query('INSERT INTO rfis (id, issue_id, question, asker, addressee, state, ball_in_court) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    rfi.id, rfi.issue_id, rfi.question, rfi.asker, rfi.addressee, rfi.state, rfi.ball_in_court,
  ]);
  liveHub.broadcast(issue.drawing_id, 'rfi', rfi);
  return rfi;
});

router.add('POST', '/api/rfis/:id/transitions', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ id: string; issue_id: string; question: string; answer: string | null; asker: string; addressee: string; state: string; ball_in_court: string }>(
    'SELECT id, issue_id, question, answer, asker, addressee, state, ball_in_court FROM rfis WHERE id = $1',
    [context.params.id],
  );
  const rfi = row.rows[0];
  if (!rfi) throw new ApiError('not_found', 'We couldn\u2019t find that RFI.');
  const issueRow = await pool.query<{ drawing_id: string }>('SELECT drawing_id FROM issues WHERE id = $1', [rfi.issue_id]);
  const drawingId = issueRow.rows[0]?.drawing_id;
  if (!drawingId) throw new ApiError('not_found', 'We couldn\u2019t find that RFI.');
  const role = await roleForDrawing(drawingId, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that RFI.');
  const body = (context.body ?? {}) as { to?: unknown; answer?: unknown };
  const to = String(body.to ?? '');
  const allowed = RFI_TRANSITIONS[rfi.state] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiError('illegal_transition', ERROR_TEXT.rfiTransition(rfi.state, to));
  }
  if (rfi.ball_in_court !== username) {
    throw new ApiError('not_ball_in_court', ERROR_TEXT.notBallInCourt(rfi.ball_in_court));
  }
  let answer = rfi.answer;
  if (to === 'answered') {
    const given = body.answer === undefined || body.answer === null ? '' : String(body.answer);
    if (!given) throw new ApiError('invalid', 'Give an answer.');
    answer = given;
  }
  const ballInCourt = to === 'sent' ? rfi.addressee : to === 'answered' ? rfi.asker : rfi.ball_in_court;
  await pool.query('UPDATE rfis SET state = $2, ball_in_court = $3, answer = $4 WHERE id = $1', [rfi.id, to, ballInCourt, answer]);
  const updated = { ...rfi, state: to, ball_in_court: ballInCourt, answer };
  liveHub.broadcast(drawingId, 'rfi', updated);
  return updated;
});

// ---------------------------------------------------------------------------
// Underlays and imports
// ---------------------------------------------------------------------------

function imageType(bytes: Buffer): 'png' | 'jpg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

router.add('POST', '/api/drawings/:id/underlays', async (context) => {
  const username = await requireUser(context);
  const { role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  const bytes = context.rawBody ?? Buffer.alloc(0);
  if (bytes.length > config.underlayMaxBytes) {
    throw new ApiError('too_large', ERROR_TEXT.underlayTooLarge(config.underlayMaxBytes));
  }
  const type = imageType(bytes);
  if (!type) throw new ApiError('wrong_type', ERROR_TEXT.underlayType);
  const digest = sha256(bytes);
  const existing = await pool.query<{ id: string; key: string; bytes: string; x1: number; y1: number; x2: number; y2: number }>(
    'SELECT id, key, bytes, x1, y1, x2, y2 FROM underlays WHERE drawing_id = $1 AND sha256 = $2',
    [context.params.id, digest],
  );
  const query = context.query;
  const x1 = Number(query.get('x1') ?? 0);
  const y1 = Number(query.get('y1') ?? 0);
  const x2 = Number(query.get('x2') ?? 0);
  const y2 = Number(query.get('y2') ?? 0);
  if (existing.rows[0]) {
    return { ...existing.rows[0], bytes: Number(existing.rows[0].bytes) };
  }
  const totalRow = await pool.query<{ total: string }>('SELECT coalesce(sum(bytes),0)::text AS total FROM underlays WHERE drawing_id = $1', [context.params.id]);
  const total = Number(totalRow.rows[0]?.total ?? 0);
  if (total + bytes.length > config.drawingQuotaBytes) {
    throw new ApiError('quota_exceeded', ERROR_TEXT.underlayQuota(config.drawingQuotaBytes));
  }
  const id = randomId('u');
  const key = `underlays/${context.params.id}/${digest}.${type === 'png' ? 'png' : 'jpg'}`;
  try {
    await storage.put(key, bytes, type === 'png' ? 'image/png' : 'image/jpeg');
  } catch {
    throw new ApiError('storage_unavailable', ERROR_TEXT.storageDownUnderlay);
  }
  const record = { id, key, bytes: bytes.length, x1, y1, x2, y2 };
  await pool.query('INSERT INTO underlays (id, drawing_id, key, bytes, sha256, x1, y1, x2, y2, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    id, context.params.id, key, bytes.length, digest, x1, y1, x2, y2, username,
  ]);
  context.response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
  context.response.end(JSON.stringify(record));
  return undefined;
});

router.add('POST', '/api/drawings/:id/imports', async (context) => {
  const username = await requireUser(context);
  const { role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  const bytes = context.rawBody ?? Buffer.alloc(0);
  if (bytes.length > config.textMaxBytes) {
    throw new ApiError('too_large', ERROR_TEXT.textTooLarge(config.textMaxBytes));
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError('wrong_type', ERROR_TEXT.textType);
  }
  const firstLine = text.split('\n')[0] ?? '';
  if (firstLine.trim() !== 'plotfold 1') {
    throw new ApiError('wrong_type', ERROR_TEXT.textType);
  }
  const digest = sha256(bytes);
  const key = `imports/${context.params.id}/${digest}.plot.txt`;
  try {
    await storage.put(key, bytes, 'text/plain');
  } catch {
    throw new ApiError('storage_unavailable', ERROR_TEXT.storageDownImport);
  }
  const outcome = parsePlotfold(text);
  if (!outcome.parsed) {
    await pool.query('INSERT INTO imports (id, drawing_id, key, bytes, sha256, parsed, renames, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      randomId('imp'), context.params.id, key, bytes.length, digest, null, null, username,
    ]);
    throw new ApiError('parse_failed', 'That file has errors in it.', { lines: outcome.errors });
  }
  const parsed = outcome.parsed;
  const loaded = await loadDrawing(context.params.id);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  const plan = planMerge(parsed, Object.keys(loaded.engine.model.layers), Object.keys(loaded.engine.model.blocks));
  const importId = randomId('imp');
  await pool.query('INSERT INTO imports (id, drawing_id, key, bytes, sha256, parsed, renames, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    importId, context.params.id, key, bytes.length, digest, JSON.stringify(plan), JSON.stringify(plan.renames), username,
  ]);
  const response = {
    import_id: importId,
    key,
    adds: { entities: plan.entities.length, layers: plan.layers.length, blocks: plan.blocks.length },
    renames: plan.renames,
  };
  context.response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
  context.response.end(JSON.stringify(response));
  return undefined;
});

router.add('POST', '/api/drawings/:id/merge', async (context) => {
  const username = await requireUser(context);
  const { role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  const body = (context.body ?? {}) as { import_id?: unknown };
  const importId = String(body.import_id ?? '');
  const row = await pool.query<{ parsed: unknown | null; renames: unknown | null }>('SELECT parsed, renames FROM imports WHERE id = $1 AND drawing_id = $2', [importId, context.params.id]);
  const record = row.rows[0];
  if (!record) throw new ApiError('not_found', 'We couldn\u2019t find that import.');
  if (!record.parsed) throw new ApiError('invalid', 'That import has errors in it.');
  const plan = record.parsed as ReturnType<typeof planMerge>;
  const ops: Array<{ op_id: string; type: string } & Record<string, unknown>> = [];
  const opId = () => randomId('op');
  for (const layer of plan.layers) {
    ops.push({ op_id: opId(), type: 'layer_add', name: layer.name, colour: layer.colour, linetype: layer.linetype, lineweight: layer.lineweight, on: layer.on, frozen: layer.frozen, locked: layer.locked });
  }
  for (const block of plan.blocks) {
    ops.push({ op_id: opId(), type: 'block_define', name: block.name, base: block.base, handles: [], attributes: block.attributes, entities: block.entities });
  }
  for (const entity of plan.entities) {
    ops.push({ op_id: opId(), type: 'add', entity: { ...entity } });
  }
  const loaded = await loadDrawing(context.params.id);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  return applyOperationGroup(context.params.id, username, { base_revision: loaded.row.revision, group_id: randomId('g'), command: 'IMPORT', ops }, { command: 'IMPORT' });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

router.add('POST', '/api/drawings/:id/exports', async (context) => {
  const username = await requireUser(context);
  const { role } = await drawingRole(context, context.params.id);
  void role;
  const body = (context.body ?? {}) as { format?: unknown };
  const format = String(body.format ?? 'plot.txt');
  if (format !== 'plot.txt' && format !== 'svg') throw new ApiError('invalid', 'An export is Plotfold text or SVG.');
  const id = randomId('e');
  await pool.query('INSERT INTO exports (id, drawing_id, format, state, progress, step_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    id, context.params.id, format, 'queued', 0, serverNow(), username,
  ]);
  context.response.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
  context.response.end(JSON.stringify({ id, state: 'queued', progress: 0 }));
  return undefined;
});

router.add('GET', '/api/exports/:id', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ id: string; drawing_id: string; format: string; state: string; progress: string }>(
    'SELECT id, drawing_id, format, state, progress FROM exports WHERE id = $1',
    [context.params.id],
  );
  const job = row.rows[0];
  if (!job) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  const role = await roleForDrawing(job.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  return { id: job.id, format: job.format, state: job.state, progress: Number(job.progress), download_url: job.state === 'ready' ? `/api/exports/${job.id}/download` : null };
});

router.add('POST', '/api/exports/:id/retry', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ id: string; drawing_id: string; format: string; state: string }>('SELECT id, drawing_id, format, state FROM exports WHERE id = $1', [context.params.id]);
  const job = row.rows[0];
  if (!job) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  const role = await roleForDrawing(job.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  if (job.state !== 'failed') throw new ApiError('illegal_transition', ERROR_TEXT.versionTransition(job.state, 'running'));
  await pool.query('UPDATE exports SET state = $2, progress = 0, step_at = $3 WHERE id = $1', [job.id, 'running', serverNow()]);
  const fresh = await pool.query<{ id: string; format: string; state: string; progress: string }>('SELECT id, format, state, progress FROM exports WHERE id = $1', [job.id]);
  context.response.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
  context.response.end(JSON.stringify({ id: fresh.rows[0].id, format: fresh.rows[0].format, state: fresh.rows[0].state, progress: Number(fresh.rows[0].progress) }));
  return undefined;
});

router.add('GET', '/api/exports/:id/download', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ id: string; drawing_id: string; format: string; state: string; progress: string }>(
    'SELECT id, drawing_id, format, state, progress FROM exports WHERE id = $1',
    [context.params.id],
  );
  const job = row.rows[0];
  if (!job) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  const role = await roleForDrawing(job.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that export.');
  if (job.state !== 'ready') throw new ApiError('not_ready', 'That export is not ready yet.');
  const key = `exports/${job.drawing_id}/${job.id}.${job.format === 'svg' ? 'svg' : 'plot.txt'}`;
  const bytes = await storage.get(key);
  if (!bytes) throw new ApiError('storage_unavailable', ERROR_TEXT.exportFailed);
  context.response.writeHead(200, { 'content-type': job.format === 'svg' ? 'image/svg+xml' : 'text/plain; charset=utf-8' });
  context.response.end(bytes);
  return undefined;
});

export {};
