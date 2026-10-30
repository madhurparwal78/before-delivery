import { HK_ZONE, type SnagAction, type SnagState } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { dateInZone, parseCalendarDate } from '../../shared/zoned.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, type Queryable } from '../db/pool.js';
import {
  contractorHoldsContract,
  requireProject,
  requireUuid,
  type ProjectRecord,
} from '../domain/access.js';
import { snagAllows, snagMovable, snagStateAfter } from '../domain/transitions.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { forbidden, illegalTransition, notFound, validation } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import { EXTENSIONS, baseFileName, FILE_LIMIT_BYTES, detectFileKind } from '../services/files.js';
import { prepareImage } from '../services/images.js';
import { getObject, putObject } from '../services/storage.js';
import { fileTooLarge } from '../http/errors.js';

interface ViewpointRow {
  id: string;
  project_id: string;
  name: string;
  store_code: string;
  render_key: string | null;
  render_content_type: string | null;
}

interface SnagRow {
  id: string;
  viewpoint_id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  note: string;
  observed_on: string;
  state: SnagState;
  version: number;
}

function snagPayload(row: SnagRow): unknown {
  return {
    id: row.id,
    number: row.number,
    s: row.s,
    y: row.y,
    title: row.title,
    note: row.note,
    observedOn: row.observed_on,
    state: row.state,
    version: row.version,
  };
}

async function siteWalkScope(member: Member, projectId: string): Promise<ProjectRecord> {
  const project = await requireProject(pool, projectId, member);
  if (member.role === 'contractor' && !(await contractorHoldsContract(pool, project.id, member))) {
    throw notFound();
  }
  return project;
}

async function loadViewpoint(
  member: Member,
  viewpointId: string,
): Promise<{ row: ViewpointRow; project: ProjectRecord }> {
  const row = await firstRow<ViewpointRow>(
    pool,
    'SELECT id, project_id, name, store_code, render_key, render_content_type FROM viewpoints WHERE id = $1',
    [requireUuid(viewpointId)],
  );
  if (!row) throw notFound();
  return { row, project: await siteWalkScope(member, row.project_id) };
}

async function latestPhoto(
  client: Queryable,
  viewpointId: string,
): Promise<{ id: string; storage_key: string; content_type: string } | null> {
  return firstRow<{ id: string; storage_key: string; content_type: string }>(
    client,
    `SELECT id, storage_key, content_type FROM viewpoint_photos WHERE viewpoint_id = $1
      ORDER BY uploaded_at DESC LIMIT 1`,
    [viewpointId],
  );
}

function mayEditSiteWalk(member: Member): void {
  if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
}

/** Renders and site photos are PNG or JPEG only. */
function preparedImageOrRefuse(fileName: string, bytes: Buffer): ReturnType<typeof prepareImage> {
  const displayName = baseFileName(fileName);
  if (bytes.byteLength > FILE_LIMIT_BYTES) throw fileTooLarge(FILE_LIMIT_BYTES);
  const kind = detectFileKind(bytes);
  if (kind !== 'png' && kind !== 'jpeg') {
    throw validation({ file: fieldErrorCopy.unsupportedImage(displayName) });
  }
  return prepareImage(bytes);
}

