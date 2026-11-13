import { ApiError, MESSAGES, sheetLockedMessage } from '../../shared/errors.js';
import { SHEET_SIZES } from '../../shared/sheets.js';
import {
  type Role,
  type VersionState,
  reviewVoidedMessage,
  roleAtLeast,
  stampText,
  versionMoveAllowed,
  versionRefusal,
} from '../../shared/transitions.js';
import { notFound, requireRole, requireSignedIn, roleForFolder } from '../access.js';
import { config } from '../config.js';
import { now, nowIso, onClockAdvance } from '../clock.js';
import { one, query } from '../db.js';
import { broadcast, loadDrawing } from '../drawings.js';
import {
  type SheetRow,
  type VersionRow,
  compareVersions,
  markupsOf,
  publishVersion,
  sheetById,
  versionById,
  versionPayload,
  versionsOfSheet,
  viewportSnapshot,
  viewportsOfSheet,
} from '../publish.js';
import {
  arrayField,
  booleanField,
  numberField,
  objectField,
  readJson,
  requireNumber,
  requireString,
  route,
  sendEmpty,
  sendJson,
  stringField,
} from '../http.js';
import { newId, newToken } from '../ids.js';
import { broadcastLink } from '../live.js';
import { drawingAccess } from './folders.js';

interface ReviewStepRow {
  id: string;
  version_id: string;
  role: 'markup' | 'manage';
  state: 'waiting' | 'pending' | 'approved' | 'rejected';
  position: number;
  due_at: Date | null;
  comment: string | null;
}

async function sheetAccess(username: string, sheetId: string): Promise<{ sheet: SheetRow; role: Role; drawingId: string }> {
  const sheet = await sheetById(sheetId);
  if (!sheet) throw notFound();
  const state = await loadDrawing(sheet.drawing_id);
  if (!state) throw notFound();
  const role = await roleForFolder(username, state.folder_id);
  if (!role) throw notFound();
  return { sheet, role, drawingId: sheet.drawing_id };
}

async function versionAccess(username: string, versionId: string): Promise<{ version: VersionRow; sheet: SheetRow; role: Role }> {
  const version = await versionById(versionId);
  if (!version) throw notFound();
  const sheet = await sheetById(version.sheet_id);
  if (!sheet) throw notFound();
  const state = await loadDrawing(sheet.drawing_id);
  if (!state) throw notFound();
  const role = await roleForFolder(username, state.folder_id);
  if (!role) throw notFound();
  return { version, sheet, role };
}

function assertSheetUnlocked(sheet: SheetRow, role: Role): void {
  if (sheet.locked && !roleAtLeast(role, 'manage')) {
    throw new ApiError('sheet_locked', sheetLockedMessage(sheet.locked_by ?? 'a manager'));
  }
}

async function stepsOf(versionId: string): Promise<ReviewStepRow[]> {
  return query<ReviewStepRow>(
    'select id, version_id, role, state, position, due_at, comment from review_steps where version_id = $1 order by position',
    [versionId],
  );
}

function stepPayload(step: ReviewStepRow): Record<string, unknown> {
  return {
    role: step.role,
    state: step.state,
    due_at: step.due_at ? step.due_at.toISOString() : null,
  };
}

async function reviewPayload(version: VersionRow): Promise<Record<string, unknown>> {
  const steps = await stepsOf(version.id);
  return { ...(await versionPayload(version)), steps: steps.map(stepPayload) };
}

/** A pending step past its due time puts the version back to published. */
async function expireSteps(): Promise<void> {
  const rows = await query<{ id: string; version_id: string }>(
    "select id, version_id from review_steps where state = 'pending' and due_at is not null and due_at <= $1",
    [new Date(now()).toISOString()],
  );
  for (const row of rows) {
    const version = await versionById(row.version_id);
    if (!version || version.state !== 'in_review') continue;
    await query('update versions set state = $2 where id = $1', [version.id, 'published']);
    const sheet = await sheetById(version.sheet_id);
    if (!sheet) continue;
    const state = await loadDrawing(sheet.drawing_id);
    if (!state) continue;
    const updated = await versionById(version.id);
    if (!updated) continue;
    await broadcast(state, 'review', {
      version: await reviewPayload(updated),
      expired: true,
      text: MESSAGES.reviewExpired,
    });
  }
}

