import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FeatureSummary, Importance } from "../../shared/types.js";
import { errors, NO_SUCH_RECORD } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import {
  buildFeatureSummaries,
  loadFeatureRows,
  loadObjectives,
  loadInsightsForNote,
} from "../features.js";
import { splitsSurrogatePair } from "../../shared/segments.js";

const IMPORTANCES: Importance[] = ["nice_to_have", "important", "critical"];
const MAX_QUOTE_CHARS = 2000;

function isImportance(value: string): value is Importance {
  return (IMPORTANCES as string[]).includes(value);
}

interface BeforeValues {
  impact: number;
  priority: number;
  rank: number;
}

async function currentSummaries(
  client: PoolClient,
  workspaceId: string,
): Promise<Map<string, FeatureSummary>> {
  const [rows, objectives] = await Promise.all([
    loadFeatureRows(client, workspaceId),
    loadObjectives(client, workspaceId),
  ]);
  return new Map(
    buildFeatureSummaries(rows, objectives).map((s) => [s.id, s]),
  );
}

function beforeValues(summary: FeatureSummary): BeforeValues {
  return { impact: summary.impact, priority: summary.priority, rank: summary.rank };
}

export const insightRoutes: Route[] = [
  {
    pattern: route("insights"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const noteId = typeof ctx.body.noteId === "string" ? ctx.body.noteId : null;
      if (noteId === null) throw errors.validationFailed({ noteId: NO_SUCH_RECORD });
      const featureId = typeof ctx.body.featureId === "string" ? ctx.body.featureId : null;
      if (featureId === null) throw errors.validationFailed({ featureId: NO_SUCH_RECORD });
      const start = ctx.body.start;
      const end = ctx.body.end;
      const importance = typeof ctx.body.importance === "string" ? ctx.body.importance : null;

      const fields: Record<string, string> = {};
      if (start === undefined || !Number.isInteger(start) || (start as number) < 0) {
        fields.start = "Pick the quote's start.";
      }
      if (end === undefined || !Number.isInteger(end)) {
        fields.end = "Pick the quote's end.";
      }
      if (importance === null || !isImportance(importance)) {
        fields.importance = "Pick an importance.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const startNum = start as number;
      const endNum = end as number;
      if (endNum <= startNum) {
        throw errors.validationFailed({ end: "Pick the quote's end." });
      }

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        // Lock the note row so simultaneous links on the same note queue up.
        const note = await client.query<{ id: string; text: string }>(
          "SELECT id, text FROM notes WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [noteId, workspaceId],
        );
        if (note.rowCount === 0) throw errors.validationFailed({ noteId: NO_SUCH_RECORD });
        const text = note.rows[0]!.text;
        if (endNum > text.length) {
          throw errors.validationFailed({ end: "Pick the quote's end." });
        }
        if (splitsSurrogatePair(text, startNum, endNum)) {
          throw errors.validationFailed({ start: "The quote covers a whole character." });
        }
        const quote = text.slice(startNum, endNum);
        if (quote.trim().length === 0) {
          throw errors.validationFailed({ start: "The quote needs some text." });
        }
        if (quote.length > MAX_QUOTE_CHARS) {
          throw errors.validationFailed({ end: "The quote is too long." });
        }
        const feature = await client.query<{
          id: string;
          status: string;
          parent_feature_id: string | null;
        }>(
          "SELECT id, status, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2",
          [featureId, workspaceId],
        );
        const featureRow = feature.rows[0];
        if (featureRow === undefined) throw errors.validationFailed({ featureId: NO_SUCH_RECORD });
        if (featureRow.status === "archived" || featureRow.parent_feature_id !== null) {
          throw errors.validationFailed({ featureId: NO_SUCH_RECORD });
        }

        // The same note, span and feature again is a duplicate (DP-53).
        const dup = await client.query<{ id: string }>(
          `SELECT id FROM insights
           WHERE note_id = $1 AND feature_id = $2 AND start_offset = $3 AND end_offset = $4`,
          [noteId, featureId, startNum, endNum],
        );
        if (dup.rowCount !== 0) throw errors.duplicateInsight();

        const before = await currentSummaries(client, workspaceId);
        const beforeSummary = before.get(featureId);
        if (beforeSummary === undefined) throw errors.validationFailed({ featureId: NO_SUCH_RECORD });

        const id = randomUUID();
        await client.query(
          `INSERT INTO insights (id, workspace_id, note_id, feature_id, start_offset, end_offset,
             quote, importance)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, workspaceId, noteId, featureId, startNum, endNum, quote, importance],
        );
        await audit(client, workspaceId, ctx.member!.id, "link_insight", "insight", id, {
          noteId,
          featureId,
        });
        const after = await currentSummaries(client, workspaceId);
        const afterSummary = after.get(featureId);
        if (afterSummary === undefined) throw errors.notFound();
        const insights = await loadInsightsForNote(client, noteId);
        const created = insights.find((i) => i.id === id)!;
        await client.query("COMMIT");
        return {
          status: 201,
          body: {
            insight: {
              id: created.id,
              noteId: created.note_id,
              featureId: created.feature_id,
              featureName: created.feature_name,
              start: created.start_offset,
              end: created.end_offset,
              quote: created.quote,
              importance: created.importance,
              companyId: created.company_id,
            },
            feature: afterSummary,
            before: beforeValues(beforeSummary),
          },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("insights/:id"),
    methods: ["PATCH"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const importance = typeof ctx.body.importance === "string" ? ctx.body.importance : null;
      if (importance === null || !isImportance(importance)) {
        throw errors.validationFailed({ importance: "Pick an importance." });
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ feature_id: string }>(
          "SELECT feature_id FROM insights WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (found.rowCount === 0) throw errors.notFound();
        const featureId = found.rows[0]!.feature_id;
        const before = await currentSummaries(client, workspaceId);
        const beforeSummary = before.get(featureId);
        if (beforeSummary === undefined) throw errors.notFound();
        await client.query("UPDATE insights SET importance = $1 WHERE id = $2", [importance, id]);
        await audit(client, workspaceId, ctx.member!.id, "change_importance", "insight", id, {
          importance,
        });
        const after = await currentSummaries(client, workspaceId);
        const afterSummary = after.get(featureId);
        if (afterSummary === undefined) throw errors.notFound();
        const updated = await client.query<{
          id: string;
          note_id: string;
          feature_id: string;
          feature_name: string;
          start_offset: number;
          end_offset: number;
          quote: string;
          importance: Importance;
          company_id: string | null;
        }>(
          `SELECT i.id, i.note_id, i.feature_id, f.name AS feature_name, i.start_offset,
                  i.end_offset, i.quote, i.importance, ct.company_id
           FROM insights i
           JOIN features f ON f.id = i.feature_id
           LEFT JOIN notes n ON n.id = i.note_id
           LEFT JOIN contacts ct ON ct.id = n.contact_id
           WHERE i.id = $1`,
          [id],
        );
        const u = updated.rows[0]!;
        await client.query("COMMIT");
        return {
          status: 200,
          body: {
            insight: {
              id: u.id,
              noteId: u.note_id,
              featureId: u.feature_id,
              featureName: u.feature_name,
              start: u.start_offset,
              end: u.end_offset,
              quote: u.quote,
              importance: u.importance,
              companyId: u.company_id,
            },
            feature: afterSummary,
            before: beforeValues(beforeSummary),
          },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("insights/:id"),
    methods: ["DELETE"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ feature_id: string }>(
          "SELECT feature_id FROM insights WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        if (found.rowCount === 0) throw errors.notFound();
        const featureId = found.rows[0]!.feature_id;
        const before = await currentSummaries(client, workspaceId);
        const beforeSummary = before.get(featureId);
        if (beforeSummary === undefined) throw errors.notFound();
        await client.query("DELETE FROM insights WHERE id = $1", [id]);
        await audit(client, workspaceId, ctx.member!.id, "unlink_insight", "insight", id, {
          featureId,
        });
        const after = await currentSummaries(client, workspaceId);
        const afterSummary = after.get(featureId);
        if (afterSummary === undefined) throw errors.notFound();
        await client.query("COMMIT");
        return {
          status: 200,
          body: { feature: afterSummary, before: beforeValues(beforeSummary) },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];
