import { query, transaction } from '../db.js';
import { citationReport } from '../domain/citationReport.js';
import { restoreRevision } from '../domain/files.js';
import { newId } from '../domain/ids.js';
import { iso, Label, personView } from '../domain/shapes.js';
import { allowedKeys, FieldCheck } from '../domain/validation.js';
import { Ctx, Reply, requireProject } from '../http/context.js';
import { conflict, invalid, methodNotAllowed, notFound } from '../http/errors.js';
import { Route } from '../http/router.js';
import { actorOf } from './files.js';

interface LabelRow {
  id: string;
  name: string;
  project_revision: number;
  created_at: Date;
  actor_id: string;
  actor_display_name: string;
  actor_handle: string;
}

function labelShape(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    projectRevision: row.project_revision,
    createdAt: iso(row.created_at),
    createdBy: personView.snapshot(row),
  };
}

async function listLabels(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const rows = await query<LabelRow>(
    `select * from labels where project_id = $1 order by created_at`,
    [access.project.id],
  );
  return { status: 200, body: { labels: rows.map(labelShape) } };
}

async function createLabel(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  allowedKeys(ctx.body, ['name', 'projectRevision']);
  const check = new FieldCheck(ctx.body);
  const name = check.text('name', { min: 1, max: 60, trim: true });
  const revision = check.has('projectRevision')
    ? check.integer('projectRevision', { min: 1 })
    : access.project.project_revision;
  check.done();

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const entry = await tx.one(
      `select 1 from ledger_entries where project_id = $1 and project_revision = $2`,
      [access.project.id, revision],
    );
    if (entry === null) throw invalid({ projectRevision: 'Unknown revision.' });
    const taken = await tx.one(
      `select 1 from labels where project_id = $1 and name_lower = $2`,
      [access.project.id, (name as string).toLowerCase()],
    );
    if (taken !== null) throw conflict('label_taken');
    const id = newId('l');
    const row = (await tx.one<LabelRow>(
      `insert into labels
         (id, project_id, name, name_lower, project_revision,
          actor_id, actor_display_name, actor_handle)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        id,
        access.project.id,
        name,
        (name as string).toLowerCase(),
        revision,
        access.user.id,
        access.user.display_name,
        access.user.handle,
      ],
    )) as LabelRow;
    return { status: 201, body: { label: labelShape(row) } };
  });
}

async function restoreLabel(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  allowedKeys(ctx.body, []);
  const rows = await query<LabelRow>(
    `select * from labels where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.lid],
  );
  if (rows.length === 0) throw notFound();
  const label = rows[0];

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const projectRevision = await restoreRevision(tx, {
      projectId: access.project.id,
      projectRevision: label.project_revision,
      labelName: label.name,
      actor: actorOf(access.user),
    });
    const entry = (await tx.one<{
      project_revision: number;
      kind: string;
      summary: string;
      actor_id: string;
      actor_display_name: string;
      actor_handle: string;
      at: Date;
    }>(
      `select * from ledger_entries where project_id = $1 and project_revision = $2`,
      [access.project.id, projectRevision],
    )) as {
      project_revision: number;
      kind: string;
      summary: string;
      actor_id: string;
      actor_display_name: string;
      actor_handle: string;
      at: Date;
    };
    return {
      status: 201,
      body: {
        projectRevision,
        entry: {
          projectRevision: entry.project_revision,
          kind: entry.kind,
          summary: entry.summary,
          actor: personView.snapshot(entry),
          at: iso(entry.at),
          labels: [],
        },
      },
    };
  });
}

async function refuseLabelChange(): Promise<Reply> {
  throw methodNotAllowed();
}

async function readCitations(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const report = await citationReport(access.project.id, access.project.project_revision);
  return {
    status: 200,
    body: {
      projectRevision: report.projectRevision,
      checkId: report.checkId,
      undefined: report.undefined,
      unused: report.unused,
      duplicate: report.duplicate,
    },
  };
}

export const historyRoutes: Route[] = [
  { method: 'GET', path: '/api/projects/:pid/labels', keys: [], handler: listLabels },
  {
    method: 'POST',
    path: '/api/projects/:pid/labels',
    keys: ['name', 'projectRevision'],
    handler: createLabel,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/labels/:lid/restore',
    keys: [],
    handler: restoreLabel,
  },
  { method: 'PATCH', path: '/api/projects/:pid/labels/:lid', keys: [], handler: refuseLabelChange },
  { method: 'PUT', path: '/api/projects/:pid/labels/:lid', keys: [], handler: refuseLabelChange },
  {
    method: 'DELETE',
    path: '/api/projects/:pid/labels/:lid',
    keys: [],
    handler: refuseLabelChange,
  },
  { method: 'GET', path: '/api/projects/:pid/citations', keys: [], handler: readCitations },
];