const notifiedExpiredLinks = new Set<string>();

/** An open link page changes to the expiry text live. */
async function expireLinks(): Promise<void> {
  const rows = await query<{ id: string }>('select id from links where revoked = false and expires_at <= $1', [
    new Date(now()).toISOString(),
  ]);
  for (const row of rows) {
    if (notifiedExpiredLinks.has(row.id)) continue;
    notifiedExpiredLinks.add(row.id);
    broadcastLink(row.id, { state: 'expired', text: MESSAGES.linkExpired });
  }
}

export function startDeadlineSweeps(): void {
  const sweep = (): void => {
    void expireSteps();
    void expireLinks();
  };
  setInterval(sweep, 250);
  onClockAdvance(sweep);
}

export function registerSheetRoutes(): void {
  route('POST', '/api/drawings/:id/sheets', async (context) => {
    const username = requireSignedIn(context.username);
    const { state, role } = await drawingAccess(username, context.params.id);
    requireRole(role, 'edit');
    const body = await readJson(context);
    const name = requireString(body, 'name');
    const size = requireString(body, 'size');
    if (size !== 'A3' && size !== 'A4') throw new ApiError('invalid', MESSAGES.invalid);
    const existing = await query<{ count: string }>('select count(*) as count from sheets where drawing_id = $1', [state.id]);
    const number = Number(existing[0].count) + 1;
    const id = newId('sht');
    await query(
      'insert into sheets (id, drawing_id, name, size, number, attributes, creator) values ($1,$2,$3,$4,$5,$6,$7)',
      [id, state.id, name, size, number, JSON.stringify({ Project: '', 'Checked by': '' }), username],
    );
    const sheet = (await sheetById(id)) as SheetRow;
    await broadcast(state, 'version', { sheet_id: id, sheet: { id, name, size, number, locked: false } });
    sendJson(context.res, 201, {
      id: sheet.id,
      name: sheet.name,
      size: sheet.size,
      number: sheet.number,
      locked: sheet.locked,
      paper: SHEET_SIZES[sheet.size],
    });
  });

  route('PATCH', '/api/sheets/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const { sheet, role, drawingId } = await sheetAccess(username, context.params.id);
    const body = await readJson(context);
    const locked = booleanField(body, 'locked');
    const attributes = objectField(body, 'attributes');
    if (locked !== null) {
      requireRole(role, 'manage');
      await query('update sheets set locked = $2, locked_by = $3 where id = $1', [sheet.id, locked, locked ? username : null]);
    }
    if (attributes) {
      requireRole(role, 'edit');
      assertSheetUnlocked({ ...sheet, locked: locked === null ? sheet.locked : locked }, role);
      const merged = { ...sheet.attributes };
      for (const [tag, value] of Object.entries(attributes)) {
        if (typeof value !== 'string') throw new ApiError('invalid', MESSAGES.invalid);
        merged[tag] = value;
      }
      await query('update sheets set attributes = $2 where id = $1', [sheet.id, JSON.stringify(merged)]);
    }
    const updated = (await sheetById(sheet.id)) as SheetRow;
    const state = await loadDrawing(drawingId);
    if (state) {
      await broadcast(state, 'version', {
        sheet_id: updated.id,
        sheet: {
          id: updated.id,
          name: updated.name,
          size: updated.size,
          number: updated.number,
          locked: updated.locked,
          locked_by: updated.locked_by,
          attributes: updated.attributes,
        },
      });
    }
    sendJson(context.res, 200, {
      id: updated.id,
      name: updated.name,
      size: updated.size,
      number: updated.number,
      locked: updated.locked,
      locked_by: updated.locked_by,
      attributes: updated.attributes,
    });
  });

  route('POST', '/api/sheets/:id/viewports', async (context) => {
    const username = requireSignedIn(context.username);
    const { sheet, role, drawingId } = await sheetAccess(username, context.params.id);
    requireRole(role, 'edit');
    assertSheetUnlocked(sheet, role);
    const body = await readJson(context);
    const id = newId('vp');
    const frozen = (arrayField(body, 'frozen_layers') ?? []).filter((entry): entry is string => typeof entry === 'string');
    await query(
      'insert into viewports (id, sheet_id, x, y, width, height, scale, view_x, view_y, frozen_layers) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        sheet.id,
        requireNumber(body, 'x'),
        requireNumber(body, 'y'),
        requireNumber(body, 'width'),
        requireNumber(body, 'height'),
        requireString(body, 'scale'),
        numberField(body, 'view_x') ?? 0,
        numberField(body, 'view_y') ?? 0,
        JSON.stringify(frozen),
      ],
    );
    const viewports = await viewportsOfSheet(sheet.id);
    const created = viewports.find((viewport) => viewport.id === id);
    const state = await loadDrawing(drawingId);
    if (state) await broadcast(state, 'version', { sheet_id: sheet.id, viewports: viewports.map(viewportSnapshot) });
    sendJson(context.res, 201, created ? viewportSnapshot(created) : { id });
  });

  route('PATCH', '/api/viewports/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const viewport = await one<{ id: string; sheet_id: string }>('select id, sheet_id from viewports where id = $1', [
      context.params.id,
    ]);
    if (!viewport) throw notFound();
    const { sheet, role, drawingId } = await sheetAccess(username, viewport.sheet_id);
    requireRole(role, 'edit');
    assertSheetUnlocked(sheet, role);
    const body = await readJson(context);
    const fields: [string, unknown][] = [];
    for (const field of ['x', 'y', 'width', 'height', 'view_x', 'view_y'] as const) {
      const value = numberField(body, field);
      if (value !== null) fields.push([field, value]);
    }
    const scale = stringField(body, 'scale');
    if (scale !== null) fields.push(['scale', scale]);
    const frozen = arrayField(body, 'frozen_layers');
    if (frozen) fields.push(['frozen_layers', JSON.stringify(frozen.filter((entry) => typeof entry === 'string'))]);
    for (const [field, value] of fields) {
      await query(`update viewports set ${field} = $2 where id = $1`, [viewport.id, value]);
    }
    const viewports = await viewportsOfSheet(sheet.id);
    const updated = viewports.find((candidate) => candidate.id === viewport.id);
    const state = await loadDrawing(drawingId);
    if (state) await broadcast(state, 'version', { sheet_id: sheet.id, viewports: viewports.map(viewportSnapshot) });
    sendJson(context.res, 200, updated ? viewportSnapshot(updated) : { id: viewport.id });
  });

  route('POST', '/api/sheets/:id/versions', async (context) => {
    const username = requireSignedIn(context.username);
    const { sheet, role, drawingId } = await sheetAccess(username, context.params.id);
    requireRole(role, 'edit');
    assertSheetUnlocked(sheet, role);
    const state = await loadDrawing(drawingId);
    if (!state) throw notFound();
    const version = await publishVersion(state, sheet);
    sendJson(context.res, 201, {
      id: version.id,
      number: version.number,
      state: version.state,
      keys: version.keys,
    });
  });

  route('GET', '/api/sheets/:id/versions', async (context) => {
    const username = requireSignedIn(context.username);
    const { sheet } = await sheetAccess(username, context.params.id);
    const versions = await versionsOfSheet(sheet.id);
    const payload: Record<string, unknown>[] = [];
    for (const version of versions) {
      payload.push(await reviewPayload(version));
    }
    sendJson(context.res, 200, { versions: payload });
  });

  route('GET', '/api/versions/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const { version } = await versionAccess(username, context.params.id);
    sendJson(context.res, 200, await reviewPayload(version));
  });

  route('GET', '/api/sheets/:id/compare', async (context) => {
    const username = requireSignedIn(context.username);
    const { sheet } = await sheetAccess(username, context.params.id);
    const from = Number(context.url.searchParams.get('from'));
    const to = Number(context.url.searchParams.get('to'));
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new ApiError('invalid', MESSAGES.invalid);
    sendJson(context.res, 200, await compareVersions(sheet.id, from, to));
  });

  route('POST', '/api/versions/:id/markups', async (context) => {
    const username = requireSignedIn(context.username);
    const { version, sheet, role } = await versionAccess(username, context.params.id);
    requireRole(role, 'markup');
    const body = await readJson(context);
    const kind = requireString(body, 'kind');
    if (!['cloud', 'arrow', 'text'].includes(kind)) throw new ApiError('invalid', MESSAGES.invalid);
    const id = newId('mk');
    await query(
      'insert into markups (id, version_id, kind, x1, y1, x2, y2, text, author) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        version.id,
        kind,
        requireNumber(body, 'x1'),
        requireNumber(body, 'y1'),
        numberField(body, 'x2') ?? requireNumber(body, 'x1'),
        numberField(body, 'y2') ?? requireNumber(body, 'y1'),
        stringField(body, 'text'),
        username,
      ],
    );
    const markups = await markupsOf(version.id);
    const created = markups.find((markup) => markup.id === id);
    const state = await loadDrawing(sheet.drawing_id);
    if (state) await broadcast(state, 'markup', { version_id: version.id, markups });
    sendJson(context.res, 201, created ?? { id });
  });

  route('GET', '/api/versions/:id/markups', async (context) => {
    const username = requireSignedIn(context.username);
    const { version } = await versionAccess(username, context.params.id);
    sendJson(context.res, 200, { markups: await markupsOf(version.id) });
  });

  route('POST', '/api/versions/:id/review', async (context) => {
    const username = requireSignedIn(context.username);
    const { version, sheet, role } = await versionAccess(username, context.params.id);
    requireRole(role, 'edit');
    if (!versionMoveAllowed(version.state, 'in_review')) {
      throw new ApiError('illegal_transition', versionRefusal(version.state, 'in_review'));
    }
    await query('update versions set state = $2 where id = $1', [version.id, 'in_review']);
    await query('delete from review_steps where version_id = $1', [version.id]);
    const due = new Date(now() + config.reviewTtlMs).toISOString();
    await query(
      'insert into review_steps (id, version_id, role, state, position, due_at) values ($1,$2,$3,$4,$5,$6)',
      [newId('stp'), version.id, 'markup', 'pending', 0, due],
    );
    await query('insert into review_steps (id, version_id, role, state, position) values ($1,$2,$3,$4,$5)', [
      newId('stp'),
      version.id,
      'manage',
      'waiting',
      1,
    ]);
    const updated = (await versionById(version.id)) as VersionRow;
    const state = await loadDrawing(sheet.drawing_id);
    if (state) await broadcast(state, 'review', { version: await reviewPayload(updated) });
    const steps = await stepsOf(version.id);
    sendJson(context.res, 201, { state: 'in_review', steps: steps.map(stepPayload) });
  });

  for (const action of ['approve', 'reject'] as const) {
    route('POST', `/api/versions/:id/review/:step/${action}`, async (context) => {
      const username = requireSignedIn(context.username);
      const { version, sheet, role } = await versionAccess(username, context.params.id);
      const stepName = context.params.step;
      if (stepName !== 'markup' && stepName !== 'manage') throw notFound();
      requireRole(role, stepName === 'markup' ? 'markup' : 'manage');
      const body = await readJson(context);
      const comment = stringField(body, 'comment');
      if (version.state === 'voided') {
        throw new ApiError('review_voided', reviewVoidedMessage(version.replaced_by ?? version.number + 1));
      }
      const steps = await stepsOf(version.id);
      const step = steps.find((candidate) => candidate.role === stepName);
      if (!step) throw new ApiError('illegal_transition', versionRefusal(version.state, 'approved'));
      if (version.state !== 'in_review') {
        throw new ApiError('illegal_transition', versionRefusal(version.state, action === 'approve' ? 'approved' : 'rejected'));
      }
      if (step.state === 'waiting') throw new ApiError('out_of_order', MESSAGES.outOfOrder);
      if (step.state !== 'pending') {
        throw new ApiError('illegal_transition', versionRefusal(version.state, action === 'approve' ? 'approved' : 'rejected'));
      }
      if (step.due_at && step.due_at.getTime() <= now()) throw new ApiError('review_expired', MESSAGES.reviewExpired);

      await query('update review_steps set state = $2, comment = $3 where id = $1', [
        step.id,
        action === 'approve' ? 'approved' : 'rejected',
        comment,
      ]);
      await query('insert into version_stamps (id, version_id, text, at) values ($1,$2,$3,$4)', [
        newId('stm'),
        version.id,
        stampText(action === 'approve' ? 'Approved' : 'Rejected', username, new Date(now())),
        nowIso(),
      ]);
      let nextState: VersionState = version.state;
      if (action === 'reject') {
        nextState = 'rejected';
      } else {
        const next = steps.find((candidate) => candidate.position === step.position + 1);
        if (next) {
          await query('update review_steps set state = $2, due_at = $3 where id = $1', [
            next.id,
            'pending',
            new Date(now() + config.reviewTtlMs).toISOString(),
          ]);
        } else {
          nextState = 'approved';
        }
      }
      if (nextState !== version.state) {
        await query('update versions set state = $2 where id = $1', [version.id, nextState]);
      }
      const updated = (await versionById(version.id)) as VersionRow;
      const state = await loadDrawing(sheet.drawing_id);
      if (state) await broadcast(state, 'review', { version: await reviewPayload(updated) });
      sendJson(context.res, 200, await reviewPayload(updated));
    });
  }

  route('POST', '/api/versions/:id/links', async (context) => {
    const username = requireSignedIn(context.username);
    const { version, role } = await versionAccess(username, context.params.id);
    requireRole(role, 'manage');
    const id = newId('lnk');
    const token = newToken();
    const expires = new Date(now() + config.linkTtlMs).toISOString();
    await query('insert into links (id, version_id, token, expires_at) values ($1,$2,$3,$4)', [
      id,
      version.id,
      token,
      expires,
    ]);
    sendJson(context.res, 201, { id, url: `/v/${token}`, expires_at: expires });
  });

  route('DELETE', '/api/links/:id', async (context) => {
    const username = requireSignedIn(context.username);
    const link = await one<{ id: string; version_id: string }>('select id, version_id from links where id = $1', [
      context.params.id,
    ]);
    if (!link) throw notFound();
    const { role } = await versionAccess(username, link.version_id);
    requireRole(role, 'manage');
    await query('update links set revoked = true where id = $1', [link.id]);
    broadcastLink(link.id, { state: 'revoked', text: MESSAGES.linkRevoked });
    sendEmpty(context.res, 204);
  });

  route('GET', '/api/links/:token', async (context) => {
    const link = await one<{ id: string; version_id: string; expires_at: Date; revoked: boolean }>(
      'select id, version_id, expires_at, revoked from links where token = $1',
      [context.params.token],
    );
    if (!link) throw notFound();
    if (link.revoked) throw new ApiError('link_revoked', MESSAGES.linkRevoked);
    if (link.expires_at.getTime() <= now()) throw new ApiError('link_expired', MESSAGES.linkExpired);
    const version = await versionById(link.version_id);
    if (!version) throw notFound();
    sendJson(context.res, 200, await reviewPayload(version));
  });
}