export function registerSiteWalkRoutes(router: Router): void {
  router.get('/api/projects/:id/viewpoints', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await siteWalkScope(member, context.param('id'));
    const found = await rows<ViewpointRow>(
      pool,
      `SELECT id, project_id, name, store_code, render_key, render_content_type FROM viewpoints
        WHERE project_id = $1 ORDER BY name`,
      [project.id],
    );
    return jsonReply(200, {
      viewpoints: await Promise.all(
        found.map(async (row) => ({
          id: row.id,
          name: row.name,
          storeCode: row.store_code,
          hasRender: row.render_key !== null,
          photoId: (await latestPhoto(pool, row.id))?.id ?? null,
        })),
      ),
    });
  });

  router.post('/api/projects/:id/viewpoints', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await requireProject(pool, context.param('id'), member);
    mayEditSiteWalk(member);
    const body = await context.json();

    const fields = new Fields();
    const name = fields.text('name', body.name, { label: 'Name', max: 120, oneLine: true });
    const storeCode = fields.text('storeCode', body.storeCode, {
      label: 'Store',
      max: 16,
      oneLine: true,
    });
    const stores = await rows<{ code: string }>(
      pool,
      'SELECT code FROM project_stores WHERE project_id = $1',
      [project.id],
    );
    if (!stores.some((store) => store.code === storeCode)) {
      fields.add('storeCode', fieldErrorCopy.storeUnknown());
    }
    fields.finish();

    const viewpointId = newId();
    await pool.query(
      'INSERT INTO viewpoints (id, project_id, name, store_code) VALUES ($1, $2, $3, $4)',
      [viewpointId, project.id, name, storeCode],
    );
    return jsonReply(201, {
      viewpoint: { id: viewpointId, name, storeCode, hasRender: false, photoId: null },
    });
  });

  router.put('/api/viewpoints/:id/render', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row, project } = await loadViewpoint(member, context.param('id'));
    mayEditSiteWalk(member);
    const form = await context.multipart();
    const upload = form.files.find((file) => file.field === 'file');
    if (!upload) throw validation({ file: fieldErrorCopy.required('Render') });

    const prepared = preparedImageOrRefuse(upload.fileName, upload.bytes);
    if (!prepared) throw validation({ file: fieldErrorCopy.unsupportedImage(upload.fileName) });
    const extension = prepared.contentType === 'image/png' ? EXTENSIONS.png : EXTENSIONS.jpeg;
    const storageKey = `projects/${project.id}/viewpoints/${row.id}/render.${extension}`;
    await putObject(storageKey, prepared.bytes, prepared.contentType);
    await pool.query(
      'UPDATE viewpoints SET render_key = $2, render_content_type = $3 WHERE id = $1',
      [row.id, storageKey, prepared.contentType],
    );
    return jsonReply(200, {
      viewpoint: {
        id: row.id,
        name: row.name,
        storeCode: row.store_code,
        hasRender: true,
        photoId: (await latestPhoto(pool, row.id))?.id ?? null,
      },
    });
  });

  router.post('/api/viewpoints/:id/photos', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row, project } = await loadViewpoint(member, context.param('id'));
    mayEditSiteWalk(member);
    const form = await context.multipart();
    const upload = form.files.find((file) => file.field === 'file');
    if (!upload) throw validation({ file: fieldErrorCopy.required('Site photo') });

    const prepared = preparedImageOrRefuse(upload.fileName, upload.bytes);
    if (!prepared) throw validation({ file: fieldErrorCopy.unsupportedImage(upload.fileName) });
    const photoId = newId();
    const extension = prepared.contentType === 'image/png' ? EXTENSIONS.png : EXTENSIONS.jpeg;
    const storageKey = `projects/${project.id}/viewpoints/${row.id}/photos/${photoId}.${extension}`;
    await putObject(storageKey, prepared.bytes, prepared.contentType);
    await pool.query(
      `INSERT INTO viewpoint_photos (id, viewpoint_id, storage_key, content_type, width, height)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [photoId, row.id, storageKey, prepared.contentType, prepared.width, prepared.height],
    );
    return jsonReply(201, {
      photo: { id: photoId, width: prepared.width, height: prepared.height },
    });
  });

  router.get('/api/viewpoints/:id/render', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadViewpoint(member, context.param('id'));
    if (!row.render_key) throw notFound();
    return {
      status: 200,
      bytes: await getObject(row.render_key),
      contentType: row.render_content_type ?? 'image/jpeg',
    };
  });

  router.get('/api/viewpoints/:id/photo', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadViewpoint(member, context.param('id'));
    const photo = await latestPhoto(pool, row.id);
    if (!photo) throw notFound();
    return {
      status: 200,
      bytes: await getObject(photo.storage_key),
      contentType: photo.content_type,
    };
  });

  router.get('/api/viewpoints/:id/snags', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row } = await loadViewpoint(member, context.param('id'));
    const found = await rows<SnagRow>(
      pool,
      `SELECT id, viewpoint_id, number, s, y, title, note, observed_on, state, version
         FROM snags WHERE viewpoint_id = $1 ORDER BY number`,
      [row.id],
    );
    return jsonReply(200, { snags: found.map(snagPayload) });
  });

  router.post('/api/viewpoints/:id/snags', async (context): Promise<Reply> => {
    const member = await context.member();
    const { row, project } = await loadViewpoint(member, context.param('id'));
    mayEditSiteWalk(member);
    const body = await context.json();

    const fields = new Fields();
    const across = fields.integer('s', body.s, 'Across', 0, 100);
    const height = fields.integer('y', body.y, 'Height', 0, 100);
    const title = fields.text('title', body.title, {
      label: 'Snag title',
      max: 120,
      oneLine: true,
    });
    const note = fields.text('note', body.note ?? '', { label: 'Note', min: 0, max: 500 });
    const observedText = typeof body.observedOn === 'string' ? body.observedOn : '';
    const observed = parseCalendarDate(observedText);
    if (!observed) {
      fields.add('observedOn', fieldErrorCopy.required('Observed on'));
    } else if (observedText > dateInZone(new Date(), HK_ZONE)) {
      fields.add('observedOn', fieldErrorCopy.future('Observed on'));
    } else if (project.defectsEndOn && observedText > project.defectsEndOn) {
      fields.add('observedOn', fieldErrorCopy.snagAfterDefectsEnd(project.defectsEndOn));
    }
    fields.finish();

    const snagId = newId();
    const count = await firstRow<{ count: number }>(
      pool,
      'SELECT COUNT(*)::int AS count FROM snags WHERE viewpoint_id = $1',
      [row.id],
    );
    await pool.query(
      `INSERT INTO snags (id, viewpoint_id, number, s, y, title, note, observed_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [snagId, row.id, (count?.count ?? 0) + 1, across, height, title, note, observedText],
    );
    const created = await firstRow<SnagRow>(
      pool,
      `SELECT id, viewpoint_id, number, s, y, title, note, observed_on, state, version
         FROM snags WHERE id = $1`,
      [snagId],
    );
    if (!created) throw notFound();
    return jsonReply(201, { snag: snagPayload(created) });
  });

  router.patch('/api/snags/:id', async (context): Promise<Reply> => {
    const member = await context.member();
    const snag = await loadSnag(member, context.param('id'));
    mayEditSiteWalk(member);
    if (!snagMovable(snag.state)) throw illegalTransition(snag.state, 'move');

    const body = await context.json();
    const fields = new Fields();
    const across = body.s === undefined ? snag.s : fields.integer('s', body.s, 'Across', 0, 100);
    const height = body.y === undefined ? snag.y : fields.integer('y', body.y, 'Height', 0, 100);
    const title =
      body.title === undefined
        ? snag.title
        : fields.text('title', body.title, { label: 'Snag title', max: 120, oneLine: true });
    const note =
      body.note === undefined
        ? snag.note
        : fields.text('note', body.note, { label: 'Note', min: 0, max: 500 });
    fields.finish();

    await pool.query(
      'UPDATE snags SET s = $2, y = $3, title = $4, note = $5, version = version + 1 WHERE id = $1',
      [snag.id, across, height, title, note],
    );
    const after = await firstRow<SnagRow>(
      pool,
      `SELECT id, viewpoint_id, number, s, y, title, note, observed_on, state, version
         FROM snags WHERE id = $1`,
      [snag.id],
    );
    if (!after) throw notFound();
    return jsonReply(200, { snag: snagPayload(after) });
  });

  router.post('/api/snags/:id/transitions', async (context): Promise<Reply> => {
    const member = await context.member();
    const snag = await loadSnag(member, context.param('id'));
    const body = await context.json();

    const fields = new Fields();
    const action = fields.enumeration<SnagAction>('action', body.action, 'Action', [
      'fix',
      'close',
      'reopen',
    ]);
    fields.finish();

    if (action === 'fix') {
      if (!['director', 'project_lead', 'designer', 'contractor'].includes(member.role)) {
        throw forbidden();
      }
    } else {
      mayEditSiteWalk(member);
    }
    if (!snagAllows(snag.state, action)) throw illegalTransition(snag.state, action);

    const updated = await rows(
      pool,
      'UPDATE snags SET state = $2, version = version + 1 WHERE id = $1 AND state = $3 RETURNING id',
      [snag.id, snagStateAfter(action), snag.state],
    );
    if (updated.length === 0) throw illegalTransition(snag.state, action);

    const after = await firstRow<SnagRow>(
      pool,
      `SELECT id, viewpoint_id, number, s, y, title, note, observed_on, state, version
         FROM snags WHERE id = $1`,
      [snag.id],
    );
    if (!after) throw notFound();
    return jsonReply(200, { snag: snagPayload(after) });
  });
}

async function loadSnag(member: Member, snagId: string): Promise<SnagRow> {
  const row = await firstRow<SnagRow>(
    pool,
    `SELECT id, viewpoint_id, number, s, y, title, note, observed_on, state, version
       FROM snags WHERE id = $1`,
    [requireUuid(snagId)],
  );
  if (!row) throw notFound();
  await loadViewpoint(member, row.viewpoint_id);
  return row;
}
