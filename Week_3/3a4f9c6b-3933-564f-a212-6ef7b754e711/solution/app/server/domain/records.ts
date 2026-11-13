// Promotion rows and the promotion object the API answers with.
import { type Counter, type DiffEntry, type FreezeBreak, type HistoryEntry, type Overrides, type Promotion, type PromotionState, type WindowDecision, shortDigest } from "../../shared/api.js";
import type { Db, Tx } from "../db.js";
import { counters } from "./health.js";
import { railOf } from "./rail.js";

interface TimelinePoint { at: string; phase: "applying" | "health_wait"; in_sync: number; total: number }

export interface PromotionRow {
  id: string;
  project_id: string;
  stage_id: string;
  kind: "promotion" | "rollback";
  state: PromotionState;
  bundle_id: string;
  overrides: Overrides;
  requested_by: string;
  requested_at: Date;
  policy_version: number;
  diff: DiffEntry[];
  approval_state: "pending" | "approved" | "rejected" | "expired" | null;
  request_expires_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  approval_expires_at: Date | null;
  approval_comment: string | null;
  window_decisions: WindowDecision[];
  freeze_break: FreezeBreak | null;
  restores: string | null;
  entered_applying_at: Date | null;
  healthy_at: Date | null;
  failed_progress: number | null;
  health_timeline: TimelinePoint[];
}

interface Joined extends PromotionRow {
  project_slug: string;
  stage_name: string;
  cluster_name: string;
  time_zone: string;
  version: string;
  digest: string;
  source_commit: string;
  requester_email: string;
  requester_name: string;
  decider_email: string | null;
  decider_name: string | null;
  stored_snapshots: number;
  queued_snapshots: number;
}

export interface Loaded { view: Promotion; row: Joined }

export async function lockPromotion(tx: Tx, id: string): Promise<PromotionRow> {
  const { rows } = await tx.query<PromotionRow>("SELECT * FROM promotions WHERE id = $1 FOR UPDATE", [id]);
  return rows[0] as PromotionRow;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Promotion objects in the order of `ids`. */
export async function loadPromotions(db: Db, ids: string[]): Promise<Loaded[]> {
  if (ids.length === 0) return [];
  const [{ rows }, history, counted] = await Promise.all([
    db.query<Joined>(
      `SELECT x.*, p.slug AS project_slug, s.name AS stage_name, c.name AS cluster_name, c.time_zone,
              b.version, b.digest, b.source_commit, r.email AS requester_email, r.name AS requester_name,
              d.email AS decider_email, d.name AS decider_name,
              (SELECT count(*)::int FROM evidence_snapshots e WHERE e.promotion_id = x.id AND e.stored_at IS NOT NULL) AS stored_snapshots,
              (SELECT count(*)::int FROM evidence_snapshots e WHERE e.promotion_id = x.id AND e.stored_at IS NULL) AS queued_snapshots
         FROM promotions x JOIN projects p ON p.id = x.project_id JOIN stages s ON s.id = x.stage_id
         JOIN clusters c ON c.id = s.cluster_id JOIN bundles b ON b.id = x.bundle_id JOIN users r ON r.id = x.requested_by
         LEFT JOIN users d ON d.id = x.decided_by
        WHERE x.id = ANY($1)`, [ids]),
    db.query<{ promotion_id: string; from_state: PromotionState | null; to_state: PromotionState; at: Date; actor: string }>(
      "SELECT promotion_id, from_state, to_state, at, actor FROM promotion_history WHERE promotion_id = ANY($1) ORDER BY id", [ids]),
    counters(db, ids),
  ]);
  const entries = new Map<string, HistoryEntry[]>();
  for (const h of history.rows) {
    const list = entries.get(h.promotion_id) ?? [];
    list.push({ from: h.from_state, to: h.to_state, at: h.at.toISOString(), by: h.actor });
    entries.set(h.promotion_id, list);
  }
  const byId = new Map(rows.map((row) => {
    const counter: Counter | null = row.entered_applying_at ? counted.get(row.id) ?? null : null;
    const view: Promotion = {
      id: row.id,
      project: row.project_slug,
      stage: row.stage_name,
      cluster: row.cluster_name,
      time_zone: row.time_zone,
      kind: row.kind,
      state: row.state,
      ...railOf(row.state, counter, row.failed_progress),
      bundle: { version: row.version, digest: row.digest, short_digest: shortDigest(row.digest), source_commit: row.source_commit },
      overrides: row.overrides,
      requested_by: { email: row.requester_email, name: row.requester_name },
      requested_at: row.requested_at.toISOString(),
      policy_version: row.policy_version,
      approval: row.approval_state && row.request_expires_at ? {
        state: row.approval_state,
        request_expires_at: row.request_expires_at.toISOString(),
        decided_by: row.decider_email && row.decider_name ? { email: row.decider_email, name: row.decider_name } : null,
        decided_at: iso(row.decided_at),
        expires_at: iso(row.approval_expires_at),
        comment: row.approval_comment,
      } : null,
      window_decision: row.window_decisions.at(-1) ?? null,
      freeze_break: row.freeze_break,
      restores: row.restores,
      counter,
      evidence: { stored_snapshots: row.stored_snapshots, queued_snapshots: row.queued_snapshots },
      diff: row.diff,
      history: entries.get(row.id) ?? [],
    };
    return [row.id, { view, row }] as const;
  }));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
