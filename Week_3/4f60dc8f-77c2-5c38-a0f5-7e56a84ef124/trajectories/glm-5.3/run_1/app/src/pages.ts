import type { App } from './server/app';
import type { ClientSession } from './server/middleware';
import { sha256, loadEngagementRow } from './server/domain';

/**
 * Server-rendered page shells with the right status codes: unknown paths,
 * unpublished case studies, dead review links and another brand's records
 * all answer 404 with the same not-found shell.
 */
export interface PageResult {
  html: string | null;
  notFound: boolean;
}

export async function renderPage(app: App, path: string, session: ClientSession | null): Promise<PageResult> {
  const title = pageTitle(path);
  if (title === null) {
    return { html: null, notFound: true };
  }
  if (path.startsWith('/work/')) {
    const slug = path.split('/')[2] ?? '';
    try {
      const study = await app.pocketbase.getCaseStudy(slug);
      if (study === null) {
        return { html: null, notFound: true };
      }
    } catch {
      return { html: null, notFound: true };
    }
  }
  if (path.startsWith('/review/')) {
    const token = path.split('/')[2] ?? '';
    const link = await app.pool.query(
      `SELECT created_at FROM review_links WHERE token_hash = $1 AND active = TRUE`,
      [sha256(token)],
    );
    if (link.rows.length === 0) {
      return { html: null, notFound: true };
    }
    const ageMs = Date.now() - new Date(link.rows[0].created_at).getTime();
    if (ageMs > app.config.timers.reviewLinkTtlSeconds * 1000) {
      return { html: null, notFound: true };
    }
  }
  if (path.startsWith('/account/engagements/') && session) {
    const engagementId = path.split('/')[3] ?? '';
    const row = await loadEngagementRow(app.pool, engagementId);
    if (row === null || row.brand_id !== session.brandId) {
      return { html: null, notFound: true };
    }
  }
  return { html: shell(title), notFound: false };
}

export async function renderNotFound(_app: App): Promise<string> {
  return shell('We couldn\'t find that page');
}

function pageTitle(path: string): string | null {
  if (path === '/') {
    return 'Gloamwork — Your CAD, lit like a launch.';
  }
  if (path === '/start') {
    return 'Start a project — Gloamwork';
  }
  if (path === '/sign-in') {
    return 'Sign in — Gloamwork';
  }
  if (path === '/account') {
    return 'Your account — Gloamwork';
  }
  if (path.startsWith('/account/engagements/')) {
    return 'Engagement — Gloamwork';
  }
  if (path.startsWith('/rig/')) {
    return 'Shot Rig — Gloamwork';
  }
  if (path.startsWith('/review/')) {
    return 'Review — Gloamwork';
  }
  if (path === '/studio') {
    return 'Studio — Gloamwork';
  }
  if (path.startsWith('/studio/engagements/')) {
    return 'Engagement — Gloamwork Studio';
  }
  if (path.startsWith('/work/')) {
    return 'Case study — Gloamwork';
  }
  return null;
}

function shell(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<nav aria-label="Main" class="main-nav">
  <a class="studio-name" href="/">Gloamwork</a>
  <button type="button" class="menu-toggle" aria-expanded="false" aria-controls="nav-drawer">Menu</button>
  <div class="nav-links" id="nav-drawer">
    <a href="/#work">01 Work</a>
    <a href="/#services">02 Services</a>
    <a href="/#studio">03 Studio</a>
    <a href="/#insights">04 Insights</a>
    <a href="/start">05 Start a project</a>
  </div>
</nav>
<main id="main" data-page-shell></main>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
