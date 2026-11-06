import type { Importance, InsightChange } from "../../shared/api.js";
import { splitsSurrogatePair } from "../../shared/noteText.js";
import { db, isUniqueViolation, type Queryable } from "../db.js";
import { IMPORTANCES } from "../domain/evidence.js";
import { loadFeatures, publicSummary } from "../domain/features.js";
import { conflict, notFound } from "../http/errors.js";
import { HP, member, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { audit, insightById } from "./records.js";

const MAX_QUOTE = 2000;
const IMPORTANCE_MESSAGE = "Choose Nice to have, Important or Critical.";

const duplicate = (featureName: string) => conflict("duplicate_insight", `This quote is already linked to ${featureName}.`);

/**
 * Changes touching one feature commit one after another: the feature row is locked first, so each response's
 * `before` is the state just before its own commit and `feature` the state just after it.
 */
async function onFeature<T>(featureId: string, workspaceId: string, change: (tx: Queryable) => Promise<T>): Promise<InsightChange & { result: T }> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM features WHERE id = $1 FOR UPDATE", [featureId]);
    const before = (await loadFeatures(tx, workspaceId)).summary(featureId);
    const result = await change(tx);
    const after = (await loadFeatures(tx, workspaceId)).summary(featureId);
    return { result, feature: publicSummary(after), before: { impact: before.impact, priority: before.priority, rank: before.rank } };
  });
}

async function insightOf(ctx: MemberCtx) {
  const insight = await insightById(db, ctx.session.workspace.id, ctx.params.id ?? "");
  if (!insight) throw notFound();
  return insight;
}

export function insightRoutes(router: Router): void {
  router.add("/api/insights", {
    POST: member({
      roles: HP,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const [note] = typeof ctx.body.noteId === "string"
          ? await db.query<{ id: string; text: string }>("SELECT id, text FROM notes WHERE id = $1 AND workspace_id = $2", [ctx.body.noteId, ws])
          : [];
        fields.id("noteId", () => note !== undefined);
        const [feature] = typeof ctx.body.featureId === "string"
          ? await db.query<{ id: string; name: string; status: string; parent_feature_id: string | null }>(
            "SELECT id, name, status, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2", [ctx.body.featureId, ws])
          : [];
        fields.id("featureId", () => feature !== undefined);
        if (feature && (feature.status === "archived" || feature.parent_feature_id !== null)) {
          fields.fail("featureId", "Link quotes to a top-level feature that is not archived.");
        }
        const text = note?.text ?? "";
        const start = fields.integer("start", 0, Math.max(0, text.length - 1), "The quote must start inside the note text.");
        const end = fields.integer("end", 1, text.length, "The quote must end inside the note text.");
        if (fields.ok("start") && splitsSurrogatePair(text, start)) fields.fail("start", "The quote must not start inside a character.");
        if (fields.ok("end") && splitsSurrogatePair(text, end)) fields.fail("end", "The quote must not end inside a character.");
        const spanValid = ["noteId", "featureId", "start", "end"].every((f) => fields.ok(f));
        if (spanValid && start >= end) fields.fail("end", "The quote must end after it starts.");
        const quote = text.slice(start, end);
        if (fields.ok("end") && fields.ok("start") && quote.trim() === "") fields.fail("start", "Select at least one word.");
        if (fields.ok("end") && quote.length > MAX_QUOTE) fields.fail("end", `Quotes hold at most ${MAX_QUOTE} characters.`);
        const importance = fields.oneOf<Importance>("importance", IMPORTANCES, IMPORTANCE_MESSAGE);
        const { note: target, feature: chosen } = fields.check({ note, feature });
        try {
          const change = await onFeature(chosen.id, ws, async (tx) => {
            const [row] = await tx.query<{ id: string }>(
              `INSERT INTO insights (workspace_id, note_id, feature_id, start_offset, end_offset, quote, importance)
               VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
              [ws, target.id, chosen.id, start, end, quote, importance],
            );
            if (!row) throw duplicate(chosen.name);
            await audit(tx, ctx, ws, "insight.linked", row.id, { noteId: target.id, featureId: chosen.id, importance });
            return row.id;
          });
          const insight = await insightById(db, ws, change.result);
          return { status: 201, json: { insight, feature: change.feature, before: change.before } };
        } catch (error) {
          if (isUniqueViolation(error)) throw duplicate(chosen.name);
          throw error;
        }
      },
    }),
  });

  router.add("/api/insights/:id", {
    PATCH: member({
      roles: HP,
      load: insightOf,
      handle: async (ctx, insight) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const importance = fields.oneOf<Importance>("importance", IMPORTANCES, IMPORTANCE_MESSAGE);
        fields.check();
        const change = await onFeature(insight.featureId, ws, async (tx) => {
          const updated = await tx.query("UPDATE insights SET importance = $2 WHERE id = $1 RETURNING id", [insight.id, importance]);
          if (updated.length === 0) throw notFound();
          await audit(tx, ctx, ws, "insight.importance", insight.id, { importance });
        });
        return { status: 200, json: { insight: await insightById(db, ws, insight.id), feature: change.feature, before: change.before } };
      },
    }),
    DELETE: member({
      roles: HP,
      load: insightOf,
      handle: async (ctx, insight) => {
        const ws = ctx.session.workspace.id;
        const change = await onFeature(insight.featureId, ws, async (tx) => {
          const removed = await tx.query("DELETE FROM insights WHERE id = $1 RETURNING id", [insight.id]);
          if (removed.length === 0) throw notFound();
          await audit(tx, ctx, ws, "insight.unlinked", insight.id, { featureId: insight.featureId });
        });
        return { status: 200, json: { feature: change.feature, before: change.before } };
      },
    }),
  });
}
