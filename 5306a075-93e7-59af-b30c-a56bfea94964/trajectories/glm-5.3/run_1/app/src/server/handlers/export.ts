import { route, type Route, type RequestContext } from "../router.js";
import { exportLine } from "../../shared/csv.js";
import { buildFeatureSummaries, loadFeatureRows, loadObjectives } from "../features.js";

/** Two decimals with trailing zeros, as the API form. */
function two(value: number): string {
  return value.toFixed(2);
}

export const exportRoutes: Route[] = [
  {
    pattern: route("exports/features.csv"),
    methods: ["GET"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const client = await ctx.pool.connect();
      try {
        const rows = await loadFeatureRows(client, workspaceId);
        const objectives = await loadObjectives(client, workspaceId);
        const summaries = buildFeatureSummaries(
          rows.filter((r) => r.parent_feature_id === null),
          objectives,
        );
        summaries.sort((a, b) => a.rank - b.rank);

        const names = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM products WHERE workspace_id = $1",
          [workspaceId],
        );
        const products = new Map(names.rows.map((p) => [p.id, p.name]));
        const components = await client.query<{
          id: string;
          name: string;
          product_id: string;
        }>("SELECT id, name, product_id FROM components");
        const componentById = new Map(
          components.rows.map((c) => [c.id, { name: c.name, productId: c.product_id }]),
        );
        const releases = await client.query<{ id: string; name: string; target_date: string }>(
          "SELECT id, name, target_date::text AS target_date FROM releases WHERE workspace_id = $1",
          [workspaceId],
        );
        const releaseById = new Map(releases.rows.map((r) => [r.id, r]));

        const quotes = await client.query<{
          feature_id: string;
          quote: string;
          importance: string;
          created_at: Date;
          id: string;
        }>(
          `SELECT feature_id, quote, importance, created_at, id FROM insights
           WHERE workspace_id = $1
           ORDER BY feature_id,
             CASE importance WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
             created_at DESC, id DESC`,
          [workspaceId],
        );
        const quotesByFeature = new Map<string, string[]>();
        for (const q of quotes.rows) {
          const list = quotesByFeature.get(q.feature_id) ?? [];
          list.push(q.quote);
          quotesByFeature.set(q.feature_id, list);
        }

        const lines: string[] = [
          exportLine([
            "rank",
            "feature",
            "product",
            "component",
            "status",
            "release",
            "target_month",
            "insight_count",
            "company_count",
            "impact",
            "effort",
            "confidence",
            "objective_fit",
            "priority",
            "top_quote_1",
            "top_quote_2",
            "top_quote_3",
          ]),
        ];
        for (const f of summaries) {
          const component = componentById.get(f.componentId);
          const product = component === undefined ? "" : (products.get(component.productId) ?? "");
          const release = f.releaseId === null ? undefined : releaseById.get(f.releaseId);
          const quotesList = quotesByFeature.get(f.id) ?? [];
          lines.push(
            exportLine([
              String(f.rank),
              f.name,
              product,
              component?.name ?? "",
              f.status,
              release?.name ?? "",
              release === undefined ? "" : release.target_date.slice(0, 7),
              String(f.insightCount),
              String(f.companyCount),
              String(f.impact),
              String(f.effort),
              String(f.confidence),
              two(f.objectiveFit),
              two(f.priority),
              quotesList[0] ?? "",
              quotesList[1] ?? "",
              quotesList[2] ?? "",
            ]),
          );
        }
        const body = lines.join("");
        return {
          status: 200,
          body,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="evidence-desk-features.csv"',
            "Cache-Control": "no-store",
          },
        };
      } finally {
        client.release();
      }
    },
  },
];
