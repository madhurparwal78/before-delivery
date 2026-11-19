import { config } from '../config.js';
import { one, query, transaction } from '../db.js';
import { citationReport } from '../domain/citationReport.js';
import { newToken } from '../domain/ids.js';
import { loadReview } from '../domain/review.js';
import { liveShareProjectId, shareLinkShape, ShareLinkRow } from '../domain/share.js';
import { fileShape, FileRow } from '../domain/shapes.js';
import { allowedKeys } from '../domain/validation.js';
import { Ctx, Reply, requireProject } from '../http/context.js';
import { notFound } from '../http/errors.js';
import { Route } from '../http/router.js';
import { rawFileReply } from './files.js';

async function readShareLink(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  const row = await one<ShareLinkRow>(`select * from share_links where project_id = $1`, [
    access.project.id,
  ]);
  return { status: 200, body: { shareLink: row === null ? null : shareLinkShape(row) } };
}

async function writeShareLink(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  allowedKeys(ctx.body, []);
  const row = await transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + config.shareLinkTtlSeconds * 1000);
    return tx.one<ShareLinkRow>(
      `insert into share_links (project_id, token, created_at, expires_at)
       values ($1, $2, $3, $4)
       on conflict (project_id) do update
         set token = excluded.token,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at
       returning *`,
      [access.project.id, newToken(), createdAt, expiresAt],
    );
  });
  return { status: 201, body: { shareLink: shareLinkShape(row as ShareLinkRow) } };
}

async function revokeShareLink(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'administer');
  await query(`delete from share_links where project_id = $1`, [access.project.id]);
  return { status: 204 };
}

async function shareProject(token: string): Promise<string> {
  const projectId = await liveShareProjectId(token);
  if (projectId === null) throw notFound();
  return projectId;
}

async function readSharedProject(ctx: Ctx): Promise<Reply> {
  const projectId = await shareProject(ctx.params.token);
  const project = (await one<{ title: string; project_revision: number }>(
    `select title, project_revision from projects where id = $1`,
    [projectId],
  )) as { title: string; project_revision: number };
  const files = await query<FileRow>(
    `select * from files where project_id = $1 and deleted = false order by path`,
    [projectId],
  );
  return {
    status: 200,
    body: {
      project: { title: project.title, projectRevision: project.project_revision },
      files: files.map((row) => fileShape(row, false)),
    },
  };
}

async function sharedFile(ctx: Ctx): Promise<FileRow & { projectId: string }> {
  const projectId = await shareProject(ctx.params.token);
  const file = await one<FileRow>(
    `select * from files where project_id = $1 and id = $2 and deleted = false`,
    [projectId, ctx.params.fid],
  );
  if (file === null) throw notFound();
  return { ...file, projectId };
}

async function readSharedFile(ctx: Ctx): Promise<Reply> {
  const file = await sharedFile(ctx);
  return { status: 200, body: { file: fileShape(file, true) } };
}

async function readSharedRaw(ctx: Ctx): Promise<Reply> {
  const file = await sharedFile(ctx);
  return rawFileReply(file, file.projectId);
}

async function readSharedReview(ctx: Ctx): Promise<Reply> {
  const projectId = await shareProject(ctx.params.token);
  const review = await loadReview(projectId, 'share');
  return { status: 200, body: review };
}

async function readSharedCitations(ctx: Ctx): Promise<Reply> {
  const projectId = await shareProject(ctx.params.token);
  const project = (await one<{ project_revision: number }>(
    `select project_revision from projects where id = $1`,
    [projectId],
  )) as { project_revision: number };
  const report = await citationReport(projectId, project.project_revision);
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

export const shareRoutes: Route[] = [
  { method: 'GET', path: '/api/projects/:pid/share-link', keys: [], handler: readShareLink },
  { method: 'POST', path: '/api/projects/:pid/share-link', keys: [], handler: writeShareLink },
  { method: 'DELETE', path: '/api/projects/:pid/share-link', keys: [], handler: revokeShareLink },
  { method: 'GET', path: '/api/share/:token', keys: [], anonymous: true, handler: readSharedProject },
  {
    method: 'GET',
    path: '/api/share/:token/files/:fid',
    keys: [],
    anonymous: true,
    handler: readSharedFile,
  },
  {
    method: 'GET',
    path: '/api/share/:token/files/:fid/raw',
    keys: [],
    anonymous: true,
    handler: readSharedRaw,
  },
  {
    method: 'GET',
    path: '/api/share/:token/review',
    keys: [],
    anonymous: true,
    handler: readSharedReview,
  },
  {
    method: 'GET',
    path: '/api/share/:token/citations',
    keys: [],
    anonymous: true,
    handler: readSharedCitations,
  },
];
