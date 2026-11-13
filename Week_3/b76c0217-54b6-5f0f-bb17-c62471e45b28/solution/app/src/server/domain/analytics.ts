// Ratings and search terms, computed from stored votes and logged searches.

import { db } from '../db';
import type { AnalyticsJson } from '../../shared/types';

/** Yes divided by (Yes plus No) as a whole percent, rounded half up; a dash with no votes. */
function helpfulPercent(yes: number, no: number): string {
  const total = yes + no;
  return total === 0 ? '-' : `${Math.floor((200 * yes + total) / (2 * total))}%`;
}

const before = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export async function loadAnalytics(siteId: string): Promise<AnalyticsJson> {
  const [ratings, terms] = await Promise.all([
    db.query<{ pageId: string; title: string; versionSlug: string; yes: number; no: number }>(
      `select p.id as page_id, p.title, v.slug as version_slug,
              count(*) filter (where x.vote = 'yes')::int as yes, count(*) filter (where x.vote = 'no')::int as no
         from pages p join versions v on v.id = p.version_id left join votes x on x.page_id = p.id
        where v.site_id = $1 and not p.removed group by p.id, p.title, v.slug`,
      [siteId],
    ),
    db.query<{ term: string; searches: number; results: number }>(
      `select term, count(*)::int as searches,
              (array_agg(results order by id desc))[1] as results
         from search_records where site_id = $1 group by term`,
      [siteId],
    ),
  ]);
  return {
    pageRatings: ratings
      .sort((a, b) => b.yes + b.no - (a.yes + a.no) || before(a.title, b.title) || before(a.versionSlug, b.versionSlug))
      .map((row) => ({ ...row, helpful: helpfulPercent(row.yes, row.no) })),
    searchTerms: terms.sort((a, b) => b.searches - a.searches || before(a.term, b.term)),
  };
}
