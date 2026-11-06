import { crossingsOfZone, deriveFromPage, derivedZone } from '../../shared/derive';
import { connectorCrossings } from '../../shared/derive';
import { isPlainText, parsePageDocument } from '../../shared/validate';
import type { Derived, PageDocument } from '../../shared/types';
import { newId } from '../crypto';
import { queryOne, withTransaction } from '../db';
import { HttpError, errors } from '../http/errors';
import type { AuthedCtx, Params, Reply, Route } from '../http/router';
import { requireAccess, requireRole, type DiagramAccess } from '../domain/access';

interface PageRow {
  id: string;
  name: string;
  version: number;
  doc: PageDocument;
  derived: Derived;
}

async function loadPage(diagramId: string, pageId: string): Promise<PageRow> {
  const row = await queryOne<PageRow>(
    'select id, name, version, doc, derived from pages where id = $1 and diagram_id = $2',
    [pageId, diagramId],
  );
  if (!row) throw errors.notFound();
  return row;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

async function pageAccess(ctx: AuthedCtx, params: Params): Promise<{ access: DiagramAccess; page: PageRow }> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  const pageId = params.pageId ?? '';
  if (!isUuidLike(pageId)) throw errors.notFound();
  const page = await loadPage(access.diagramId, pageId);
  return { access, page };
}

async function createPage(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'editor');
  const body = typeof ctx.json === 'object' && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {};
  const name = typeof body.name === 'string' ? body.name : '';
  const count = await queryOne<{ count: string }>('select count(*)::text as count from pages where diagram_id = $1', [
    access.diagramId,
  ]);
  if (Number.parseInt(count?.count ?? '0', 10) >= 20) {
    throw errors.conflict('page_limit', 'This diagram already has 20 pages.');
  }
  if (!isPlainText(name, 1, 80)) throw errors.validation({ name: 'invalid' });
  const pageId = newId();
  const doc: PageDocument = { id: pageId, name: name.trim(), version: 1, zones: [], shapes: [], connectors: [] };
  await withTransaction(async (client) => {
    await client.query(
      'insert into pages (id, diagram_id, name, version, doc, derived) values ($1, $2, $3, 1, $4, $5)',
      [pageId, access.diagramId, doc.name, JSON.stringify(doc), JSON.stringify(deriveFromPage(doc))],
    );
    await client.query('update diagrams set updated_at = now() where id = $1', [access.diagramId]);
  });
  return { status: 201, body: { page: { id: pageId, name: doc.name, version: 1 } } };
}

async function readPage(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const { page } = await pageAccess(ctx, params);
  return { status: 200, body: { page: page.doc, derived: page.derived } };
}

/** A page saves as one document guarded by its version number. */
async function savePage(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const { access, page } = await pageAccess(ctx, params);
  requireRole(access, 'editor');
  const body = typeof ctx.json === 'object' && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {};
  if (typeof body.id !== 'string' || body.id !== page.id) throw errors.notFound();

  const parsed = parsePageDocument(ctx.json);
  if ('error' in parsed) {
    if (parsed.error === 'dangling_connector') {
      throw new HttpError(422, 'dangling_connector', 'A connector is not attached to its shapes.', {
        fields: parsed.fields,
      });
    }
    throw errors.validation(parsed.fields);
  }
  const doc = parsed.doc;

  return withTransaction(async (client) => {
    const current = await client.query<{ version: number }>(
      'select version from pages where id = $1 and diagram_id = $2 for update',
      [page.id, access.diagramId],
    );
    const stored = current.rows[0];
    if (!stored) throw errors.notFound();
    if (stored.version !== doc.version) {
      throw errors.conflict('version_conflict', 'Someone else saved this page.');
    }
    const nextVersion = stored.version + 1;
    const saved: PageDocument = { ...doc, version: nextVersion };
    const derived = deriveFromPage(saved);
    await client.query('update pages set name = $2, version = $3, doc = $4, derived = $5 where id = $1', [
      page.id,
      saved.name,
      nextVersion,
      JSON.stringify(saved),
      JSON.stringify(derived),
    ]);
    await client.query('update diagrams set updated_at = now() where id = $1', [access.diagramId]);
    return { status: 200, body: { page: saved, derived } };
  });
}

async function readShape(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const { page } = await pageAccess(ctx, params);
  const shape = page.doc.shapes.find((entry) => entry.id === params.shapeId);
  if (!shape) throw errors.notFound();
  const zoneIds = page.derived.zones.filter((zone) => zone.members.includes(shape.id)).map((zone) => zone.id);
  return { status: 200, body: { shape, zoneIds } };
}

async function readZone(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const { page } = await pageAccess(ctx, params);
  const zone = page.doc.zones.find((entry) => entry.id === params.zoneId);
  if (!zone) throw errors.notFound();
  const summary = derivedZone(page.derived, zone.id);
  const crossingPoints = crossingsOfZone(page.derived, zone.id).map((crossing) => ({
    connectorId: crossing.connectorId,
    x: crossing.x,
    y: crossing.y,
    direction: crossing.direction,
  }));
  return {
    status: 200,
    body: {
      zone,
      derived: { systems: summary.systems, crossings: summary.crossings, members: summary.members, crossingPoints },
    },
  };
}

async function readConnector(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const { page } = await pageAccess(ctx, params);
  const connector = page.doc.connectors.find((entry) => entry.id === params.connectorId);
  if (!connector) throw errors.notFound();
  const crossings = page.doc.zones.flatMap((zone) =>
    connectorCrossings(connector, zone).map((crossing) => ({
      zoneId: zone.id,
      x: crossing.x,
      y: crossing.y,
      direction: crossing.direction,
    })),
  );
  return { status: 200, body: { connector, crossings } };
}

export const pageRoutes: Route[] = [
  { method: 'POST', pattern: '/api/diagrams/:id/pages', auth: true, body: 'json', handler: createPage },
  { method: 'GET', pattern: '/api/diagrams/:id/pages/:pageId', auth: true, handler: readPage },
  { method: 'PUT', pattern: '/api/diagrams/:id/pages/:pageId', auth: true, body: 'json', handler: savePage },
  {
    method: 'GET',
    pattern: '/api/diagrams/:id/pages/:pageId/shapes/:shapeId',
    auth: true,
    handler: readShape,
  },
  { method: 'GET', pattern: '/api/diagrams/:id/pages/:pageId/zones/:zoneId', auth: true, handler: readZone },
  {
    method: 'GET',
    pattern: '/api/diagrams/:id/pages/:pageId/connectors/:connectorId',
    auth: true,
    handler: readConnector,
  },
];
