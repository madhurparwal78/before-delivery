import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { router, config, storage, serverNow, liveHub, sha256, sendJson, loadDrawing, saveModel, DrawingEngine, applyOperationGroup, resolvedModel, requireUser, drawingRole, requireRole, requireSheetRole, sheetById, versionsForSheet, versionById, viewportsForSheet, publishVersion, stampsFor, stepsFor, parsePlotfold, planMerge, serialisePlotfold, entityToElement, sheetSvg, SHEET_SIZES, randomId, formatStamp, formatUtc } from './api.js';
import { compareEntities, boxesMeet } from '../shared/derived.js';
import { entityBounds } from '../shared/geometry.js';
import type { Entity, ResolvedEntity } from '../shared/geometry.js';
import type { SheetSnapshot } from './sheets.js';
import { roleForDrawing } from './auth.js';

// ---------------------------------------------------------------------------
// Sheets, viewports, versions, review, markups, issues, RFIs, links, uploads
// and exports. One module, one place per rule.
// ---------------------------------------------------------------------------

interface OpBody {
  base_revision: number;
  group_id: string;
  command: string;
  ops: Array<{ op_id: string; type: string } & Record<string, unknown>>;
}

router.add('POST', '/api/drawings/:id/sheets', async (context) => {
  const username = await requireUser(context);
  const { role } = await drawingRole(context, context.params.id);
  requireRole(role, 'edit');
  const body = (context.body ?? {}) as { name?: unknown; size?: unknown };
  const name = String(body.name ?? '');
  const size = String(body.size ?? 'A3');
  if (!name) throw new ApiError('invalid', 'Give the sheet a name.');
  if (size !== 'A3' && size !== 'A4') throw new ApiError('invalid', 'A sheet is A3 or A4.');
  const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM sheets WHERE drawing_id = $1', [context.params.id]);
  const number = Number(count.rows[0]?.count ?? 0) + 1;
  const id = randomId('s');
  await pool.query('INSERT INTO sheets (id, drawing_id, name, size, number, locked, created_by, attributes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    id,
    context.params.id,
    name,
    size,
    number,
    false,
    username,
    JSON.stringify({}),
  ]);
  const sheet = await sheetById(id);
  return { ...sheet, viewports: [] };
});

router.add('PATCH', '/api/sheets/:id', async (context) => {
  const username = await requireUser(context);
  const { drawingId, role } = await requireSheetRole(context.params.id, username);
  const body = (context.body ?? {}) as { attributes?: Record<string, string>; locked?: boolean };
  const sheet = await sheetById(context.params.id);
  if (!sheet) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
  const locked = body.locked;
  if (locked !== undefined) {
    requireRole(role, 'manage');
    await pool.query('UPDATE sheets SET locked = $2, locked_by = $3 WHERE id = $1', [sheet.id, locked, locked ? username : null]);
    liveHub.broadcast(drawingId, 'version', { sheet_id: sheet.id, locked });
  }
  if (body.attributes !== undefined) {
    requireRole(role, 'edit');
    if (sheet.locked && sheet.locked_by !== username) {
      throw new ApiError('sheet_locked', ERROR_TEXT.sheetLocked(sheet.locked_by ?? ''));
    }
    const fresh = await sheetById(sheet.id);
    const updated = { ...((fresh?.attributes ?? {})), ...body.attributes };
    await pool.query('UPDATE sheets SET attributes = $2 WHERE id = $1', [sheet.id, JSON.stringify(updated)]);
  }
  const fresh = await sheetById(sheet.id);
  return { ...fresh, viewports: await viewportsForSheet(sheet.id) };
});

