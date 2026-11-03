import { invalid } from "../shared/errors.js";
import type { DocBody, VersionSummary } from "../shared/types.js";
import { memberRole, requireEditor, workspaceOf } from "./access.js";
import type { User } from "./auth.js";
import { all, one, pool, transaction } from "./db.js";
import { commitRestore, insertVersion } from "./ops.js";
import { loadDoc } from "./workspaces.js";

interface VersionRow {
  id: string;
  name: string;
  author_id: string;
  author_name: string;
  created_at: Date;
  seq: number;
}

function summary(r: VersionRow): VersionSummary {
  return { id: r.id, name: r.name, author: { id: r.author_id, name: r.author_name }, createdAt: r.created_at.toISOString(), seq: r.seq };
}

/** History, newest first. */
export async function listVersions(user: User, workspaceId: string): Promise<VersionSummary[]> {
  await memberRole(user, workspaceId);
  const rows = await all<VersionRow>(pool, "SELECT id, name, author_id, author_name, created_at, seq FROM versions WHERE workspace_id = $1 ORDER BY position DESC", [workspaceId]);
  return rows.map(summary);
}

export async function saveVersion(user: User, workspaceId: string, body: Record<string, unknown>): Promise<VersionSummary> {
  requireEditor(await memberRole(user, workspaceId));
  const name = body.name;
  if (name !== undefined && (typeof name !== "string" || name.length < 1 || name.length > 80)) throw invalid({ name: "A version name is 1 to 80 characters." });
  return transaction(async (tx) => insertVersion(tx, workspaceId, { id: user.id, name: user.name }, await loadDoc(workspaceId, tx), (name as string | undefined) ?? null));
}

export async function getVersion(user: User, versionId: string): Promise<VersionSummary & { document: DocBody }> {
  const workspaceId = await workspaceOf("version", versionId);
  await memberRole(user, workspaceId);
  const row = await one<VersionRow & { document: DocBody }>(pool, "SELECT id, name, author_id, author_name, created_at, seq, document FROM versions WHERE id = $1", [versionId]);
  if (!row) throw new Error("version vanished");
  return { ...summary(row), document: row.document };
}

export async function restoreVersion(user: User, versionId: string): Promise<{ version: VersionSummary; seq: number }> {
  const workspaceId = await workspaceOf("version", versionId);
  requireEditor(await memberRole(user, workspaceId));
  const version = await one<{ id: string; name: string; document: DocBody }>(pool, "SELECT id, name, document FROM versions WHERE id = $1", [versionId]);
  if (!version) throw new Error("version vanished");
  const { seq, version: cut } = await commitRestore(user, workspaceId, version);
  return { version: cut, seq };
}
