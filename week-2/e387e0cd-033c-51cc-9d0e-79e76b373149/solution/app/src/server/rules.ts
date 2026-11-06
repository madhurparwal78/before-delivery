// Each workspace's rule book: threshold changes, and the rule in force at an instant.
import type { Db } from "./db.js";
import { one, rows } from "./db.js";
import type { Workspace } from "./workspaces.js";
import { isoInstant } from "../shared/format.js";

interface RuleInForce {
  thresholdCents: bigint;
  since: string;
}

/** The latest change that took effect at or before the instant. */
export async function ruleInForce(db: Db, workspace: Workspace, code: string, atMs: number): Promise<RuleInForce | null> {
  const found = await one<{ threshold_cents: bigint; takes_effect_on: string }>(db,
    `SELECT threshold_cents, takes_effect_on FROM threshold_changes
      WHERE workspace_slug = $1 AND jurisdiction_code = $2 AND takes_effect_at <= $3
      ORDER BY takes_effect_at DESC, announced_at DESC LIMIT 1`, [workspace.slug, code, new Date(atMs)]);
  return found && { thresholdCents: found.threshold_cents, since: found.takes_effect_on };
}

interface ChangeRow {
  id: string;
  jurisdiction_code: string;
  threshold_cents: bigint;
  takes_effect_on: string;
  takes_effect_at: Date;
  announced_by: string | null;
  announced_at: Date;
}

export function changeBody(c: ChangeRow, now: number) {
  return {
    id: c.id,
    thresholdCents: c.threshold_cents,
    takesEffectOn: c.takes_effect_on,
    takesEffectAt: isoInstant(c.takes_effect_at.getTime()),
    announcedBy: c.announced_by,
    announcedAt: isoInstant(c.announced_at.getTime()),
    state: c.takes_effect_at.getTime() <= now ? ("in_force" as const) : ("scheduled" as const),
  };
}

/** The rule book entries of one or every jurisdiction, in the reference table's order. */
export async function ruleBook(db: Db, workspace: Workspace, now: number, code?: string) {
  const jurisdictions = await rows<{ code: string; name: string; currency: string }>(db,
    "SELECT code, name, currency FROM jurisdictions WHERE $1::text IS NULL OR code = $1 ORDER BY position", [code ?? null]);
  const changes = await rows<ChangeRow>(db,
    "SELECT * FROM threshold_changes WHERE workspace_slug = $1 ORDER BY takes_effect_at, announced_at", [workspace.slug]);
  return Promise.all(jurisdictions.map(async (j) => {
    const rule = await ruleInForce(db, workspace, j.code, now);
    return {
      code: j.code,
      name: j.name,
      currency: j.currency,
      ruleInForce: rule && { thresholdCents: rule.thresholdCents, since: rule.since },
      changes: changes.filter((c) => c.jurisdiction_code === j.code).map((c) => changeBody(c, now)),
    };
  }));
}
