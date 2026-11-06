import { randomUUID } from "node:crypto";
import type { FeatureStatus, FeatureSummary, RequestedBy, SubfeatureRef } from "../../shared/types.js";
import { computeObjectiveFit, computePriority, round2 } from "../../shared/ranking.js";
import { errors, NO_SUCH_RECORD } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";
import {
  buildFeatureSummaries,
  loadFeatureRows,
  loadObjectives,
  loadScoreVersions,
  loadSubfeatures,
} from "../features.js";

/** Legal feature status edges (DP-24). */
const FEATURE_EDGES: Record<string, string[]> = {
  candidate: ["planned", "archived"],
  planned: ["in_progress", "archived"],
  in_progress: ["archived"],
  released: ["archived"],
  archived: [],
};

export const featureRoutes: Route[] = [
  {
    pattern: route("hierarchy"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const client = await ctx.pool.connect();
      try {
        const products = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM products WHERE workspace_id = $1 ORDER BY position, created_at",
          [ctx.member!.workspaceId],
        );
        const components = await client.query<{
          id: string;
          product_id: string;
          name: string;
        }>(
          "SELECT id, product_id, name FROM components WHERE workspace_id = $1 ORDER BY position, created_at",
          [ctx.member!.workspaceId],
        );
        const rows = await loadFeatureRows(client, ctx.member!.workspaceId);
        const objectives = await loadObjectives(client, ctx.member!.workspaceId);
        const topRows = rows.filter((r) => r.parent_feature_id === null);
        const summaries = new Map(
          buildFeatureSummaries(topRows, objectives).map((s) => [s.id, s]),
        );
        const subfeaturesByParent = new Map<string, SubfeatureRef[]>();
        for (const row of rows) {
          if (row.parent_feature_id === null) continue;
          const list = subfeaturesByParent.get(row.parent_feature_id) ?? [];
          list.push({ id: row.id, name: row.name, status: row.status });
          subfeaturesByParent.set(row.parent_feature_id, list);
        }
        const result = products.rows.map((p) => ({
          id: p.id,
          name: p.name,
          components: components.rows
            .filter((c) => c.product_id === p.id)
            .map((c) => ({
              id: c.id,
              name: c.name,
              features: [...summaries.values()]
                .filter((f) => f.componentId === c.id)
                .sort((a, b) => a.rank - b.rank)
                .map((f) => ({
                  ...f,
                  subfeatures: subfeaturesByParent.get(f.id) ?? [],
                })),
            })),
        }));
        return { status: 200, body: { products: result } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("products"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      if (name.length < 1 || name.length > 120) {
        throw errors.validationFailed({ name: "Add a product name." });
      }
      const id = randomUUID();
      await ctx.pool.query(
        "INSERT INTO products (id, workspace_id, name, position) VALUES ($1, $2, $3, 0)",
        [id, ctx.member!.workspaceId, name],
      );
      await audit(ctx.pool, ctx.member!.workspaceId, ctx.member!.id, "create_product", "product", id, null);
      return { status: 201, body: { product: { id, name } } };
    },
  },
  {
    pattern: route("components"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      const productId = typeof ctx.body.productId === "string" ? ctx.body.productId : null;
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 120) fields.name = "Add a component name.";
      if (productId === null) fields.productId = NO_SUCH_RECORD;
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
      const found = await ctx.pool.query(
        "SELECT id FROM products WHERE id = $1 AND workspace_id = $2",
        [productId, ctx.member!.workspaceId],
      );
      if (found.rowCount === 0) throw errors.validationFailed({ productId: NO_SUCH_RECORD });
      const id = randomUUID();
      await ctx.pool.query(
        "INSERT INTO components (id, workspace_id, product_id, name, position) VALUES ($1, $2, $3, $4, 0)",
        [id, ctx.member!.workspaceId, productId, name],
      );
      await audit(ctx.pool, ctx.member!.workspaceId, ctx.member!.id, "create_component", "component", id, null);
      return { status: 201, body: { component: { id, productId, name } } };
    },
  },
  {
    pattern: route("features"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      const publicDescription =
        typeof ctx.body.publicDescription === "string" ? ctx.body.publicDescription : "";
      const componentId = typeof ctx.body.componentId === "string" ? ctx.body.componentId : null;
      const parentFeatureId =
        typeof ctx.body.parentFeatureId === "string" ? ctx.body.parentFeatureId : null;

      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 120) fields.name = "Add a feature name.";
      if (publicDescription.length > 500) {
        fields.publicDescription = "Keep the public description under 500 characters.";
      }
      if (componentId === null) fields.componentId = NO_SUCH_RECORD;
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const client = await ctx.pool.connect();
      try {
        const component = await client.query<{ id: string }>(
          "SELECT id FROM components WHERE id = $1 AND workspace_id = $2",
          [componentId, workspaceId],
        );
        if (component.rowCount === 0) throw errors.validationFailed({ componentId: NO_SUCH_RECORD });

        if (parentFeatureId !== null) {
          const parent = await client.query<{ component_id: string; parent_feature_id: string | null }>(
            "SELECT component_id, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2",
            [parentFeatureId, workspaceId],
          );
          const parentRow = parent.rows[0];
          if (parentRow === undefined || parentRow.parent_feature_id !== null) {
            throw errors.validationFailed({ parentFeatureId: NO_SUCH_RECORD });
          }
        }

        // Feature names are unique per workspace ignoring case (DP-50).
        const clash = await client.query(
          "SELECT id FROM features WHERE workspace_id = $1 AND lower(name) = lower($2)",
          [workspaceId, name],
        );
        if (clash.rowCount !== 0) {
          throw errors.validationFailed({ name: "A feature with this name already exists." });
        }

        const id = randomUUID();
        const objectives = await loadObjectives(client, workspaceId);
        const fits: Record<string, number> = {};
        for (const o of objectives) fits[o.id] = 0;
        await client.query(
          `INSERT INTO features (id, workspace_id, component_id, parent_feature_id, name,
             public_description, status, effort, confidence, fits, version)
           VALUES ($1, $2, $3, $4, $5, $6, 'candidate', 5, 50, $7, 1)`,
          [id, workspaceId, componentId, parentFeatureId, name, publicDescription, JSON.stringify(fits)],
        );
        await client.query(
          `INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority, saved_by)
           VALUES ($1, 1, 5, 50, $2, 0, NULL)`,
          [id, JSON.stringify(fits)],
        );
        await audit(client, workspaceId, ctx.member!.id, "create_feature", "feature", id, { name });
        const rows = await loadFeatureRows(client, workspaceId);
        const summaries = buildFeatureSummaries(
          rows.filter((r) => r.parent_feature_id === null),
          await loadObjectives(client, workspaceId),
        );
        const summary = summaries.find((s) => s.id === id);
        if (summary === undefined) throw errors.notFound();
        return { status: 201, body: { feature: summary } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("features"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const q = ctx.query.get("q");
      if (q !== null && q.length > 100) {
        throw errors.validationFailed({ q: "Keep the search under 100 characters." });
      }
      const client = await ctx.pool.connect();
      try {
        const rows = await loadFeatureRows(client, ctx.member!.workspaceId);
        const objectives = await loadObjectives(client, ctx.member!.workspaceId);
        let summaries = buildFeatureSummaries(
          rows.filter((r) => r.parent_feature_id === null),
          objectives,
        );
        if (q !== null) {
          const needle = q.toLowerCase();
          summaries = summaries.filter(
            (s) =>
              s.name.toLowerCase().includes(needle) ||
              s.publicDescription.toLowerCase().includes(needle),
          );
        }
        summaries.sort((a, b) => a.rank - b.rank);
        return { status: 200, body: { features: summaries } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("features/:id"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const client = await ctx.pool.connect();
      try {
        const detail = await loadFeatureDetail(client, ctx.member!.workspaceId, ctx.params.id!);
        return { status: 200, body: { feature: detail } };
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("features/:id"),
    methods: ["PATCH"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const name = ctx.body.name;
      const publicDescription = ctx.body.publicDescription;
      if (name === undefined && publicDescription === undefined) {
        throw errors.validationFailed({ name: "Add a feature name." });
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<{
          name: string;
          public_description: string;
          status: string;
          parent_feature_id: string | null;
        }>(
          "SELECT name, public_description, status, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [id, workspaceId],
        );
        const row = existing.rows[0];
        if (row === undefined) throw errors.notFound();

        const fields: Record<string, string> = {};
        if (name !== undefined) {
          if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) {
            fields.name = "Add a feature name.";
          }
        }
        if (publicDescription !== undefined) {
          if (typeof publicDescription !== "string" || publicDescription.length > 500) {
            fields.publicDescription = "Keep the public description under 500 characters.";
          }
        }
        if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

        const newName = name === undefined ? row.name : (name as string).trim();
        if (newName !== row.name) {
          const clash = await client.query(
            "SELECT id FROM features WHERE workspace_id = $1 AND lower(name) = lower($2) AND id <> $3",
            [workspaceId, newName, id],
          );
          if (clash.rowCount !== 0) {
            throw errors.validationFailed({ name: "A feature with this name already exists." });
          }
        }
        const newDescription =
          publicDescription === undefined
            ? row.public_description
            : (publicDescription as string);
        await client.query(
          "UPDATE features SET name = $1, public_description = $2 WHERE id = $3",
          [newName, newDescription, id],
        );
        await audit(client, workspaceId, ctx.member!.id, "rename_feature", "feature", id, {
          from: row.name,
          to: newName,
        });
        await client.query("COMMIT");
        const detail = await loadFeatureDetail(client, workspaceId, id);
        return { status: 200, body: { feature: detail } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("features/:id/scores"),
    methods: ["PATCH"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const version = ctx.body.version;
      const effort = ctx.body.effort;
      const confidence = ctx.body.confidence;
      const fits = ctx.body.fits;

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<{
          version: number;
          effort: number;
          confidence: number;
          fits: Record<string, number>;
          status: string;
        }>(
          `SELECT version, effort, confidence, fits, status FROM features
           WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [id, workspaceId],
        );
        const row = existing.rows[0];
        if (row === undefined) throw errors.notFound();

        const fields: Record<string, string> = {};
        if (version === undefined || !Number.isInteger(version) || (version as number) < 1) {
          fields.version = "Name the version you are changing.";
        }
        if (effort !== undefined) {
          if (!Number.isInteger(effort) || (effort as number) < 1 || (effort as number) > 100) {
            fields.effort = "Effort must be a whole number from 1 to 100.";
          }
        }
        if (confidence !== undefined) {
          if (
            !Number.isInteger(confidence) ||
            (confidence as number) < 10 ||
            (confidence as number) > 100
          ) {
            fields.confidence = "Confidence must be a whole number from 10 to 100.";
          }
        }
        const objectives = await loadObjectives(client, workspaceId);
        const objectiveIds = new Set(objectives.map((o) => o.id));
        let newFits: Record<string, number> | null = null;
        if (fits !== undefined) {
          if (fits === null || typeof fits !== "object" || Array.isArray(fits)) {
            fields.fits = "Name the objective and its fit.";
          } else {
            newFits = {};
            for (const [objectiveId, level] of Object.entries(fits as Record<string, unknown>)) {
              if (!objectiveIds.has(objectiveId) || !Number.isInteger(level) || (level as number) < 0 || (level as number) > 3) {
                fields.fits = "Name the objective and its fit.";
                break;
              }
              newFits[objectiveId] = level as number;
            }
          }
        }
        if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

        if ((version as number) !== row.version) {
          // The loser of a race reads the winner's committed current values.
          throw errors.versionConflict({
            version: row.version,
            effort: row.effort,
            confidence: row.confidence,
            fits: row.fits,
            priority: await priorityFor(client, workspaceId, id),
          });
        }

        const nextEffort = effort === undefined ? row.effort : (effort as number);
        const nextConfidence =
          confidence === undefined ? row.confidence : (confidence as number);
        const nextFits: Record<string, number> = { ...row.fits };
        if (newFits !== null) {
          for (const [objectiveId, level] of Object.entries(newFits)) {
            nextFits[objectiveId] = level;
          }
        }
        const nextVersion = row.version + 1;
        await client.query(
          "UPDATE features SET effort = $1, confidence = $2, fits = $3, version = $4 WHERE id = $5",
          [nextEffort, nextConfidence, JSON.stringify(nextFits), nextVersion, id],
        );
        // The priority computed at this commit is stored, never recomputed.
        const weights = objectives.map((o) => ({ id: o.id, weight: o.weight }));
        const impactRow = await client.query<{ impact: number }>(
          `SELECT coalesce(sum(CASE i.importance WHEN 'critical' THEN 5 WHEN 'important' THEN 3 ELSE 1 END), 0)::int AS impact
           FROM insights i WHERE i.feature_id = $1`,
          [id],
        );
        const fit = computeObjectiveFit(nextFits, weights);
        const priority = round2(
          computePriority(fit, impactRow.rows[0]!.impact, nextConfidence, nextEffort),
        );
        await client.query(
          `INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority, saved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            nextVersion,
            nextEffort,
            nextConfidence,
            JSON.stringify(nextFits),
            priority.toFixed(2),
            ctx.member!.id,
          ],
        );
        await audit(client, workspaceId, ctx.member!.id, "save_scores", "feature", id, {
          version: nextVersion,
        });
        await client.query("COMMIT");
        const detail = await loadFeatureDetail(client, workspaceId, id);
        return { status: 200, body: { feature: detail } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
  {
    pattern: route("features/:id/status"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const id = ctx.params.id!;
      const to = typeof ctx.body.to === "string" ? ctx.body.to : null;
      if (
        to === null ||
        (!["candidate", "planned", "in_progress", "released", "archived", "restore"].includes(to))
      ) {
        throw errors.validationFailed({ to: "Pick a status." });
      }
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query<{
          status: FeatureStatus;
          status_before_archive: FeatureStatus | null;
          release_id: string | null;
        }>(
          `SELECT status, status_before_archive, release_id FROM features
           WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
          [id, workspaceId],
        );
        const feature = row.rows[0];
        if (feature === undefined) throw errors.notFound();
        let target: FeatureStatus;
        if (to === "restore") {
          if (feature.status !== "archived") {
            throw errors.invalidTransition({ from: feature.status, to });
          }
          target = feature.status_before_archive ?? "candidate";
          await client.query(
            "UPDATE features SET status = $1, status_before_archive = NULL WHERE id = $2",
            [target, id],
          );
        } else {
          target = to as FeatureStatus;
          if (target === "released") {
            throw errors.invalidTransition({ from: feature.status, to });
          }
          if (!(FEATURE_EDGES[feature.status] ?? []).includes(target)) {
            throw errors.invalidTransition({ from: feature.status, to });
          }
          if (target === "archived" && feature.release_id !== null) {
            const rel = await client.query<{ status: string }>(
              "SELECT status FROM releases WHERE id = $1",
              [feature.release_id],
            );
            if (rel.rows[0]?.status === "frozen") throw errors.releaseFrozen();
            if (rel.rows[0]?.status === "open") {
              // Archiving removes the feature from its open release.
              await client.query(
                `UPDATE features SET release_id = NULL, release_position = 0 WHERE id = $1`,
                [id],
              );
              if (feature.release_id !== null) {
                await client.query(
                  "UPDATE releases SET order_version = order_version + 1 WHERE id = $1",
                  [feature.release_id],
                );
              }
            }
          }
          await client.query(
            "UPDATE features SET status = $1, status_before_archive = $2 WHERE id = $3",
            [target, feature.status, id],
          );
        }
        await audit(client, workspaceId, ctx.member!.id, "feature_status", "feature", id, {
          from: feature.status,
          to: target,
        });
        await client.query("COMMIT");
        const detail = await loadFeatureDetail(client, workspaceId, id);
        return { status: 200, body: { feature: detail } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

async function priorityFor(
  client: Parameters<typeof loadFeatureRows>[0],
  workspaceId: string,
  featureId: string,
): Promise<number> {
  const rows = await loadFeatureRows(client, workspaceId);
  const objectives = await loadObjectives(client, workspaceId);
  const summaries = buildFeatureSummaries(
    rows.filter((r) => r.parent_feature_id === null),
    objectives,
  );
  return summaries.find((s) => s.id === featureId)?.priority ?? 0;
}

export interface FeatureDetailResponse extends FeatureSummary {
  requestedBy: RequestedBy[];
  insights: unknown[];
  subfeatures: SubfeatureRef[];
  scoreVersions: unknown[];
}

export async function loadFeatureDetail(
  client: Parameters<typeof loadFeatureRows>[0],
  workspaceId: string,
  featureId: string,
): Promise<FeatureDetailResponse> {
  const rows = await loadFeatureRows(client, workspaceId);
  const objectives = await loadObjectives(client, workspaceId);
  const summaries = buildFeatureSummaries(
    rows.filter((r) => r.parent_feature_id === null),
    objectives,
  );
  const summary = summaries.find((s) => s.id === featureId);
  const base = await client.query<{
    name: string;
    status: FeatureStatus;
    parent_feature_id: string | null;
  }>(
    "SELECT name, status, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2",
    [featureId, workspaceId],
  );
  const baseRow = base.rows[0];
  if (baseRow === undefined) throw errors.notFound();
  const requestedBy = await client.query<{ company_id: string; company_name: string; insight_count: number }>(
    `SELECT ct.company_id, co.name AS company_name, count(*)::int AS insight_count
     FROM insights i
     JOIN notes n ON n.id = i.note_id
     JOIN contacts ct ON ct.id = n.contact_id
     JOIN companies co ON co.id = ct.company_id
     WHERE i.feature_id = $1
     GROUP BY ct.company_id, co.name
     ORDER BY co.name`,
    [featureId],
  );
  const insights = await client.query<{
    id: string;
    note_id: string;
    feature_id: string;
    feature_name: string;
    start_offset: number;
    end_offset: number;
    quote: string;
    importance: "nice_to_have" | "important" | "critical";
    company_id: string | null;
  }>(
    `SELECT i.id, i.note_id, i.feature_id, f.name AS feature_name, i.start_offset,
            i.end_offset, i.quote, i.importance, ct.company_id
     FROM insights i
     JOIN features f ON f.id = i.feature_id
     LEFT JOIN notes n ON n.id = i.note_id
     LEFT JOIN contacts ct ON ct.id = n.contact_id
     WHERE i.feature_id = $1
     ORDER BY i.created_at DESC, i.id DESC`,
    [featureId],
  );
  const subfeatures = await loadSubfeatures(client, featureId);
  const scoreVersions = await loadScoreVersions(client, featureId);

  if (baseRow.parent_feature_id !== null) {
    // A subfeature has no counts of its own.
    return {
      ...(summary ?? {
        id: featureId,
        name: baseRow.name,
        publicDescription: "",
        componentId: "",
        status: baseRow.status,
        releaseId: null,
        insightCount: 0,
        companyCount: 0,
        impact: 0,
        effort: 5,
        confidence: 50,
        fits: {},
        objectiveFit: 0,
        priority: 0,
        rank: 0,
        rankTotal: 0,
        version: 1,
      }),
      requestedBy: requestedBy.rows.map((r) => ({
        companyId: r.company_id,
        companyName: r.company_name,
        insightCount: r.insight_count,
      })),
      insights: insights.rows.map((i) => ({
        id: i.id,
        noteId: i.note_id,
        featureId: i.feature_id,
        featureName: i.feature_name,
        start: i.start_offset,
        end: i.end_offset,
        quote: i.quote,
        importance: i.importance,
        companyId: i.company_id,
      })),
      subfeatures,
      scoreVersions,
    };
  }
  if (summary === undefined) throw errors.notFound();
  return {
    ...summary,
    requestedBy: requestedBy.rows.map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      insightCount: r.insight_count,
    })),
    insights: insights.rows.map((i) => ({
      id: i.id,
      noteId: i.note_id,
      featureId: i.feature_id,
      featureName: i.feature_name,
      start: i.start_offset,
      end: i.end_offset,
      quote: i.quote,
      importance: i.importance,
      companyId: i.company_id,
    })),
    subfeatures,
    scoreVersions,
  };
}
