// Derived feature counters, recomputed from the linked insights on every read (brief: Derived counters).
import type { Importance } from "../../shared/api.js";
import type { Queryable } from "../db.js";

const IMPORTANCE_POINTS: Record<Importance, number> = { nice_to_have: 1, important: 3, critical: 5 };
export const IMPORTANCES = Object.keys(IMPORTANCE_POINTS) as Importance[];

export interface Counters { insightCount: number; companyCount: number; impact: number }

export const NO_EVIDENCE: Counters = { insightCount: 0, companyCount: 0, impact: 0 };

interface CounterRow { feature_id: string; insights: number; companies: number; nice: number; important: number; critical: number }

/** Counters for every feature of the workspace that has evidence; an insight's company is its note contact's company now. */
export async function workspaceCounters(q: Queryable, workspaceId: string): Promise<Map<string, Counters>> {
  const rows = await q.query<CounterRow>(
    `SELECT i.feature_id, count(*) AS insights, count(DISTINCT c.company_id) AS companies,
            count(*) FILTER (WHERE i.importance = 'nice_to_have') AS nice,
            count(*) FILTER (WHERE i.importance = 'important') AS important,
            count(*) FILTER (WHERE i.importance = 'critical') AS critical
       FROM insights i JOIN notes n ON n.id = i.note_id LEFT JOIN contacts c ON c.id = n.contact_id
      WHERE i.workspace_id = $1
      GROUP BY i.feature_id`,
    [workspaceId],
  );
  return new Map(rows.map((r) => [r.feature_id, {
    insightCount: r.insights,
    companyCount: r.companies,
    impact: r.nice * IMPORTANCE_POINTS.nice_to_have + r.important * IMPORTANCE_POINTS.important + r.critical * IMPORTANCE_POINTS.critical,
  }]));
}
