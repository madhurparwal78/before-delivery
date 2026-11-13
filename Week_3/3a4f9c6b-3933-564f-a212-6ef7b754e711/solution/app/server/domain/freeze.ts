// Freeze policy versions (brief: Freeze policy versions).
import type { Freeze, FreezeVersion } from "../../shared/api.js";
import type { Db } from "../db.js";
import type { PinnedPolicy } from "./windows.js";

/** The version in force at an instant: the highest-numbered version whose effective_from is at or before it. */
export async function policyInForce(db: Db, projectId: string, at: Date): Promise<PinnedPolicy> {
  const { rows } = await db.query<PinnedPolicy>(
    `SELECT version, freezes FROM freeze_policy_versions
      WHERE project_id = $1 AND effective_from <= $2 ORDER BY version DESC LIMIT 1`, [projectId, at]);
  return rows[0] ?? { version: 0, freezes: [] };
}

export async function pinnedPolicy(db: Db, projectId: string, version: number): Promise<PinnedPolicy> {
  const { rows } = await db.query<{ freezes: Freeze[] }>(
    "SELECT freezes FROM freeze_policy_versions WHERE project_id = $1 AND version = $2", [projectId, version]);
  return { version, freezes: rows[0]?.freezes ?? [] };
}

export async function policyVersions(db: Db, projectId: string): Promise<FreezeVersion[]> {
  const { rows } = await db.query<{ version: number; effective_from: Date; created_by: string; created_at: Date; freezes: Freeze[] }>(
    `SELECT f.version, f.effective_from, u.email AS created_by, f.created_at, f.freezes
       FROM freeze_policy_versions f JOIN users u ON u.id = f.created_by
      WHERE f.project_id = $1 ORDER BY f.version`, [projectId]);
  return rows.map((r) => ({ ...r, effective_from: r.effective_from.toISOString(), created_at: r.created_at.toISOString() }));
}
