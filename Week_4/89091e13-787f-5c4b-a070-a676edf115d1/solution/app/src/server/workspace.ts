import { maybeOne, rows, type Db } from "./db.ts";
import type { Role } from "../shared/api.ts";

export async function latestHeight(db: Db, workspaceId: string): Promise<number> {
  return (await maybeOne<{ height: number }>(db, "SELECT COALESCE(MAX(height), 0)::int AS height FROM blocks WHERE workspace_id = $1", [workspaceId]))?.height ?? 0;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Members in the order they joined. */
export async function membersOf(db: Db, workspaceId: string): Promise<MemberRow[]> {
  return rows<MemberRow>(
    db,
    `SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 ORDER BY m.joined_at, m.seq`,
    [workspaceId],
  );
}

export async function workspaceName(db: Db, workspaceId: string): Promise<string> {
  return (await maybeOne<{ name: string }>(db, "SELECT name FROM workspaces WHERE id = $1", [workspaceId]))?.name ?? "";
}
