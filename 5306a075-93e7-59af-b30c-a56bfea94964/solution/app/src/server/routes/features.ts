import type { FeatureDetail, Hierarchy } from "../../shared/api.js";
import { archiveEffect, FEATURE_STATUS_LABELS, featureTransition, type FeatureStatus, type FeatureTarget, type ReleaseStatus } from "../../shared/lifecycles.js";
import { db, isUniqueViolation, type Queryable } from "../db.js";
import { loadFeatures, publicSummary, type FeatureRow, FEATURE_COLUMNS } from "../domain/features.js";
import { asNumber } from "../domain/priority.js";
import { featuresMatching } from "../domain/search.js";
import { iso } from "../domain/time.js";
import { conflict, invalid, notFound } from "../http/errors.js";
import { ANY, H, HP, member, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { audit, insightsOfFeature } from "./records.js";

const NAME_TAKEN = "A feature with this name already exists.";
const NAME = { min: 1, max: 120, message: "Add a feature name." };
const DESCRIPTION = { min: 0, max: 500, message: "Keep the public description under 500 characters.", trim: false };
const WEIGHT = "Weight must be a whole number from 0 to 100.";
const TARGETS: FeatureTarget[] = ["candidate", "planned", "in_progress", "released", "archived", "restore"];

async function featureRow(q: Queryable, workspaceId: string, id: string): Promise<FeatureRow> {
  const [row] = await q.query<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
  if (!row) throw notFound();
  return row;
}

const featureOf = (ctx: MemberCtx): Promise<FeatureRow> => featureRow(db, ctx.session.workspace.id, ctx.params.id ?? "");

async function summaryJson(workspaceId: string, id: string) {
  return publicSummary((await loadFeatures(db, workspaceId)).summary(id));
}

export function featureRoutes(router: Router): void {
  router.add("/api/products", {
    POST: member({
      roles: HP,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const name = fields.text("name", { min: 1, max: 120, message: "Add a product name." });
        fields.check();
        const [product] = await db.query<{ id: string; name: string }>("INSERT INTO products (workspace_id, name) VALUES ($1, $2) RETURNING id, name", [ws, name]);
        await audit(db, ctx, ws, "product.created", product.id);
        return { status: 201, json: { product } };
      },
    }),
  });

  router.add("/api/components", {
    POST: member({
      roles: HP,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const products = new Set((await db.query<{ id: string }>("SELECT id FROM products WHERE workspace_id = $1", [ws])).map((p) => p.id));
        const productId = fields.id("productId", (id) => products.has(id));
        const name = fields.text("name", { min: 1, max: 120, message: "Add a component name." });
        fields.check();
        const [component] = await db.query<{ id: string; productId: string; name: string }>(
          `INSERT INTO components (workspace_id, product_id, name) VALUES ($1, $2, $3) RETURNING id, product_id AS "productId", name`,
          [ws, productId, name],
        );
        await audit(db, ctx, ws, "component.created", component.id);
        return { status: 201, json: { component } };
      },
    }),
  });

  router.add("/api/hierarchy", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const features = await loadFeatures(db, ws);
        const products = await db.query<{ id: string; name: string }>("SELECT id, name FROM products WHERE workspace_id = $1 ORDER BY created_at, id", [ws]);
        const components = await db.query<{ id: string; name: string; product_id: string }>(
          "SELECT id, name, product_id FROM components WHERE workspace_id = $1 ORDER BY created_at, id", [ws],
        );
        // Components (and products) follow their best-ranked feature, so a row whose rank changes slides in the rail;
        // branches without ranked features keep their creation order after the rest.
        const bestRank = (componentIds: readonly string[]): number =>
          features.ranked.find((f) => componentIds.includes(f.componentId))?.rank ?? Number.MAX_SAFE_INTEGER;
        const byBestRank = <T>(items: readonly T[], ids: (item: T) => string[]): T[] =>
          items.map((item, order) => ({ item, order, best: bestRank(ids(item)) }))
            .sort((a, b) => a.best - b.best || a.order - b.order)
            .map((entry) => entry.item);
        const productComponents = (productId: string) => components.filter((c) => c.product_id === productId);
        const hierarchy: Hierarchy = {
          products: byBestRank(products, (p) => productComponents(p.id).map((c) => c.id)).map((p) => ({
            id: p.id,
            name: p.name,
            components: byBestRank(productComponents(p.id), (c) => [c.id]).map((c) => ({
              id: c.id,
              name: c.name,
              features: features.ranked
                .filter((f) => f.componentId === c.id)
                .map((f) => ({ ...publicSummary(f), subfeatures: features.subfeatures(f.id) })),
            })),
          })),
        };
        return { status: 200, json: hierarchy };
      },
    }),
  });

  router.add("/api/features", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => {
        const q = ctx.url.searchParams.get("q") ?? "";
        if (q.length > 100) throw invalid({ q: "Search for at most 100 characters." });
        const ws = ctx.session.workspace.id;
        const matching = q === "" ? null : await featuresMatching(db, ws, q, false);
        const features = (await loadFeatures(db, ws)).ranked.filter((f) => matching === null || matching.has(f.id));
        return { status: 200, json: { features: features.map(publicSummary) } };
      },
    }),
    POST: member({
      roles: HP,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const components = new Set((await db.query<{ id: string }>("SELECT id FROM components WHERE workspace_id = $1", [ws])).map((c) => c.id));
        const componentId = fields.id("componentId", (id) => components.has(id));
        const name = fields.text("name", NAME);
        const publicDescription = fields.has("publicDescription") ? fields.text("publicDescription", DESCRIPTION) : "";
        const parentId = fields.raw("parentFeatureId");
        if (parentId !== undefined && parentId !== null) {
          const [parent] = typeof parentId === "string"
            ? await db.query<{ component_id: string; parent_feature_id: string | null }>(
              "SELECT component_id, parent_feature_id FROM features WHERE id = $1 AND workspace_id = $2", [parentId, ws])
            : [];
          if (!parent) fields.id("parentFeatureId", () => false);
          else if (parent.parent_feature_id !== null || parent.component_id !== componentId) {
            fields.fail("parentFeatureId", "Choose a top-level feature in the same component.");
          }
        }
        fields.check();
        try {
          const id = await db.transaction(async (tx) => {
            const [row] = await tx.query<{ id: string }>(
              `INSERT INTO features (workspace_id, component_id, parent_feature_id, name, public_description, status, effort, confidence)
               VALUES ($1, $2, $3, $4, $5, 'candidate', 5, 50) RETURNING id`,
              [ws, componentId, typeof parentId === "string" ? parentId : null, name, publicDescription],
            );
            const created = row.id;
            const summary = (await loadFeatures(tx, ws)).summary(created);
            await tx.query(
              "INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority_cents, saved_by) VALUES ($1, 1, 5, 50, $2, $3, $4)",
              [created, summary.fits, summary.priorityCents, ctx.session.member.id],
            );
            await audit(tx, ctx, ws, "feature.created", created, { name });
            return created;
          });
          return { status: 201, json: { feature: await summaryJson(ws, id) } };
        } catch (error) {
          if (isUniqueViolation(error)) throw invalid({ name: NAME_TAKEN });
          throw error;
        }
      },
    }),
  });

  router.add("/api/features/:id", {
    GET: member({
      roles: ANY,
      load: featureOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        const features = await loadFeatures(db, ws);
        const requestedBy = await db.query<{ companyId: string; companyName: string; insightCount: number }>(
          `SELECT co.id AS "companyId", co.name AS "companyName", count(*)::int AS "insightCount"
             FROM insights i JOIN notes n ON n.id = i.note_id JOIN contacts c ON c.id = n.contact_id JOIN companies co ON co.id = c.company_id
            WHERE i.feature_id = $1 GROUP BY co.id, co.name ORDER BY count(*) DESC, lower(co.name), co.id`,
          [row.id],
        );
        const versions = await db.query<{ version: number; effort: number; confidence: number; fits: Record<string, number>; priority_cents: number; saved_at: Date; saved_by: string | null }>(
          "SELECT version, effort, confidence, fits, priority_cents, saved_at, saved_by FROM score_versions WHERE feature_id = $1 ORDER BY version DESC",
          [row.id],
        );
        const feature: FeatureDetail = {
          ...publicSummary(features.summary(row.id)),
          requestedBy,
          insights: await insightsOfFeature(db, row.id),
          subfeatures: features.subfeatures(row.id),
          scoreVersions: versions.map((v) => ({
            version: v.version, effort: v.effort, confidence: v.confidence, fits: v.fits, priority: asNumber(v.priority_cents),
            savedAt: iso(v.saved_at), savedBy: v.saved_by,
          })),
        };
        return { status: 200, json: { feature } };
      },
    }),
    PATCH: member({
      roles: HP,
      load: featureOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const name = fields.has("name") ? fields.text("name", NAME) : row.name;
        const description = fields.has("publicDescription") ? fields.text("publicDescription", DESCRIPTION) : row.public_description;
        fields.check();
        try {
          await db.query("UPDATE features SET name = $2, public_description = $3 WHERE id = $1", [row.id, name, description]);
        } catch (error) {
          if (isUniqueViolation(error)) throw invalid({ name: NAME_TAKEN });
          throw error;
        }
        await audit(db, ctx, ws, "feature.renamed", row.id, { from: row.name, to: name });
        return { status: 200, json: { feature: await summaryJson(ws, row.id) } };
      },
    }),
  });

  router.add("/api/features/:id/scores", {
    PATCH: member({
      roles: HP,
      load: featureOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        const objectives = new Set((await db.query<{ id: string }>("SELECT id FROM objectives WHERE workspace_id = $1", [ws])).map((o) => o.id));
        const summary = await db.transaction(async (tx) => {
          const [locked] = await tx.query<{ version: number }>("SELECT version FROM features WHERE id = $1 FOR UPDATE", [row.id]);
          const fields = new Fields(ctx.body);
          const version = fields.integer("version", 0, Number.MAX_SAFE_INTEGER, "Send the version you are editing.");
          if (fields.ok("version") && version !== locked.version) {
            const current = (await loadFeatures(tx, ws)).summary(row.id);
            throw conflict("version_conflict", "Someone else saved these scores first.", {
              current: { version: current.version, effort: current.effort, confidence: current.confidence, fits: current.fits, priority: current.priority },
            });
          }
          const effort = fields.has("effort") ? fields.integer("effort", 1, 100, "Effort must be a whole number from 1 to 100.") : null;
          const confidence = fields.has("confidence") ? fields.integer("confidence", 10, 100, "Confidence must be a whole number from 10 to 100.") : null;
          const fits = fields.raw("fits");
          const fitEntries = typeof fits === "object" && fits !== null && !Array.isArray(fits) ? Object.entries(fits) : [];
          if (fits !== undefined && (typeof fits !== "object" || fits === null || Array.isArray(fits)
            || fitEntries.some(([id, level]) => !objectives.has(id) || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 3))) {
            fields.fail("fits", "Each fit must name an objective of this workspace with a level from 0 to 3.");
          }
          fields.check();
          await tx.query("UPDATE features SET effort = coalesce($2, effort), confidence = coalesce($3, confidence), version = version + 1 WHERE id = $1", [
            row.id, effort, confidence,
          ]);
          for (const [objectiveId, level] of fitEntries) {
            await tx.query(
              "INSERT INTO feature_fits (feature_id, objective_id, level) VALUES ($1, $2, $3) ON CONFLICT (feature_id, objective_id) DO UPDATE SET level = EXCLUDED.level",
              [row.id, objectiveId, Number(level)],
            );
          }
          const after = (await loadFeatures(tx, ws)).summary(row.id);
          await tx.query(
            "INSERT INTO score_versions (feature_id, version, effort, confidence, fits, priority_cents, saved_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [row.id, after.version, after.effort, after.confidence, after.fits, after.priorityCents, ctx.session.member.id],
          );
          await audit(tx, ctx, ws, "feature.scored", row.id, { version: after.version });
          return after;
        });
        return { status: 200, json: { feature: publicSummary(summary) } };
      },
    }),
  });

  router.add("/api/features/:id/status", {
    POST: member({
      roles: HP,
      load: featureOf,
      handle: async (ctx, row) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const to = fields.oneOf<FeatureTarget>("to", TARGETS, "Choose a status.");
        fields.check();
        await db.transaction(async (tx) => {
          const locked = await featureRow(tx, ws, row.id);
          const next = featureTransition(locked.status, to, locked.prior_status);
          if (next === null) {
            const toLabel = to === "restore" ? "its earlier status" : FEATURE_STATUS_LABELS[to];
            throw conflict("invalid_transition", `${locked.name} can't move from ${FEATURE_STATUS_LABELS[locked.status]} to ${toLabel}.`, {
              from: locked.status, to,
            });
          }
          let releaseId = locked.release_id;
          if (next === "archived" && releaseId !== null) {
            const [release] = await tx.query<{ status: ReleaseStatus }>("SELECT status FROM releases WHERE id = $1 FOR UPDATE", [releaseId]);
            const effect = archiveEffect(release.status);
            if (effect === "refuse") throw conflict("release_frozen", "Take this feature out of its frozen release before archiving it.");
            if (effect === "leave") {
              await tx.query("UPDATE features SET position = position - 1 WHERE release_id = $1 AND position > $2", [releaseId, locked.position]);
              await tx.query("UPDATE releases SET order_version = order_version + 1 WHERE id = $1", [releaseId]);
              releaseId = null;
            }
          }
          const prior: FeatureStatus | null = next === "archived" ? locked.status : null;
          await tx.query("UPDATE features SET status = $2, prior_status = $3, release_id = $4, position = CASE WHEN $4::text IS NULL THEN NULL ELSE position END WHERE id = $1", [
            row.id, next, prior, releaseId,
          ]);
          await audit(tx, ctx, ws, "feature.status", row.id, { from: locked.status, to: next });
        });
        return { status: 200, json: { feature: await summaryJson(ws, row.id) } };
      },
    }),
  });

  router.add("/api/objectives", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => ({
        status: 200,
        json: { objectives: await db.query("SELECT id, name, weight FROM objectives WHERE workspace_id = $1 ORDER BY created_at, id", [ctx.session.workspace.id]) },
      }),
    }),
    POST: member({
      roles: H,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const name = fields.text("name", { min: 1, max: 120, message: "Add an objective name." });
        const weight = fields.integer("weight", 0, 100, WEIGHT);
        fields.check();
        const [objective] = await db.query<{ id: string; name: string; weight: number }>("INSERT INTO objectives (workspace_id, name, weight) VALUES ($1, $2, $3) RETURNING id, name, weight", [ws, name, weight]);
        await audit(db, ctx, ws, "objective.created", objective.id, { weight });
        return { status: 201, json: { objective } };
      },
    }),
  });

  router.add("/api/objectives/:id", {
    PATCH: member({
      roles: H,
      load: async (ctx) => {
        const [objective] = await db.query<{ id: string; name: string; weight: number }>(
          "SELECT id, name, weight FROM objectives WHERE id = $1 AND workspace_id = $2", [ctx.params.id ?? "", ctx.session.workspace.id],
        );
        if (!objective) throw notFound();
        return objective;
      },
      handle: async (ctx, objective) => {
        const fields = new Fields(ctx.body);
        const name = fields.has("name") ? fields.text("name", { min: 1, max: 120, message: "Add an objective name." }) : objective.name;
        const weight = fields.has("weight") ? fields.integer("weight", 0, 100, WEIGHT) : objective.weight;
        fields.check();
        const [updated] = await db.query("UPDATE objectives SET name = $2, weight = $3 WHERE id = $1 RETURNING id, name, weight", [objective.id, name, weight]);
        await audit(db, ctx, ctx.session.workspace.id, "objective.updated", objective.id, { weight });
        return { status: 200, json: { objective: updated } };
      },
    }),
  });
}
