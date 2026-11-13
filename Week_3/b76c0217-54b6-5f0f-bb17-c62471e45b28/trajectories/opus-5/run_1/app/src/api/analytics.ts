import { ratingsOfSite, searchTermsOfSite } from '../db/publishing';
import { helpfulPercent } from '../domain/analytics';
import { sendJson, type Ctx } from '../http/http';
import { loadSite, requireUser } from './auth';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function getAnalytics(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const site = await loadSite(user, ctx.params.siteId);
  const [ratings, terms] = await Promise.all([
    ratingsOfSite(site.id),
    searchTermsOfSite(site.id),
  ]);
  const pageRatings = ratings
    .sort(
      (a, b) =>
        b.yes + b.no - (a.yes + a.no) ||
        compare(a.title, b.title) ||
        compare(a.versionSlug, b.versionSlug),
    )
    .map((row) => ({
      pageId: row.pageId,
      title: row.title,
      versionSlug: row.versionSlug,
      yes: row.yes,
      no: row.no,
      helpful: helpfulPercent(row.yes, row.no),
    }));
  const searchTerms = terms.sort(
    (a, b) => b.searches - a.searches || compare(a.term, b.term),
  );
  sendJson(ctx, 200, { pageRatings, searchTerms });
}