router.add('POST', '/api/sheets/:id/viewports', async (context) => {
  const username = await requireUser(context);
  const { role } = await requireSheetRole(context.params.id, username);
  requireRole(role, 'edit');
  const body = (context.body ?? {}) as Record<string, unknown>;
  const sheet = await sheetById(context.params.id);
  if (!sheet) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
  if (sheet.locked && sheet.locked_by !== username) {
    throw new ApiError('sheet_locked', ERROR_TEXT.sheetLocked(sheet.locked_by ?? ''));
  }
  const scale = String(body.scale ?? '1:1');
  if (!/^1:\d+$/.test(scale)) throw new ApiError('invalid', 'A viewport scale reads 1:n.');
  const id = randomId('vp');
  await pool.query(
    'INSERT INTO viewports (id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, sheet.id, Number(body.x ?? 0), Number(body.y ?? 0), Number(body.width ?? 100), Number(body.height ?? 100), scale, Number(body.view_x ?? 0), Number(body.view_y ?? 0), JSON.stringify((body.frozen_layers as string[] | undefined) ?? [])],
  );
  return {
    id,
    sheet_id: sheet.id,
    x: Number(body.x ?? 0),
    y: Number(body.y ?? 0),
    width: Number(body.width ?? 100),
    height: Number(body.height ?? 100),
    scale,
    view_x: Number(body.view_x ?? 0),
    view_y: Number(body.view_y ?? 0),
    frozen_layers: (body.frozen_layers as string[] | undefined) ?? [],
  };
});

router.add('PATCH', '/api/viewports/:id', async (context) => {
  const username = await requireUser(context);
  const existing = await pool.query<{ sheet_id: string; x: number; y: number; width: number; height: number; scale: string; view_x: number; view_y: number; frozen_layers: string[] }>(
    'SELECT sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers FROM viewports WHERE id = $1',
    [context.params.id],
  );
  const row = existing.rows[0];
  if (!row) throw new ApiError('not_found', 'We couldn\u2019t find that viewport.');
  const { role } = await requireSheetRole(row.sheet_id, username);
  requireRole(role, 'edit');
  const sheet = await sheetById(row.sheet_id);
  if (sheet?.locked && sheet.locked_by !== username) {
    throw new ApiError('sheet_locked', ERROR_TEXT.sheetLocked(sheet.locked_by ?? ''));
  }
  const body = (context.body ?? {}) as Record<string, unknown>;
  const next = {
    x: body.x === undefined ? row.x : Number(body.x),
    y: body.y === undefined ? row.y : Number(body.y),
    width: body.width === undefined ? row.width : Number(body.width),
    height: body.height === undefined ? row.height : Number(body.height),
    scale: body.scale === undefined ? row.scale : String(body.scale),
    view_x: body.view_x === undefined ? row.view_x : Number(body.view_x),
    view_y: body.view_y === undefined ? row.view_y : Number(body.view_y),
    frozen_layers: body.frozen_layers === undefined ? row.frozen_layers : (body.frozen_layers as string[]),
  };
  if (!/^1:\d+$/.test(next.scale)) throw new ApiError('invalid', 'A viewport scale reads 1:n.');
  await pool.query('UPDATE viewports SET x=$2,y=$3,width=$4,height=$5,scale=$6,view_x=$7,view_y=$8,frozen_layers=$9 WHERE id=$1', [
    context.params.id,
    next.x,
    next.y,
    next.width,
    next.height,
    next.scale,
    next.view_x,
    next.view_y,
    JSON.stringify(next.frozen_layers),
  ]);
  return { id: context.params.id, sheet_id: row.sheet_id, ...next };
});

router.add('POST', '/api/sheets/:id/versions', async (context) => {
  const username = await requireUser(context);
  const { drawingId, role } = await requireSheetRole(context.params.id, username);
  requireRole(role, 'edit');
  const sheet = await sheetById(context.params.id);
  if (!sheet) throw new ApiError('not_found', 'We couldn\u2019t find that sheet.');
  if (sheet.locked && sheet.locked_by !== username) {
    throw new ApiError('sheet_locked', ERROR_TEXT.sheetLocked(sheet.locked_by ?? ''));
  }
  const outcome = await publishVersion(sheet.id, username, storage, serverNow());
  liveHub.broadcast(drawingId, 'version', { version_id: outcome.version.id, sheet_id: sheet.id, number: outcome.version.number, state: 'published' });
  for (const drawing of [drawingId].concat(await xrefHosts(drawingId))) {
    liveHub.broadcast(drawing, 'xref_version', { source_drawing_id: drawingId });
  }
  return outcome.version;
});

async function xrefHosts(drawingId: string): Promise<string[]> {
  const rows = await pool.query<{ id: string }>('SELECT id FROM drawings');
  const hosts: string[] = [];
  for (const row of rows.rows) {
    const loaded = await loadDrawing(row.id);
    if (!loaded) continue;
    if (loaded.engine.model.xrefs.some((xref) => xref.source === drawingId)) hosts.push(row.id);
  }
  return hosts;
}

