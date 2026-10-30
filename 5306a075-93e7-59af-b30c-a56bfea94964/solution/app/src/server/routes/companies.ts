import type { CompanyDetail, CompanyRequest, SearchResults } from "../../shared/api.js";
import { monthOf } from "../../shared/months.js";
import { db } from "../db.js";
import { loadFeatures } from "../domain/features.js";
import { containsLiterally, featuresMatching, SEARCH_GROUP_CAP, snippet } from "../domain/search.js";
import { iso } from "../domain/time.js";
import { invalid, NO_SUCH_RECORD, notFound } from "../http/errors.js";
import { ANY, HP, member, type MemberCtx, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { audit, companies } from "./records.js";

async function companyOf(ctx: MemberCtx) {
  const [company] = await companies(db, ctx.session.workspace.id, ctx.params.id ?? "");
  if (!company) throw notFound();
  return company;
}

export function companyRoutes(router: Router): void {
  router.add("/api/companies", {
    GET: member({ roles: ANY, handle: async (ctx) => ({ status: 200, json: { companies: await companies(db, ctx.session.workspace.id) } }) }),
  });

  router.add("/api/companies/:id", {
    GET: member({
      roles: ANY,
      load: companyOf,
      handle: async (ctx, company) => {
        const ws = ctx.session.workspace.id;
        const features = await loadFeatures(db, ws);
        const asked = await db.query<{ feature_id: string; release_name: string | null; target_date: string | null }>(
          `SELECT DISTINCT i.feature_id, r.name AS release_name, r.target_date
             FROM insights i JOIN notes n ON n.id = i.note_id JOIN contacts c ON c.id = n.contact_id
             JOIN features f ON f.id = i.feature_id LEFT JOIN releases r ON r.id = f.release_id
            WHERE c.company_id = $1`,
          [company.id],
        );
        const requests: CompanyRequest[] = asked
          .map((a) => {
            const f = features.summary(a.feature_id);
            const released = f.status === "released";
            return {
              featureId: f.id, featureName: f.name, status: f.status,
              releaseName: released ? a.release_name : null, targetMonth: released && a.target_date ? monthOf(a.target_date) : null, shipped: released,
            };
          })
          .sort((a, b) => a.featureName.toLowerCase().localeCompare(b.featureName.toLowerCase()));
        const notes = await db.query<{ id: string; title: string; created_at: Date }>(
          `SELECT n.id, n.title, n.created_at FROM notes n JOIN contacts c ON c.id = n.contact_id
            WHERE c.company_id = $1 ORDER BY n.created_at DESC, n.id DESC`,
          [company.id],
        );
        const detail: CompanyDetail = { ...company, requests, notes: notes.map((n) => ({ id: n.id, title: n.title, createdAt: iso(n.created_at) })) };
        return { status: 200, json: { company: detail } };
      },
    }),
  });

  router.add("/api/companies/:id/merge", {
    POST: member({
      roles: HP,
      load: companyOf,
      handle: async (ctx, source) => {
        const ws = ctx.session.workspace.id;
        const fields = new Fields(ctx.body);
        const into = fields.raw("intoCompanyId");
        const [target] = typeof into === "string" ? await companies(db, ws, into) : [];
        if (!target) fields.fail("intoCompanyId", NO_SUCH_RECORD);
        else if (target.id === source.id) fields.fail("intoCompanyId", "Choose another company to merge into.");
        const { target: into_ } = fields.check({ target });
        await db.transaction(async (tx) => {
          await tx.query("SELECT id FROM companies WHERE id IN ($1, $2) ORDER BY id FOR UPDATE", [source.id, into_.id]);
          await tx.query("UPDATE contacts SET company_id = $2 WHERE company_id = $1", [source.id, into_.id]);
          await tx.query("UPDATE company_domains SET company_id = $2 WHERE company_id = $1", [source.id, into_.id]);
          await tx.query("DELETE FROM companies WHERE id = $1", [source.id]);
          await audit(tx, ctx, ws, "company.merged", source.id, { into: into_.id, name: source.name });
        });
        const [merged] = await companies(db, ws, into_.id);
        return { status: 200, json: { company: merged } };
      },
    }),
  });

  router.add("/api/search", {
    GET: member({
      roles: ANY,
      handle: async (ctx) => {
        const ws = ctx.session.workspace.id;
        const q = (ctx.url.searchParams.get("q") ?? "").trim();
        if (q.length < 2 || q.length > 100) throw invalid({ q: "Search for 2 to 100 characters." });
        const notes = await db.query<{ id: string; title: string; text: string }>(
          `SELECT n.id, n.title, n.text FROM notes n
            WHERE n.workspace_id = $1 AND (${containsLiterally("n.title", 2)} OR ${containsLiterally("n.text", 2)})
            ORDER BY n.created_at DESC, n.id DESC LIMIT ${SEARCH_GROUP_CAP}`,
          [ws, q],
        );
        const found = await db.query<{ id: string; name: string; domains: string[] }>(
          `SELECT co.id, co.name, coalesce(json_agg(d.domain ORDER BY d.domain) FILTER (WHERE d.domain IS NOT NULL), '[]'::json) AS domains
             FROM companies co LEFT JOIN company_domains d ON d.company_id = co.id
            WHERE co.workspace_id = $1
            GROUP BY co.id, co.name
           HAVING ${containsLiterally("co.name", 2)} OR bool_or(${containsLiterally("d.domain", 2)})
            ORDER BY lower(co.name), co.id LIMIT ${SEARCH_GROUP_CAP}`,
          [ws, q],
        );
        const matching = await featuresMatching(db, ws, q, true);
        const features = (await loadFeatures(db, ws)).ranked.filter((f) => matching.has(f.id)).slice(0, SEARCH_GROUP_CAP);
        const results: SearchResults = {
          notes: notes.map((n) => ({ id: n.id, title: n.title, snippet: snippet(n.text, q) })),
          companies: found,
          features: features.map((f) => ({ id: f.id, name: f.name, insightCount: f.insightCount, companyCount: f.companyCount })),
        };
        return { status: 200, json: results };
      },
    }),
  });
}
