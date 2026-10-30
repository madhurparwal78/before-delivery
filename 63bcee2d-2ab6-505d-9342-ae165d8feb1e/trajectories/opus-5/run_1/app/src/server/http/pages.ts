/** The published page routes and the status each address answers with. */

import { one } from '../db/pool.js';

const EXACT_PAGES = new Set([
  '/',
  '/work',
  '/start',
  '/sign-in',
  '/office',
  '/office/members',
  '/office/case-studies',
  '/office/enquiries',
]);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = '[A-Za-z0-9_-]{8,128}';

const PATTERN_PAGES: RegExp[] = [
  new RegExp(`^/invite/${TOKEN}$`),
  new RegExp(`^/tender-sign-in/${TOKEN}$`),
  new RegExp(
    `^/office/projects/${UUID}/(stages|drawings|tenders|variations|certificates|shop-drawings|site-walk|finishes)$`,
  ),
  new RegExp(`^/office/tenders/${UUID}$`),
  new RegExp(`^/office/tenders/${UUID}/levelling$`),
];

const CASE_STUDY_PAGE = /^\/work\/([a-z0-9-]{3,80})$/;
const PREVIEW_PAGE = new RegExp(`^/preview/(${TOKEN})$`);

/** 200 for a page that exists, 404 for every other address. */
export async function pageStatus(pathname: string): Promise<number> {
  if (EXACT_PAGES.has(pathname)) return 200;
  if (PATTERN_PAGES.some((pattern) => pattern.test(pathname))) return 200;

  const caseStudy = CASE_STUDY_PAGE.exec(pathname);
  if (caseStudy) {
    const found = await one(
      `SELECT 1 FROM case_studies WHERE slug = $1 AND state = 'published'`,
      [caseStudy[1]],
    );
    return found ? 200 : 404;
  }

  const preview = PREVIEW_PAGE.exec(pathname);
  if (preview) {
    const found = await one(
      `SELECT 1 FROM preview_links pl JOIN case_studies cs ON cs.id = pl.case_study_id
        WHERE pl.token = $1 AND pl.revoked_at IS NULL AND pl.expires_at > now()
          AND cs.state <> 'withdrawn'`,
      [preview[1]],
    );
    return found ? 200 : 404;
  }

  return 404;
}

/** The title shown on a tender sign-in page, read without using the link. */
export async function tenderTitleForLink(token: string): Promise<string | null> {
  const found = await one<{ title: string }>(
    `SELECT t.title FROM tender_links tl JOIN tenders t ON t.id = tl.tender_id
      WHERE tl.token = $1 AND tl.used_at IS NULL AND tl.expires_at > now()`,
    [token],
  );
  return found ? found.title : null;
}