router.add('GET', '/api/sheets/:id/versions', async (context) => {
  const username = await requireUser(context);
  await requireSheetRole(context.params.id, username);
  const versions = await versionsForSheet(context.params.id);
  const result = [];
  for (const version of versions) {
    result.push({
      id: version.id,
      number: version.number,
      state: version.state,
      replaced_by: version.replaced_by,
      stamps: await stampsFor(version.id),
      steps: await stepsFor(version.id),
    });
  }
  return { versions: result };
});

router.add('GET', '/api/versions/:id', async (context) => {
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const username = context.username;
  if (username) {
    const role = await roleForDrawing(version.drawing_id, username);
    if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  }
  return {
    id: version.id,
    sheet_id: version.sheet_id,
    number: version.number,
    state: version.state,
    replaced_by: version.replaced_by,
    keys: version.keys,
    stamps: await stampsFor(version.id),
    steps: await stepsFor(version.id),
    snapshot: version.snapshot,
    published_at: version.published_at,
  };
});

router.add('GET', '/api/sheets/:id/compare', async (context) => {
  const username = await requireUser(context);
  await requireSheetRole(context.params.id, username);
  const from = Number(context.query.get('from') ?? 0);
  const to = Number(context.query.get('to') ?? 0);
  return compareVersions(context.params.id, from, to);
});

async function compareVersions(sheetId: string, fromNumber: number, toNumber: number) {
  const versions = await versionsForSheet(sheetId);
  const earlier = versions.find((v) => v.number === fromNumber);
  const later = versions.find((v) => v.number === toNumber);
  if (!earlier || !later) throw new ApiError('not_found', 'We couldn\u2019t find those versions.');
  return compareEntities(
    { entities: (earlier.snapshot?.model.entities ?? {}) as Record<string, Entity> },
    { entities: (later.snapshot?.model.entities ?? {}) as Record<string, Entity> },
  );
}

// ---------------------------------------------------------------------------
// Markups
// ---------------------------------------------------------------------------

router.add('POST', '/api/versions/:id/markups', async (context) => {
  const username = await requireUser(context);
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  requireRole(role, 'markup');
  const body = (context.body ?? {}) as Record<string, unknown>;
  const kind = String(body.kind ?? 'cloud');
  if (!['cloud', 'arrow', 'text'].includes(kind)) throw new ApiError('invalid', 'A markup is a cloud, arrow or text.');
  const id = randomId('mk');
  const markup = {
    id,
    version_id: version.id,
    kind,
    x1: Number(body.x1 ?? 0),
    y1: Number(body.y1 ?? 0),
    x2: Number(body.x2 ?? 0),
    y2: Number(body.y2 ?? 0),
    text: body.text === undefined || body.text === null ? null : String(body.text),
    flag: null as string | null,
    created_by: username,
  };
  await pool.query('INSERT INTO markups (id, version_id, kind, x1, y1, x2, y2, text, flag, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    markup.id, markup.version_id, markup.kind, markup.x1, markup.y1, markup.x2, markup.y2, markup.text, null, username,
  ]);
  liveHub.broadcast(version.drawing_id, 'markup', { ...markup, version_number: version.number });
  return { ...markup, flag: null };
});

router.add('GET', '/api/versions/:id/markups', async (context) => {
  const username = await requireUser(context);
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const rows = await pool.query('SELECT id, version_id, kind, x1, y1, x2, y2, text, flag, created_by FROM markups WHERE version_id = $1 ORDER BY created_at ASC', [version.id]);
  const markups = [];
  for (const row of rows.rows) {
    const flag = await markupFlag(row, version);
    markups.push({ ...row, flag });
  }
  return { markups };
});

