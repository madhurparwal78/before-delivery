import { monthOf } from "../../shared/months.js";
import { db } from "../db.js";
import { csvText } from "../domain/csv.js";
import { loadFeatures } from "../domain/features.js";
import { asText } from "../domain/priority.js";
import { H, member, type Router } from "../http/router.js";
import { insightsOfFeature, releaseRows } from "./records.js";

const HEADER = ["rank", "feature", "product", "component", "status", "release", "target_month", "insight_count", "company_count",
  "impact", "effort", "confidence", "objective_fit", "priority", "top_quote_1", "top_quote_2", "top_quote_3"];

export function exportRoutes(router: Router): void {
  router.add("/api/exports/features.csv", {
    GET: member({
      roles: H,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const features = await loadFeatures(db, ws);
        const places = new Map((await db.query<{ id: string; product: string; component: string }>(
          "SELECT c.id, p.name AS product, c.name AS component FROM components c JOIN products p ON p.id = c.product_id WHERE c.workspace_id = $1",
          [ws],
        )).map((c) => [c.id, c]));
        const releases = new Map((await releaseRows(db, ws)).map((r) => [r.id, r]));
        const rows: (string | number | null)[][] = [HEADER];
        for (const f of features.ranked) {
          const place = places.get(f.componentId);
          const release = f.releaseId === null ? undefined : releases.get(f.releaseId);
          const quotes = (await insightsOfFeature(db, f.id)).slice(0, 3).map((i) => i.quote);
          const summary = features.summary(f.id);
          rows.push([
            f.rank, f.name, place?.product ?? "", place?.component ?? "", f.status, release?.name ?? "", release ? monthOf(release.target_date) : "",
            f.insightCount, f.companyCount, f.impact, f.effort, f.confidence, asText(summary.objectiveFitCents), asText(summary.priorityCents),
            quotes[0] ?? "", quotes[1] ?? "", quotes[2] ?? "",
          ]);
        }
        return {
          status: 200,
          body: csvText(rows),
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="evidence-desk-features.csv"', "Cache-Control": "no-store" },
        };
      },
    }),
  });
}
