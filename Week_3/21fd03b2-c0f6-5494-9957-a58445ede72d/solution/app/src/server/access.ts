import { pool, one, type Db } from "./db";
import { forbidden, notFound } from "./errors";
import type { User } from "./http";

export type Role = "owner" | "editor" | "viewer";

export interface SceneRow {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  status: "draft" | "checkpointed" | "published" | "unpublished";
  revision: number;
  restore_revision: number;
  state_hash: string;
}

async function roleIn(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const row = await one<{ role: Role }>(db, "SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return row?.role ?? null;
}

/** A workspace the caller is not a member of is indistinguishable from one that does not exist. */
export async function requireMember(workspaceId: string, user: User): Promise<Role> {
  const role = await roleIn(pool, workspaceId, user.id);
  if (!role) throw notFound();
  return role;
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw forbidden();
}

export const CAN_EDIT: readonly Role[] = ["owner", "editor"];
export const OWNER_ONLY: readonly Role[] = ["owner"];

export async function projectAccess(projectId: string, user: User): Promise<{ workspaceId: string; role: Role; name: string }> {
  const project = await one<{ workspace_id: string; name: string }>(pool, "SELECT workspace_id, name FROM projects WHERE id = $1", [projectId]);
  if (!project) throw notFound();
  return { workspaceId: project.workspace_id, role: await requireMember(project.workspace_id, user), name: project.name };
}

export async function sceneAccess(sceneId: string, user: User, db: Db = pool): Promise<{ scene: SceneRow; role: Role }> {
  const scene = await one<SceneRow>(db, "SELECT id, project_id, workspace_id, name, status, revision, restore_revision, state_hash FROM scenes WHERE id = $1", [sceneId]);
  if (!scene) throw notFound();
  return { scene, role: await requireMember(scene.workspace_id, user) };
}

export async function logActivity(db: Db, workspaceId: string, actorId: string, action: string, targetName: string, at: Date): Promise<void> {
  await db.query("INSERT INTO activity (workspace_id, actor_id, action, target_name, at) VALUES ($1,$2,$3,$4,$5)", [workspaceId, actorId, action, targetName, at]);
}