async function markupFlag(markup: { kind: string; x1: number; y1: number; x2: number; y2: number }, version: { sheet_id: string; number: number }): Promise<string | null> {
  const versions = await versionsForSheet(version.sheet_id);
  const earlier = versions.find((v) => v.number === version.number - 1);
  const later = versions.find((v) => v.number === version.number);
  if (!earlier || !later) return null;
  const comparison = compareEntities(
    { entities: (earlier.snapshot?.model.entities ?? {}) as Record<string, Entity> },
    { entities: (later.snapshot?.model.entities ?? {}) as Record<string, Entity> },
  );
  if (comparison.added === 0 && comparison.removed === 0 && comparison.changed === 0) return null;
  const box = { minX: Math.min(markup.x1, markup.x2), minY: Math.min(markup.y1, markup.y2), maxX: Math.max(markup.x1, markup.x2), maxY: Math.max(markup.y1, markup.y2) };
  for (const entry of comparison.entities) {
    if (entry.diff === 'same') continue;
    const entity = ((later.snapshot?.model.entities ?? {}) as Record<string, ResolvedEntity>)[entry.id]
      ?? ((earlier.snapshot?.model.entities ?? {}) as Record<string, ResolvedEntity>)[entry.id];
    if (!entity) continue;
    if (boxesMeet(entityBounds(entity), box)) return 'geometry-changed';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review steps
// ---------------------------------------------------------------------------

router.add('POST', '/api/versions/:id/review', async (context) => {
  const username = await requireUser(context);
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  requireRole(role, 'edit');
  if (version.state !== 'published') {
    throw new ApiError('illegal_transition', ERROR_TEXT.versionTransition(version.state, 'in_review'));
  }
  const dueAt = new Date(serverNow().getTime() + config.reviewTtlMs);
  await pool.query('UPDATE sheet_versions SET state = $2 WHERE id = $1', [version.id, 'in_review']);
  await pool.query('INSERT INTO review_steps (version_id, step, state, due_at) VALUES ($1,$2,$3,$4) ON CONFLICT (version_id, step) DO UPDATE SET state = $3, due_at = $4', [version.id, 'markup', 'pending', dueAt]);
  await pool.query('INSERT INTO review_steps (version_id, step, state) VALUES ($1,$2,$3) ON CONFLICT (version_id, step) DO UPDATE SET state = $3', [version.id, 'manage', 'waiting']);
  liveHub.broadcast(version.drawing_id, 'review', { version_id: version.id, sheet_id: version.sheet_id, number: version.number, state: 'in_review', steps: await stepsFor(version.id) });
  return {
    state: 'in_review',
    steps: [
      { role: 'markup', state: 'pending', due_at: formatUtc(dueAt) },
      { role: 'manage', state: 'waiting', due_at: null },
    ],
  };
});

router.add('POST', '/api/versions/:id/review/:step/approve', async (context) => {
  const username = await requireUser(context);
  return reviewAct(context, username, 'approve');
});

router.add('POST', '/api/versions/:id/review/:step/reject', async (context) => {
  const username = await requireUser(context);
  return reviewAct(context, username, 'reject');
});

async function reviewAct(context: { params: Record<string, string>; body: unknown }, username: string, action: 'approve' | 'reject') {
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const step = context.params.step as 'markup' | 'manage';
  if (step !== 'markup' && step !== 'manage') throw new ApiError('not_found', 'We couldn\u2019t find that review step.');
  if (version.state === 'voided') {
    throw new ApiError('review_voided', ERROR_TEXT.reviewVoided(version.number));
  }
  const steps = await stepsFor(version.id);
  const own = steps.find((s) => s.step === step);
  if (!own) throw new ApiError('not_found', 'We couldn\u2019t find that review step.');
  if (own.state === 'expired') throw new ApiError('review_expired', ERROR_TEXT.reviewExpired);
  if (step === 'manage') {
    const before = steps.find((s) => s.step === 'markup');
    if (before && before.state !== 'approved' && before.state !== 'rejected') {
      throw new ApiError('out_of_order', ERROR_TEXT.reviewWaiting);
    }
  }
  if (own.state === 'approved' || own.state === 'rejected') {
    throw new ApiError('illegal_transition', ERROR_TEXT.versionTransition(own.state, action));
  }
  const needed = step === 'markup' ? 'markup' : 'manage';
  requireRole(role, needed);
  const comment = ((context.body ?? {}) as { comment?: unknown }).comment;
  const now = serverNow();
  if (own.due_at && new Date(own.due_at).getTime() < now.getTime()) {
    throw new ApiError('review_expired', ERROR_TEXT.reviewExpired);
  }
  await pool.query('UPDATE review_steps SET state = $3, acted_by = $4, acted_at = $5, comment = $6 WHERE version_id = $1 AND step = $2', [
    version.id,
    step,
    action === 'approve' ? 'approved' : 'rejected',
    username,
    now,
    comment === undefined || comment === null ? null : String(comment),
  ]);
  await pool.query('INSERT INTO version_stamps (version_id, kind, username, at) VALUES ($1,$2,$3,$4)', [
    version.id,
    action === 'approve' ? `Approved by ${username} at ${formatStamp(now)}` : `Rejected by ${username} at ${formatStamp(now)}`,
    username,
    now,
  ]);
  if (action === 'reject') {
    await pool.query('UPDATE sheet_versions SET state = $2 WHERE id = $1', [version.id, 'rejected']);
  } else if (step === 'manage') {
    await pool.query('UPDATE sheet_versions SET state = $2 WHERE id = $1', [version.id, 'approved']);
  } else {
    await pool.query('UPDATE review_steps SET state = $2, due_at = $3 WHERE version_id = $1 AND step = $4', [version.id, 'pending', new Date(now.getTime() + config.reviewTtlMs), 'manage']);
  }
  const fresh = await versionById(version.id);
  liveHub.broadcast(version.drawing_id, 'review', { version_id: version.id, sheet_id: version.sheet_id, number: version.number, state: fresh?.state, steps: await stepsFor(version.id) });
  return { id: version.id, sheet_id: version.sheet_id, number: version.number, state: fresh?.state, stamps: await stampsFor(version.id), steps: await stepsFor(version.id) };
}

// ---------------------------------------------------------------------------
// View links
// ---------------------------------------------------------------------------

router.add('POST', '/api/versions/:id/links', async (context) => {
  const username = await requireUser(context);
  const version = await versionById(context.params.id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  requireRole(role, 'manage');
  const id = randomId('l');
  const token = randomId('t').slice(2);
  const expiresAt = new Date(serverNow().getTime() + config.linkTtlMs);
  await pool.query('INSERT INTO view_links (id, token, version_id, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)', [id, token, version.id, username, expiresAt]);
  const url = `/v/${token}`;
  liveHub.broadcast(version.drawing_id, 'link', { link_id: id, version_id: version.id, url });
  return { id, url, expires_at: formatUtc(expiresAt) };
});

router.add('DELETE', '/api/links/:id', async (context) => {
  const username = await requireUser(context);
  const row = await pool.query<{ version_id: string; token: string }>('SELECT version_id, token FROM view_links WHERE id = $1', [context.params.id]);
  const link = row.rows[0];
  if (!link) throw new ApiError('not_found', 'We couldn\u2019t find that link.');
  const version = await versionById(link.version_id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that link.');
  const role = await roleForDrawing(version.drawing_id, username);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that link.');
  requireRole(role, 'manage');
  await pool.query('UPDATE view_links SET revoked = true WHERE id = $1', [context.params.id]);
  liveHub.broadcast(version.drawing_id, 'link', { link_id: context.params.id, token: link.token, revoked: true });
  context.response.writeHead(204);
  context.response.end();
  return undefined;
});

router.add('GET', '/api/links/:token', async (context) => {
  const row = await pool.query<{ version_id: string; expires_at: Date; revoked: boolean }>('SELECT version_id, expires_at, revoked FROM view_links WHERE token = $1', [context.params.token]);
  const link = row.rows[0];
  if (!link) throw new ApiError('not_found', 'We couldn\u2019t find that link.');
  if (link.revoked) throw new ApiError('link_revoked', 'This link was turned off.');
  if (link.expires_at.getTime() < serverNow().getTime()) throw new ApiError('link_expired', 'This link has expired.');
  const version = await versionById(link.version_id);
  if (!version) throw new ApiError('not_found', 'We couldn\u2019t find that link.');
  return {
    id: version.id,
    sheet_id: version.sheet_id,
    number: version.number,
    state: version.state,
    replaced_by: version.replaced_by,
    stamps: await stampsFor(version.id),
    steps: await stepsFor(version.id),
    snapshot: version.snapshot,
    published_at: version.published_at,
  };
});

router.add('GET', '/api/links/:token/live', async (context) => {
  return { ok: true };
});

export { compareVersions, markupFlag, reviewAct, xrefHosts };
