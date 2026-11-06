import type { PoolClient } from "pg";
import type { CompanyDetail } from "../../shared/types.js";
import { errors, NO_SUCH_RECORD } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { audit } from "../audit.js";

export const companyRoutes: Route[] = [
  {
    pattern: route("companies"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const rows = await ctx.pool.query<CompanyRow>(
        `SELECT c.id, c.name,
                (SELECT array_agg(d.domain ORDER BY d.domain) FROM company_domains d WHERE d.company_id = c.id) AS domains,
                (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
                (SELECT count(*)::int FROM notes n JOIN contacts ct2 ON ct2.id = n.contact_id
                  WHERE ct2.company_id = c.id) AS note_count
         FROM companies c WHERE c.workspace_id = $1
         ORDER BY lower(c.name)`,
        [ctx.member!.workspaceId],
      );
      return {
        status: 200,
        body: {
          companies: rows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            domains: r.domains ?? [],
            contacts: [],
            noteCount: r.note_count,
          })),
        },
      };
    },
  },
  {
    pattern: route("companies/:id"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const company = await loadCompanyDetail(ctx.pool, ctx.member!.workspaceId, ctx.params.id!);
      return { status: 200, body: { company } };
    },
  },
  {
    pattern: route("companies/:id/merge"),
    methods: ["POST"],
    roles: ["head_of_product", "product_manager"],
    handler: async (ctx: RequestContext) => {
      const workspaceId = ctx.member!.workspaceId;
      const sourceId = ctx.params.id!;
      const intoCompanyId =
        typeof ctx.body.intoCompanyId === "string" ? ctx.body.intoCompanyId : null;
      if (intoCompanyId === null) throw errors.validationFailed({ intoCompanyId: NO_SUCH_RECORD });
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const source = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM companies WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [sourceId, workspaceId],
        );
        if (source.rowCount === 0) throw errors.notFound();
        if (sourceId === intoCompanyId) {
          throw errors.validationFailed({ intoCompanyId: NO_SUCH_RECORD });
        }
        const target = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM companies WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [intoCompanyId, workspaceId],
        );
        if (target.rowCount === 0) throw errors.validationFailed({ intoCompanyId: NO_SUCH_RECORD });

        // One transaction: contacts and domains move, the source goes away
        // (DP-10). Counters are recomputed on every read, so they follow.
        await client.query(
          "UPDATE contacts SET company_id = $1 WHERE company_id = $2 AND workspace_id = $3",
          [intoCompanyId, sourceId, workspaceId],
        );
        await client.query(
          `INSERT INTO company_domains (company_id, workspace_id, domain)
           SELECT $1, workspace_id, domain FROM company_domains WHERE company_id = $2
           ON CONFLICT (workspace_id, domain) DO NOTHING`,
          [intoCompanyId, sourceId],
        );
        await client.query("DELETE FROM company_domains WHERE company_id = $1", [sourceId]);
        await client.query("DELETE FROM companies WHERE id = $1 AND workspace_id = $2", [
          sourceId,
          workspaceId,
        ]);
        await audit(client, workspaceId, ctx.member!.id, "merge_companies", "company", sourceId, {
          intoCompanyId,
        });
        await client.query("COMMIT");
        const company = await loadCompanyDetail(client, workspaceId, intoCompanyId);
        return { status: 200, body: { company } };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  },
];

interface CompanyRow {
  id: string;
  name: string;
  domains: string[] | null;
  contact_count: number;
  note_count: number;
}

/** A company page: contacts, notes and the requests list (DP-29, DP-34). */
export async function loadCompanyDetail(
  pool: { query: PoolClient["query"] },
  workspaceId: string,
  companyId: string,
): Promise<CompanyDetail> {
  const company = await pool.query<CompanyRow & { time_zone: string }>(
    `SELECT c.id, c.name,
            (SELECT array_agg(d.domain ORDER BY d.domain) FROM company_domains d WHERE d.company_id = c.id) AS domains,
            (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
            (SELECT count(*)::int FROM notes n JOIN contacts ct2 ON ct2.id = n.contact_id
              WHERE ct2.company_id = c.id) AS note_count,
            w.time_zone
     FROM companies c JOIN workspaces w ON w.id = c.workspace_id
     WHERE c.id = $1 AND c.workspace_id = $2`,
    [companyId, workspaceId],
  );
  const row = company.rows[0];
  if (row === undefined) throw errors.notFound();
  const contacts = await pool.query<{ id: string; name: string; email: string }>(
    "SELECT id, name, email FROM contacts WHERE company_id = $1 AND workspace_id = $2 ORDER BY created_at",
    [companyId, workspaceId],
  );
  const requests = await pool.query<{
    feature_id: string;
    feature_name: string;
    status: string;
    release_name: string | null;
    target_date: string | null;
    shipped_at: Date | null;
  }>(
    `SELECT DISTINCT f.id AS feature_id, f.name AS feature_name, f.status,
            r.name AS release_name, r.target_date::text AS target_date, r.shipped_at,
            lower(f.name) AS sort_key
     FROM insights i
     JOIN notes n ON n.id = i.note_id
     JOIN contacts ct ON ct.id = n.contact_id
     JOIN features f ON f.id = i.feature_id
     LEFT JOIN releases r ON r.id = f.release_id
     WHERE ct.company_id = $1 AND i.workspace_id = $2
     ORDER BY sort_key`,
    [companyId, workspaceId],
  );
  return {
    id: row.id,
    name: row.name,
    domains: row.domains ?? [],
    contacts: contacts.rows,
    noteCount: row.note_count,
    requests: requests.rows.map((r) => {
      const shipped = r.shipped_at !== null;
      return {
        featureId: r.feature_id,
        featureName: r.feature_name,
        status: r.status as CompanyDetail["requests"][number]["status"],
        releaseName: shipped ? r.release_name : null,
        targetMonth: shipped && r.target_date !== null ? r.target_date.slice(0, 7) : null,
        shipped,
      };
    }),
  };
}

