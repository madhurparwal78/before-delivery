import { penColumns, penFrom, type PenRow } from "./access";
import { one, pool, rows } from "./db";
import { json, type Context, type Reply } from "./http";
import { toSummary } from "./pens";

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchPens(ctx: Context): Promise<Reply> {
  const query = ctx.url.searchParams.get("q") ?? "";
  const tokens = query.split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return json(200, { query, total: 0, pens: [] });
  const conditions = ["p.visibility = 'public'"];
  const params: unknown[] = [];
  for (const token of tokens) {
    if (token.startsWith("tag:")) {
      params.push(token.slice(4));
      conditions.push(`$${params.length} = ANY(p.tags)`);
    } else {
      params.push(likePattern(token));
      const ref = `$${params.length}`;
      conditions.push(`(p.title ILIKE ${ref} OR o.handle ILIKE ${ref} OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE ${ref}))`);
    }
  }
  const where = conditions.join(" AND ");
  const total = await one<{ total: number }>(pool, `SELECT count(*)::int AS total FROM ${penFrom} WHERE ${where}`, params);
  const found = await rows<PenRow>(
    pool,
    `SELECT ${penColumns} FROM ${penFrom} WHERE ${where} ORDER BY likes DESC, p.updated_at DESC, p.id LIMIT 50`,
    params,
  );
  return json(200, { query, total: total?.total ?? 0, pens: found.map(toSummary) });
}
