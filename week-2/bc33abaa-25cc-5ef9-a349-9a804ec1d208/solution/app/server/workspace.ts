// Workspace records and the people messages go to.
import type { Workspace } from "../shared/api-types.js";
import { one, rows, type Db } from "./db.js";

export interface WorkspaceRow {
  id: string; name: string; time_zone: string; review_links_enabled: boolean; signing_secret: string; created_at: Date;
}

export async function loadWorkspace(db: Db, id: string): Promise<WorkspaceRow> {
  const row = await one<WorkspaceRow>(db, "SELECT * FROM workspaces WHERE id = $1", [id]);
  if (!row) throw new Error(`workspace ${id} is missing`);
  return row;
}

export const workspaceOut = (w: WorkspaceRow): Workspace =>
  ({ id: w.id, name: w.name, timeZone: w.time_zone, reviewLinksEnabled: w.review_links_enabled });

export const workspaceSummary = (w: WorkspaceRow) => ({ id: w.id, name: w.name, timeZone: w.time_zone });

/** The owner and every billing manager. */
export async function billingContacts(db: Db, workspaceId: string): Promise<string[]> {
  return (await rows<{ email: string }>(db,
    "SELECT email FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND role IN ('owner', 'billing_manager') ORDER BY joined_at",
    [workspaceId])).map((r) => r.email);
}

export async function ownerEmail(db: Db, workspaceId: string): Promise<string> {
  const row = await one<{ email: string }>(db, "SELECT email FROM members WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL", [workspaceId]);
  return row?.email ?? "";
}

export const isTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string" || zone === "") return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone.includes("/") || zone === "UTC"; } catch { return false; }
};
