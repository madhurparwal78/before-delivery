import { pool } from './db';

export function helpfulPercent(yes: number, no: number): string {
  if (yes + no === 0) return '-';
  return `${Math.round((yes / (yes + no)) * 100)}%`;
}

export async function analyticsForSite(siteId: string): Promise<{
  pageRatings: { pageId: string; title: string; versionSlug: string; yes: number; no: number; helpful: string }[];
  searchTerms: { term: string; searches: number; results: number }[];
}> {
  const pages = await pool.query<{ id: string; title: string; version_id: string; version_slug: string }>(
    `SELECT p.id, p.title, p.version_id, v.slug AS version_slug FROM pages p
     JOIN versions v ON v.id = p.version_id
     WHERE v.site_id = $1 AND p.state != 'removed'`, [siteId],
  );
  const voteRows = await pool.query<{ page_id: string; vote: string; n: string }>(
    `SELECT page_id, vote, count(*)::text AS n FROM votes
     WHERE page_id IN (SELECT id FROM pages WHERE version_id IN (SELECT id FROM versions WHERE site_id = $1))
     GROUP BY page_id, vote`, [siteId],
  );
  const yesByPage = new Map<string, number>();
  const noByPage = new Map<string, number>();
  for (const row of voteRows.rows) {
    const n = Number(row.n);
    if (row.vote === 'yes') yesByPage.set(row.page_id, n);
    else noByPage.set(row.page_id, n);
  }
  const pageRatings = pages.rows.map((p) => {
    const yes = yesByPage.get(p.id) ?? 0;
    const no = noByPage.get(p.id) ?? 0;
    return { pageId: p.id, title: p.title, versionSlug: p.version_slug, yes, no, helpful: helpfulPercent(yes, no) };
  });
  pageRatings.sort((a, b) => {
    const totalA = a.yes + a.no;
    const totalB = b.yes + b.no;
    if (totalA !== totalB) return totalB - totalA;
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.versionSlug < b.versionSlug ? -1 : a.versionSlug > b.versionSlug ? 1 : 0;
  });

  const terms = await pool.query<{ term: string; searches: string; results: number }>(
    `SELECT r.term, count(*)::text AS searches, (array_agg(r.results ORDER BY r.created_at DESC))[1] AS results
     FROM search_records r
     WHERE r.version_id IN (SELECT id FROM versions WHERE site_id = $1)
     GROUP BY r.term`, [siteId],
  );
  const searchTerms = terms.rows.map((t) => ({ term: t.term, searches: Number(t.searches), results: t.results }));
  searchTerms.sort((a, b) => (a.searches !== b.searches ? b.searches - a.searches : a.term < b.term ? -1 : 1));
  return { pageRatings, searchTerms };
}
