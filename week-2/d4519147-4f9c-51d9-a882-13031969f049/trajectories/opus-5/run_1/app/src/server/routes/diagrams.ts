import { deriveFromPage } from '../../shared/derive';
import { isPlainText } from '../../shared/validate';
import type { DiagramDetail, DiagramListItem, PageDocument } from '../../shared/types';
import { newId } from '../crypto';
import { query, queryOne, withTransaction } from '../db';
import { errors } from '../http/errors';
import type { AuthedCtx, Params, Reply, Route } from '../http/router';
import { diagramEvents } from '../domain/audit';
import { requireAccess, requireRole } from '../domain/access';

interface PageRefRow {
  id: string;
  name: string;
  version: number;
}

async function pageRefs(diagramId: string): Promise<PageRefRow[]> {
  return query<PageRefRow>('select id, name, version from pages where diagram_id = $1 order by seq', [diagramId]);
}

function emptyPage(pageId: string, name: string): PageDocument {
  return { id: pageId, name, version: 1, zones: [], shapes: [], connectors: [] };
}

function readTitle(json: unknown): string {
  const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const title = typeof body.title === 'string' ? body.title : '';
  if (!isPlainText(title, 1, 120)) throw errors.validation({ title: 'invalid' });
  return title.trim();
}

async function detail(diagramId: string): Promise<DiagramDetail | null> {
  const row = await queryOne<{ id: string; title: string; updated_at: Date; owner_name: string; owner_id: string }>(
    `select d.id, d.title, d.updated_at, o.display_name as owner_name, d.owner_id
     from diagrams d join users o on o.id = d.owner_id where d.id = $1`,
    [diagramId],
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    role: 'owner',
    ownerName: row.owner_name,
    pages: await pageRefs(diagramId),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function listDiagrams(ctx: AuthedCtx): Promise<Reply> {
  const rows = await query<{ id: string; title: string; updated_at: Date; role: string }>(
    `select d.id, d.title, d.updated_at,
            case when d.owner_id = $1 then 'owner' else s.role end as role
     from diagrams d
       left join shares s on s.diagram_id = d.id and s.email = $2 and s.status = 'active'
     where d.owner_id = $1 or s.id is not null
     order by d.updated_at desc`,
    [ctx.session.user.id, ctx.session.user.email.toLowerCase()],
  );
  const diagrams: DiagramListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    role: row.role as DiagramListItem['role'],
    updatedAt: row.updated_at.toISOString(),
  }));
  return { status: 200, body: { diagrams } };
}

async function createDiagram(ctx: AuthedCtx): Promise<Reply> {
  const title = readTitle(ctx.json);
  const diagramId = newId();
  const pageId = newId();
  const doc = emptyPage(pageId, 'Page 1');
  await withTransaction(async (client) => {
    await client.query('insert into diagrams (id, title, owner_id) values ($1, $2, $3)', [
      diagramId,
      title,
      ctx.session.user.id,
    ]);
    await client.query(
      'insert into pages (id, diagram_id, name, version, doc, derived) values ($1, $2, $3, 1, $4, $5)',
      [pageId, diagramId, doc.name, JSON.stringify(doc), JSON.stringify(deriveFromPage(doc))],
    );
  });
  const created = await detail(diagramId);
  if (!created) throw errors.internal();
  return { status: 201, body: { diagram: created } };
}

async function readDiagram(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  const found = await detail(access.diagramId);
  if (!found) throw errors.notFound();
  return { status: 200, body: { diagram: { ...found, role: access.role } } };
}

async function renameDiagram(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'editor');
  const title = readTitle(ctx.json);
  await query('update diagrams set title = $2, updated_at = now() where id = $1', [access.diagramId, title]);
  const updated = await detail(access.diagramId);
  if (!updated) throw errors.notFound();
  return { status: 200, body: { diagram: { ...updated, role: access.role } } };
}

async function deleteDiagram(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'owner');
  await withTransaction(async (client) => {
    await client.query(
      `update shares set status = 'withdrawn', token_hash = null, updated_at = now()
       where diagram_id = $1 and status = 'invited'`,
      [access.diagramId],
    );
    await client.query(`delete from mail_queue where diagram_id = $1 and status = 'pending'`, [access.diagramId]);
    await client.query('delete from diagrams where id = $1', [access.diagramId]);
  });
  return { status: 204 };
}

async function readAudit(ctx: AuthedCtx, params: Params): Promise<Reply> {
  const access = await requireAccess(params.id ?? '', ctx.session.user);
  requireRole(access, 'owner');
  return { status: 200, body: { events: await diagramEvents(access.diagramId) } };
}

export const diagramRoutes: Route[] = [
  { method: 'GET', pattern: '/api/diagrams', auth: true, handler: listDiagrams },
  { method: 'POST', pattern: '/api/diagrams', auth: true, body: 'json', handler: createDiagram },
  { method: 'GET', pattern: '/api/diagrams/:id', auth: true, handler: readDiagram },
  { method: 'PATCH', pattern: '/api/diagrams/:id', auth: true, body: 'json', handler: renameDiagram },
  { method: 'DELETE', pattern: '/api/diagrams/:id', auth: true, handler: deleteDiagram },
  { method: 'GET', pattern: '/api/diagrams/:id/audit', auth: true, handler: readAudit },
];
