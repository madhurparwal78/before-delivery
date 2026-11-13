import type { ProjectRow, SceneRow } from '../../shared/api.js';
import { canEditScenes } from '../../shared/states.js';
import {
  SCENE_TEMPLATES,
  canonicalDocument,
  templateDocument,
  type SceneTemplate,
} from '../../shared/scene.js';
import { stepZeroHash } from '../../shared/sim.js';
import { fieldCopy } from '../../shared/copy.js';
import { query } from '../db.js';
import { faults } from '../errors.js';
import { newId } from '../ids.js';
import { created, ok, type Ctx, type Reply, type Route } from '../http.js';
import {
  assetsOfProject,
  readString,
  recordActivity,
  requireDomainName,
  requireProject,
  requireWorkspace,
} from '../repo.js';

async function listProjects(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  const rows = await query<{
    id: string;
    name: string;
    scene_count: string;
    asset_count: string;
    updated_at: Date;
  }>(
    `select p.id, p.name, p.updated_at,
            (select count(*) from scenes s where s.project_id = p.id) as scene_count,
            (select count(*) from assets a where a.project_id = p.id) as asset_count
       from projects p where p.workspace_id = $1 order by p.created_at`,
    [workspace.workspaceId],
  );
  const projects: ProjectRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    sceneCount: Number(row.scene_count),
    assetCount: Number(row.asset_count),
    updatedAt: row.updated_at.toISOString(),
  }));
  return ok({ projects });
}

async function createProject(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  if (!canEditScenes(workspace.role)) throw faults.forbidden();
  const name = requireDomainName(ctx.body(), 'name');
  const id = newId();
  const rows = await query<{ updated_at: Date }>(
    'insert into projects (id, workspace_id, name) values ($1,$2,$3) returning updated_at',
    [id, workspace.workspaceId, name],
  );
  await recordActivity(workspace.workspaceId, account.id, 'project.created', name);
  const project: ProjectRow = {
    id,
    name,
    sceneCount: 0,
    assetCount: 0,
    updatedAt: rows[0].updated_at.toISOString(),
  };
  return created({ project });
}

async function getProject(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const project = await requireProject(ctx.params.pid, account.id);
  const scenes = await query<{
    id: string;
    name: string;
    status: SceneRow['status'];
    revision: number;
  }>('select id, name, status, revision from scenes where project_id = $1 order by created_at', [
    project.projectId,
  ]);
  const counts = await query<{ scene_count: string; asset_count: string; updated_at: Date }>(
    `select (select count(*) from scenes s where s.project_id = p.id) as scene_count,
            (select count(*) from assets a where a.project_id = p.id) as asset_count,
            p.updated_at
       from projects p where p.id = $1`,
    [project.projectId],
  );
  return ok({
    project: {
      id: project.projectId,
      name: project.projectName,
      sceneCount: Number(counts[0].scene_count),
      assetCount: Number(counts[0].asset_count),
      updatedAt: counts[0].updated_at.toISOString(),
    },
    scenes,
    assets: await assetsOfProject(project.projectId),
  });
}

async function createScene(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const project = await requireProject(ctx.params.pid, account.id);
  if (!canEditScenes(project.role)) throw faults.forbidden();
  const body = ctx.body();
  const name = requireDomainName(body, 'name');
  const template = readString(body, 'template') as SceneTemplate;
  if (!SCENE_TEMPLATES.includes(template))
    throw faults.validation({ template: fieldCopy.name });

  const document = templateDocument(name, template);
  const text = canonicalDocument(document);
  const stateHash = stepZeroHash(document);
  const id = newId();
  await query(
    `insert into scenes (id, project_id, name, status, revision, state_hash, document)
     values ($1,$2,$3,'draft',1,$4,$5)`,
    [id, project.projectId, name, stateHash, text],
  );
  await query(
    `insert into revisions (scene_id, revision, document, ops, changed_keys, state_hash)
     values ($1,1,$2,$3,$4,$5)`,
    [id, text, JSON.stringify([]), [], stateHash],
  );
  await query('update projects set updated_at = now() where id = $1', [project.projectId]);
  await recordActivity(project.workspaceId, account.id, 'scene.created', name);
  return created({
    scene: { id, name, status: 'draft', revision: 1, stateHash },
  });
}

export const projectRoutes: readonly Route[] = [
  { method: 'GET', pattern: '/api/workspaces/:wid/projects', handler: listProjects },
  { method: 'POST', pattern: '/api/workspaces/:wid/projects', handler: createProject },
  { method: 'GET', pattern: '/api/projects/:pid', handler: getProject },
  { method: 'POST', pattern: '/api/projects/:pid/scenes', handler: createScene },
];
