import type { ActivityAction } from '../shared/activity.js';
import type { AssetRow, LabRecord, SceneRecord } from '../shared/api.js';
import { fieldCopy } from '../shared/copy.js';
import type { Json } from '../shared/canonical.js';

import type { SceneStatus, WorkspaceRole } from '../shared/states.js';
import type { AssetKind, ModelUnit } from '../shared/uploads.js';
import { publicAddress } from './config.js';
import { one, query } from './db.js';
import { faults } from './errors.js';
import { newId } from './ids.js';

export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

export interface SceneRow {
  id: string;
  project_id: string;
  name: string;
  status: SceneStatus;
  revision: number;
  state_hash: string;
  document: string;
  restore_revision: number;
}

export async function roleIn(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const row = await one<{ role: WorkspaceRole }>(
    'select role from memberships where workspace_id = $1 and user_id = $2',
    [workspaceId, userId],
  );
  return row ? row.role : null;
}

/** A workspace the caller is not a member of is indistinguishable from a missing one. */
export async function requireWorkspace(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceContext> {
  const row = await one<{ id: string; name: string; role: WorkspaceRole }>(
    `select w.id, w.name, m.role
       from workspaces w join memberships m on m.workspace_id = w.id
      where w.id = $1 and m.user_id = $2`,
    [workspaceId, userId],
  );
  if (!row) throw faults.notFound();
  return { workspaceId: row.id, workspaceName: row.name, role: row.role };
}

export async function requireProject(
  projectId: string,
  userId: string,
): Promise<WorkspaceContext & { projectId: string; projectName: string }> {
  const row = await one<{
    id: string;
    name: string;
    workspace_id: string;
    workspace_name: string;
    role: WorkspaceRole;
  }>(
    `select p.id, p.name, p.workspace_id, w.name as workspace_name, m.role
       from projects p
       join workspaces w on w.id = p.workspace_id
       join memberships m on m.workspace_id = p.workspace_id
      where p.id = $1 and m.user_id = $2`,
    [projectId, userId],
  );
  if (!row) throw faults.notFound();
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    projectId: row.id,
    projectName: row.name,
  };
}

export async function requireScene(
  sceneId: string,
  userId: string,
): Promise<WorkspaceContext & { scene: SceneRow; projectName: string }> {
  const row = await one<
    SceneRow & { workspace_id: string; workspace_name: string; role: WorkspaceRole; project_name: string }
  >(
    `select s.id, s.project_id, s.name, s.status, s.revision, s.state_hash, s.document,
            s.restore_revision, p.workspace_id, p.name as project_name,
            w.name as workspace_name, m.role
       from scenes s
       join projects p on p.id = s.project_id
       join workspaces w on w.id = p.workspace_id
       join memberships m on m.workspace_id = p.workspace_id
      where s.id = $1 and m.user_id = $2`,
    [sceneId, userId],
  );
  if (!row) throw faults.notFound();
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    projectName: row.project_name,
    scene: {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      status: row.status,
      revision: row.revision,
      state_hash: row.state_hash,
      document: row.document,
      restore_revision: row.restore_revision,
    },
  };
}

export async function sceneById(sceneId: string): Promise<SceneRow | null> {
  return one<SceneRow>(
    `select id, project_id, name, status, revision, state_hash, document, restore_revision
       from scenes where id = $1`,
    [sceneId],
  );
}

export async function labFor(sceneId: string): Promise<LabRecord | null> {
  const row = await one<{
    token: string;
    bundle_hash: string;
    published_at: Date;
    checkpoint_id: string;
    exposed: string[];
    active: boolean;
  }>(
    'select token, bundle_hash, published_at, checkpoint_id, exposed, active from labs where scene_id = $1',
    [sceneId],
  );
  if (!row || !row.active) return null;
  return {
    token: row.token,
    url: publicAddress(`/lab/${row.token}`),
    bundleHash: row.bundle_hash,
    publishedAt: row.published_at.toISOString(),
    checkpointId: row.checkpoint_id,
    exposed: row.exposed,
  };
}

export async function sceneRecord(scene: SceneRow): Promise<SceneRecord> {
  return {
    id: scene.id,
    projectId: scene.project_id,
    name: scene.name,
    status: scene.status,
    revision: scene.revision,
    stateHash: scene.state_hash,
    lab: await labFor(scene.id),
  };
}

export async function recordActivity(
  workspaceId: string,
  actorId: string,
  action: ActivityAction,
  targetName: string,
): Promise<void> {
  await query(
    'insert into activity (id, workspace_id, actor_id, action, target_name) values ($1,$2,$3,$4,$5)',
    [newId(), workspaceId, actorId, action, targetName],
  );
}

export interface AssetDbRow {
  id: string;
  project_id: string;
  name: string;
  kind: AssetKind;
  bytes: number;
  sha256: string;
  unit: ModelUnit | null;
  scale_to_metres: number | null;
  extent_metres: number | null;
  created_at: Date;
}

export function assetRow(row: AssetDbRow): AssetRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    bytes: row.bytes,
    sha256: row.sha256,
    unit: row.unit,
    scaleToMetres: row.scale_to_metres === null ? null : Number(row.scale_to_metres),
    extentMetres: row.extent_metres === null ? null : Number(row.extent_metres),
    createdAt: row.created_at.toISOString(),
  };
}

export async function assetsOfProject(projectId: string): Promise<AssetRow[]> {
  const rows = await query<AssetDbRow>(
    `select id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at
       from assets where project_id = $1 order by created_at`,
    [projectId],
  );
  return rows.map(assetRow);
}

/* ------------------------------------------------- boundary validation --- */

export function readString(body: Record<string, Json>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export function requireDomainName(body: Record<string, Json>, key: string, fieldKey = 'name'): string {
  const value = readString(body, key).trim();
  const points = [...value];
  if (points.length < 1 || points.length > 60)
    throw faults.validation({ [fieldKey]: fieldCopy.name });
  return value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function requireEmail(body: Record<string, Json>, key = 'email'): string {
  const value = readString(body, key).trim();
  if (!EMAIL_PATTERN.test(value) || value.length > 254)
    throw faults.validation({ email: fieldCopy.email });
  return value;
}

export function requireRole(body: Record<string, Json>, key = 'role'): 'editor' | 'viewer' {
  const value = readString(body, key);
  if (value !== 'editor' && value !== 'viewer') throw faults.validation({ role: fieldCopy.role });
  return value;
}
