import { errors } from "../errors.js";
import { route, type Route, type RequestContext } from "../router.js";
import { buildFeatureSummaries, loadFeatureRows, loadObjectives } from "../features.js";

const MAX_QUERY_CHARS = 100;

export const searchRoutes: Route[] = [
  {
    pattern: route("search"),
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const raw = ctx.query.get("q") ?? "";
      const q = raw.trim();
      if (q.length < 2 || q.length > MAX_QUERY_CHARS) {
        throw errors.validationFailed({ q: "Search with at least two characters." });
      }
      const workspaceId = ctx.member!.workspaceId;
      const client = await ctx.pool.connect();
      try {
        const rows = await loadFeatureRows(client, workspaceId);
        const objectives = await loadObjectives(client, workspaceId);
        const summaries = buildFeatureSummaries(
          rows.filter((r) => r.parent_feature_id === null),
          objectives,
        );
        const notes = await client.query<{
          id: string;
          title: string;
          text: string;
          created_at: Date;
        }>(
          "SELECT id, title, text, created_at FROM notes WHERE workspace_id = $1",
          [workspaceId],
        );
        const companies = await client.query<{
          id: string;
          name: string;
          domains: string[] | null;
        }>(
          `SELECT c.id, c.name,
                  (SELECT array_agg(d.domain) FROM company_domains d WHERE d.company_id = c.id) AS domains
           FROM companies c WHERE c.workspace_id = $1
           ORDER BY lower(c.name)`,
          [workspaceId],
        );

        const needle = q.toLowerCase();
        const matchedNotes = notes.rows
          .filter((n) => n.title.toLowerCase().includes(needle) || n.text.toLowerCase().includes(needle))
          .sort((a, b) => {
            if (a.created_at.getTime() !== b.created_at.getTime()) {
              return b.created_at.getTime() - a.created_at.getTime();
            }
            return a.id < b.id ? 1 : -1;
          })
          .slice(0, 10)
          .map((n) => ({
            id: n.id,
            title: n.title,
            snippet: buildSnippet(n.text, q),
          }));
        const matchedCompanies = companies.rows
          .filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              (c.domains ?? []).some((d) => d.toLowerCase().includes(needle)),
          )
          .slice(0, 10)
          .map((c) => ({ id: c.id, name: c.name, domains: c.domains ?? [] }));
        const matchedFeatures = summaries
          .filter(
            (f) =>
              f.name.toLowerCase().includes(needle) ||
              f.publicDescription.toLowerCase().includes(needle),
          )
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 10)
          .map((f) => ({
            id: f.id,
            name: f.name,
            insightCount: f.insightCount,
            companyCount: f.companyCount,
          }));
        return {
          status: 200,
          body: { notes: matchedNotes, companies: matchedCompanies, features: matchedFeatures },
        };
      } finally {
        client.release();
      }
    },
  },
];

/**
 * The search snippet window (DP-51): 40 characters before the first match,
 * running 120 characters, with an outward snap at surrogate pairs and an
 * ellipsis on cut edges, outside the count.
 */
export function buildSnippet(text: string, q: string): string {
  const lowerText = text.toLowerCase();
  const firstInText = lowerText.indexOf(q.toLowerCase());
  if (firstInText === -1) {
    // The match is only in the title; the snippet starts at 0.
    const end = snapOut(text, Math.min(120, text.length), true);
    return text.slice(0, end) + (end < text.length ? "…" : "");
  }
  let start = Math.max(0, firstInText - 40);
  start = snapOut(text, start, false);
  let end = snapOut(text, Math.min(start + 120, text.length), true);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** An edge that would split a surrogate pair moves outward by one. */
function snapOut(text: string, offset: number, towardEnd: boolean): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  const prev = text.charCodeAt(offset - 1);
  const cur = text.charCodeAt(offset);
  const prevIsHigh = prev >= 0xd800 && prev <= 0xdbff;
  const curIsLow = cur >= 0xdc00 && cur <= 0xdfff;
  if (prevIsHigh && curIsLow) {
    return towardEnd ? Math.min(offset + 1, text.length) : Math.max(offset - 1, 0);
  }
  return offset;
}
