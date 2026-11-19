import type { Services } from '../index.js';
import { resolveAuth } from '../api/context.js';
import { formatWorkspaceTime } from '../clock.js';
import { esc, page, timeEl, emptyState, statusBar, attr } from './html.js';
import { getRepoByPath, getBranch, getRevision, revisionFileRows, revisionFileTexts, getChange, changeHeadRevision, type ChangeRow, type RepoRow } from '../store/revisions.js';
import { mergeBoxView, threadViews, stackOfChange, roleFor, checksForRevision, getUserById } from '../store/changes.js';
import { diffFile, type DiffHunk } from '../../shared/lines.js';
import { byteOrder, byteLength } from '../../shared/bytes.js';

export interface PageOut { status: number; headers: Record<string, string>; body: string; }

type Cookies = Record<string, string>;

function serviceDeps(s: Services) {
  return { db: s.db.pool, cfg: s.cfg, clock: s.clock, storage: s.storage, mailer: s.mailer, live: s.live };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtTime(s: Services, ms: number): string {
  return formatWorkspaceTime(ms, s.cfg.workspaceTimeZone);
}

function notFoundHtml(s: Services, user: { username: string; name: string } | null): string {
  return page({ title: 'We couldn\u2019t find that page', user, diffBreakpointPx: s.cfg.diffBreakpointPx, bodyClass: 'not-found' }, `
    <section class="nf">
      <h1 class="nf-title">We couldn't find that page</h1>
      <p class="muted">It may not exist, or you may not have access to it.</p>
      <a class="arrow-link" href="/inbox">Back to the inbox</a>
    </section>`);
}

/**
 * Page routing. A signed-out visit to any working screen goes to /login; any
 * address the caller cannot see answers the not-found page with HTTP 404.
 */
export async function renderPage(
  s: Services, method: string, url: URL, pathname: string,
  headers: Record<string, string | undefined>, cookies: Cookies, forceNotFound = false,
): Promise<PageOut | null> {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const user = await s.db.withTransaction(async (tx) => {
    const auth = await resolveAuth(tx, headers, cookies);
    return auth.user ? { username: auth.user.username, name: auth.user.name, id: auth.user.id } : null;
  });
  const outcome = await pageFor(s, pathname, user, url, cookies, forceNotFound);
  if (!outcome) return null;
  return {
    status: outcome.notFound ? 404 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: outcome.html,
  };
}

interface PageOutcome { html: string; notFound?: boolean }

async function pageFor(
  s: Services, pathname: string, user: { username: string; name: string; id: number } | null,
  url: URL, cookies: Cookies, forceNotFound: boolean,
): Promise<PageOutcome | null> {
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const bp = s.cfg.diffBreakpointPx;
  const out = (title: string, content: string, opts: { announcement?: string | null } = {}) =>
    ({ html: page({ title, user, diffBreakpointPx: bp, announcement: opts.announcement ?? null }, content) });
  const nf = () => ({ html: notFoundHtml(s, user), notFound: true });

  if (forceNotFound) return nf();

  if (pathname === '/') return user ? out('Inbox', redirectScript('/inbox')) : out('Stacks that keep their approvals', homePageHtml(s));
  if (pathname === '/signup') return out('Sign up', authCard('signup'));
  if (pathname === '/login') return out('Log in', authCard('login'));
  if (segments[0] === 'confirm' && segments.length === 2) {
    return out('Confirm email', confirmCard(segments[1]));
  }
  // A signed-out visit to any working screen goes to /login first; any other
  // address answers the not-found page.
  if (!user) {
    const orgLike = segments.length === 1 && /^[a-z0-9][a-z0-9-]*$/.test(segments[0]);
    const isWorkingScreen =
      pathname === '/inbox' ||
      pathname === '/repos' ||
      orgLike ||
      (segments.length >= 2 && ['changes', 'queue', 'settings', 'revisions', 'blob', 'edit'].includes(segments[2]));
    return isWorkingScreen ? out('Log in', redirectScript('/login')) : nf();
  }

  if (pathname === '/inbox') return await inboxPage(s, user);
  if (pathname === '/repos') return await reposPage(s, user);

  // /<org>
  if (segments.length === 1) {
    const orgPage = await orgScreen(s, user, segments[0]);
    if (orgPage) return orgPage;
    return nf();
  }
  // /<org>/<repo>/...
  if (segments.length >= 2) {
    const [org, repoName, ...rest] = segments;
    const repo = await s.db.withTransaction(async (tx) => getRepoByPath(tx, org, repoName));
    if (!repo) return nf();
    const role = await s.db.withTransaction(async (tx) => roleFor(tx, repo, user));
    if (role === 'none') return nf();
    if (rest.length === 0) return await repoOverview(s, user, repo, url, role);
    if (rest[0] === 'changes') {
      if (rest.length === 1) return await changesList(s, user, repo);
      if (rest[1] === 'new') return await changeCreate(s, user, repo);
      const n = Number(rest[1]);
      if (Number.isInteger(n) && n >= 1) return await changePage(s, user, repo, n, url);
      return nf();
    }
    if (rest[0] === 'queue' && rest.length === 1) return await queuePage(s, user, repo);
    if (rest[0] === 'settings' && rest.length === 1) return await settingsPage(s, user, repo, role);
    if (rest[0] === 'revisions' && rest.length === 2) return await revisionPage(s, user, repo, rest[1]);
    if (rest[0] === 'blob' && rest.length >= 3) return await blobPage(s, user, repo, rest[1], rest.slice(2).join('/'), false, url);
    if (rest[0] === 'edit' && rest.length >= 3) return await blobPage(s, user, repo, rest[1], rest.slice(2).join('/'), true, url);
  }
  return nf();
}

function redirectScript(to: string): string {
  return `<script>window.location.replace(${JSON.stringify(to)});</script><p class="muted">Redirecting…</p>`;
}

/* ---------------- Home ---------------- */

function homePageHtml(s: Services): string {
  const bp = s.cfg.diffBreakpointPx;
  const content = `
<section class="hero">
  <div class="hero-left">
    <h1 class="hero-title">Stacks that keep their approvals</h1>
    <p class="hero-sub muted">Ridgestack restacks every change above yours, keeps an approval when its diff did not move, and writes down a reason every time a change leaves the merge queue.</p>
    <div class="hero-actions">
      <a class="btn-primary" href="/signup">Open a workspace</a>
      <a class="btn-ghost" href="#push-api">Read the push API</a>
    </div>
  </div>
  <div class="hero-right">
    <div class="slab-frame" aria-hidden="true">
      <svg class="slabs" viewBox="0 0 320 300" width="320" height="300">
        ${[0, 1, 2, 3, 4].map((i) => {
          const y = 250 - i * 44;
          const w = 220 - i * 12;
          const x = 30 + i * 8;
          return `<rect x="${x}" y="${y}" width="${w}" height="34" rx="10" fill="none" stroke="url(#glow)" stroke-width="1.6" transform="rotate(-3 ${x + w / 2} ${y + 17})" opacity="${0.55 + i * 0.1}"/>`;
        }).join('')}
        <defs><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5b83d"/><stop offset="1" stop-color="#5aa9ff"/></linearGradient></defs>
      </svg>
    </div>
    <div class="player" role="region" aria-label="Revision player">
      <div class="player-screen">
        <div class="player-stack" id="player-stack"></div>
      </div>
      <div class="player-tiles" role="tablist" aria-label="Revisions">
        ${[1, 2, 3, 4, 5].map((i) => `<button class="tile" role="tab" aria-selected="${i === 1}" id="tile-${i}" aria-controls="player-stack" type="button">Revision ${i}</button>`).join('')}
      </div>
      <button class="btn-secondary" id="player-play" type="button">Play</button>
    </div>
  </div>
</section>
<section class="bento">
  ${bentoCard('Push log window', 'harbor-ledger', 'Push a branch and open stacked changes through the API.', 'push-log')}
  ${bentoCard('Review notification stack', 'tidepool-api', 'Review requests and mentions arrive by email.', 'review-stack')}
  ${bentoCard('Check panel', 'harbor-ledger', 'Runners report from outside through the checks API.', 'check-panel')}
  ${bentoCard('Merge rule chips', 'tidepool-api', 'Approvals, code owners, checks and the queue in one box.', 'rule-chips')}
  ${bentoCard('Suggestion thread over diff', 'harbor-ledger', 'Suggest replacement lines and apply them as one revision.', 'suggestion')}
</section>
<section class="runners-header">
  <h2 class="runners-title">Checks report from outside</h2>
  <p class="muted runners-sub">Ridgestack runs no code of its own. Check runners push a branch, then report a state for a revision and a name through the push and checks APIs.</p>
</section>
<section class="api-section">
  <h2 class="api-title" id="push-api">Push API</h2>
  <pre class="mono api-sample">POST /api/orgs/harbor/repos/harbor-ledger/push
Authorization: Bearer rgs_&lt;token&gt;
{
  "branch": "round-totals",
  "expected_head": "&lt;revision id&gt;",
  "message": "Round to cents",
  "files": [{ "path": "src/ledger.ts", "content": "..." }]
}</pre>
</section>
<section class="closing">
  <a class="stack-pill" href="/signup">Start a stack</a>
</section>
<footer class="site-footer">
  <div class="footer-cols">
    <div class="footer-col"><p class="footer-head">Product</p><a class="fl" href="/signup">Open a workspace</a><a class="fl" href="/login">Log in</a><a class="fl" href="#push-api">Push API</a></div>
    <div class="footer-col"><p class="footer-head">Screens</p><a class="fl" href="/repos">Repositories</a><a class="fl" href="/inbox">Inbox</a></div>
    <div class="footer-col"><p class="footer-head">Runners</p><a class="fl" href="#push-api">Check reports</a><span class="badge">NEW</span></div>
    <div class="footer-col"><p class="footer-head">Company</p><a class="fl" href="/signup">Sign up</a></div>
  </div>
  <hr class="hairline">
  <div class="status-row" role="status" aria-label="Service status" id="service-status"><span class="dot" aria-hidden="true"></span><span class="status-text">Checking services…</span></div>
  <p class="copyright muted">© Ridgestack Works</p>
  <div class="wordmark-frame" role="img" aria-label="Ridgestack neon wordmark">
    <span class="wordmark">Ridgestack</span>
  </div>
</footer>`;
  return page({ title: 'Stacks that keep their approvals', user: null, diffBreakpointPx: bp }, content);
}

function bentoCard(title: string, repo: string, body: string, cls: string): string {
  return `<article class="bento-card ${cls}">
  <h3 class="card-title">${esc(title)}</h3>
  <p class="card-body muted">${esc(body)}</p>
  <span class="mono muted repo-chip">${esc(repo)}</span>
  <a class="arrow-link" href="/signup">Open a workspace →</a>
  <div class="mockup ${cls}-mock" aria-hidden="true"></div>
</article>`;
}

/* ---------------- Auth cards ---------------- */

function authCard(kind: 'signup' | 'login'): string {
  const isSignup = kind === 'signup';
  const fields = isSignup
    ? `<label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email">
       <label class="label" for="username">Username</label><input class="input" id="username" name="username" autocomplete="username">
       <label class="label" for="name">Full name</label><input class="input" id="name" name="name">
       <label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password">`
    : `<label class="label" for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email">
       <label class="label" for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password">`;
  const button = isSignup ? 'Create account' : 'Log in';
  return `<section class="bento-card auth-card">
  <h1 class="section-title">${isSignup ? 'Create your workspace' : 'Log in'}</h1>
  <form class="form" id="auth-form" data-kind="${kind}">
    ${fields}
    <p class="form-error" id="form-error" role="alert"></p>
    <button class="btn-primary" id="auth-submit" type="submit">${button}</button>
  </form>
</section>`;
}

function confirmCard(token: string): string {
  return `<section class="bento-card auth-card">
  <h1 class="section-title">Confirm your email</h1>
  <p class="muted">Use the button below to finish creating your account.</p>
  <p class="form-error" id="form-error" role="alert"></p>
  <button class="btn-primary" id="confirm-btn" type="button" data-token="${attr(token)}">Confirm email</button>
</section>`;
}

/* ---------------- Inbox ---------------- */

async function inboxPage(s: Services, user: { id: number; username: string; name: string }): Promise<PageOutcome> {
  const rows = await s.db.withTransaction(async (tx) => {
    const review = await tx.query(
      `SELECT c.number, c.title, c.repo_id, o.slug AS org, r.name AS repo, u.name AS author, u.username AS author_username
       FROM review_requests rr
       JOIN changes c ON c.repo_id = rr.repo_id AND c.number = rr.change_number
       JOIN repos r ON r.id = c.repo_id JOIN orgs o ON o.id = r.org_id
       JOIN users u ON u.id = c.author_id
       WHERE rr.user_id = $1 AND rr.pending = true AND c.state IN ('open','draft','removed')`,
      [user.id],
    );
    const mine = await tx.query(
      `SELECT c.number, c.title, c.state, o.slug AS org, r.name AS repo, u.name AS author
       FROM changes c JOIN repos r ON r.id = c.repo_id JOIN orgs o ON o.id = r.org_id JOIN users u ON u.id = c.author_id
       WHERE c.author_id = $1 AND c.state IN ('draft','open','queued','removed') ORDER BY c.repo_id, c.number`,
      [user.id],
    );
    return { review: review.rows, mine: mine.rows };
  });
  const reviewList = rows.review.length === 0
    ? emptyState('Nothing is waiting for your review.', '/repos', 'Browse repositories →')
    : `<ul class="row-list" aria-label="Needs your review">${rows.review.map((r: { number: number; title: string; org: string; repo: string; author: string; author_username: string; state: string }) => rowItem(`/${r.org}/${r.repo}/changes/${r.number}`, `#${r.number} ${r.title}`, `${r.author_username} • ${r.org}/${r.repo}`, r.state)).join('')}</ul>`;
  const mineList = rows.mine.length === 0
    ? emptyState('You have no unmerged changes.', '/repos', 'Open a change →')
    : `<ul class="row-list" aria-label="Your changes">${rows.mine.map((r: { number: number; title: string; state: string; org: string; repo: string; author: string }) => rowItem(`/${r.org}/${r.repo}/changes/${r.number}`, `#${r.number} ${r.title}`, `${r.author} • ${r.org}/${r.repo}`, r.state)).join('')}</ul>`;
  return { html: page({ title: 'Inbox', user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Inbox <span class="count-chip" id="review-count">${rows.review.length}</span></h1>
    <h2 class="list-title">Needs your review</h2>
    ${reviewList}
    <h2 class="list-title">Your changes</h2>
    ${mineList}
  </section>`) };
}

function rowItem(href: string, title: string, mutedLine: string, state: string): string {
  return `<li class="row-item"><a class="row-title" href="${esc(href)}">${esc(title)}</a><span class="row-muted muted">${esc(mutedLine)}</span>${statusBar(state)}</li>`;
}

/* ---------------- Repos and org ---------------- */

async function reposPage(s: Services, user: { id: number; username: string; name: string }): Promise<PageOutcome> {
  const repos = await s.db.withTransaction(async (tx) => {
    const rows = await tx.query(`SELECT r.id, o.slug AS org, r.name, r.visibility FROM repos r JOIN orgs o ON o.id = r.org_id ORDER BY o.slug, r.name`);
    const out = [];
    for (const row of rows.rows) {
      const repo = await getRepoByPath(tx, row.org, row.name);
      if (!repo) continue;
      const role = await roleFor(tx, repo, user);
      if (role === 'none') continue;
      out.push(row);
    }
    return out;
  });
  const list = repos.length === 0
    ? emptyState('You have no repositories yet.', '/repos', 'Create a repository →')
    : `<div class="card-grid">${repos.map((r: { org: string; name: string; visibility: string }) => `
      <article class="bento-card repo-card">
        <a class="card-title" href="/${esc(r.org)}/${esc(r.name)}">${esc(r.org)}/${esc(r.name)}</a>
        <p class="card-body muted">${r.visibility === 'public' ? 'Public repository' : 'Private repository'}</p>
      </article>`).join('')}</div>`;
  return { html: page({ title: 'Repositories', user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Repositories</h1>
    ${list}
    <div class="two-col">
      <form class="bento-card form" id="org-form">
        <h2 class="card-title">Create an organisation</h2>
        <label class="label" for="org-address">Organisation address</label><input class="input" id="org-address" name="slug">
        <label class="label" for="org-name">Organisation name</label><input class="input" id="org-name" name="name">
        <p class="form-error" id="org-error" role="alert"></p>
        <button class="btn-secondary" type="submit">Create organisation</button>
      </form>
      <form class="bento-card form" id="repo-form">
        <h2 class="card-title">Create a repository</h2>
        <label class="label" for="repo-org">Organisation</label>
        <select class="input" id="repo-org" name="org"></select>
        <label class="label" for="repo-name">Repository name</label><input class="input" id="repo-name" name="name">
        <label class="label" for="repo-visibility">Visibility</label>
        <select class="input" id="repo-visibility" name="visibility"><option>Private</option><option>Public</option></select>
        <p class="form-error" id="repo-error" role="alert"></p>
        <button class="btn-secondary" type="submit">Create repository</button>
      </form>
    </div>
  </section>`) };
}

async function orgScreen(s: Services, user: { id: number; username: string; name: string }, slug: string): Promise<PageOutcome> {
  const data = await s.db.withTransaction(async (tx) => {
    const org = await tx.query('SELECT * FROM orgs WHERE slug = $1', [slug]);
    if (org.rows.length === 0) return null;
    const orgId = org.rows[0].id;
    const owners = await tx.query('SELECT u.name FROM org_owners oo JOIN users u ON u.id = oo.user_id WHERE oo.org_id = $1', [orgId]);
    const teams = (await tx.query('SELECT * FROM teams WHERE org_id = $1', [orgId])).rows as Array<{ name: string }>;
    const members: Record<string, string[]> = {};
    for (const t of teams) {
      const m = await tx.query('SELECT u.name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.org_id = $1 AND tm.team_name = $2', [orgId, t.name]);
      members[t.name] = m.rows.map((r: { name: string }) => r.name);
    }
    return { org: org.rows[0], owners: owners.rows, teams, members };
  });
  if (!data) return { html: notFoundHtml(s, user), notFound: true };
  // Only visible to members; others get the not-found page.
  const canSee = await s.db.withTransaction(async (tx) => {
    const owner = await tx.query('SELECT 1 FROM org_owners WHERE org_id = $1 AND user_id = $2', [data.org.id, user.id]);
    if (owner.rows.length > 0) return true;
    const repos = await tx.query('SELECT id FROM repos WHERE org_id = $1', [data.org.id]);
    for (const r of repos.rows) {
      const repo = await getRepoByPath(tx, data.org.slug, (await tx.query('SELECT name FROM repos WHERE id = $1', [r.id])).rows[0].name);
      if (repo && (await roleFor(tx, repo, user)) !== 'none') return true;
    }
    return false;
  });
  if (!canSee) return { html: notFoundHtml(s, user), notFound: true };
  const teams = data.teams.length === 0
    ? `<p class="muted">No teams yet.</p>`
    : data.teams.map((t: { name: string }) => `
      <section class="bento-card"><h3 class="card-title">${esc(t.name)}</h3>
      <ul class="member-list">${(data.members[t.name] ?? []).map((m: string) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">No members</li>'}</ul>
      <form class="form inline" data-team="${attr(t.name)}">
        <label class="label" for="add-${attr(t.name)}">Username to add to ${esc(t.name)}</label>
        <input class="input" id="add-${attr(t.name)}" name="username">
        <button class="btn-secondary" type="submit">Add to ${esc(t.name)}</button>
      </form></section>`).join('');
  return { html: page({ title: data.org.name, user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">${esc(data.org.name)}</h1>
    <h2 class="list-title">Teams</h2>
    ${teams}
    <form class="bento-card form" id="team-form">
      <h2 class="card-title">Create a team</h2>
      <label class="label" for="team-name">Team name</label><input class="input" id="team-name" name="name">
      <button class="btn-secondary" type="submit">Create team</button>
    </form>
  </section>`) };
}

/* ---------------- Repository overview ---------------- */

async function repoOverview(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow, url: URL, role: string): Promise<PageOutcome> {
  const branchName = url.searchParams.get('branch') ?? 'main';
  const data = await s.db.withTransaction(async (tx) => {
    const branch = await getBranch(tx, repo.id, branchName);
    const branches = await tx.query('SELECT name FROM branches WHERE repo_id = $1 ORDER BY name', [repo.id]);
    const files = branch ? await revisionFileRows(tx, repo.id, branch.revision_id) : [];
    const changes = await tx.query(`SELECT * FROM changes WHERE repo_id = $1 AND state IN ('draft','open','queued','removed') ORDER BY number`, [repo.id]);
    const revisions = await tx.query('SELECT id, created_at_ms, message FROM revisions WHERE repo_id = $1 ORDER BY created_at_ms DESC, id DESC LIMIT 8', [repo.id]);
    return { branch, branches: branches.rows, files, changes: changes.rows, revisions: revisions.rows };
  });
  const fileList = data.files.length === 0
    ? `<p class="muted">No files on this branch.</p>`
    : `<ul class="file-list" role="list" aria-label="Files">${data.files.map((f: { path: string }) => `<li role="listitem"><a class="fl mono" href="/${repo.org}/${repo.name}/blob/${esc(branchName)}/${esc(f.path)}">${esc(f.path)}</a></li>`).join('')}</ul>`;
  const changeRows = data.changes.length === 0
    ? `<p class="muted">No open changes.</p>`
    : `<ul class="row-list" aria-label="Open changes">${data.changes.map((c: ChangeRow) => rowItem(`/${repo.org}/${repo.name}/changes/${c.number}`, `#${c.number} ${c.title}`, `${c.state}`, c.state)).join('')}</ul>`;
  const revRows = `<ul class="row-list" aria-label="Recent revisions">${data.revisions.map((r: { id: string; created_at_ms: number; message: string }) => `
    <li class="row-item"><a class="row-title mono" href="/${repo.org}/${repo.name}/revisions/${r.id}">${r.id}</a><span class="row-muted muted">${esc(r.message)}</span><span class="muted">${timeEl(iso(r.created_at_ms), fmtTime(s, r.created_at_ms))}</span></li>`).join('')}</ul>`;
  return { html: page({ title: `${repo.org}/${repo.name}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title mono">${esc(repo.org)}/${esc(repo.name)}</h1>
    <nav class="subnav">
      <a class="fl" href="/${repo.org}/${repo.name}/changes">Changes</a>
      <a class="fl" href="/${repo.org}/${repo.name}/queue">Queue</a>
      <a class="fl" href="/${repo.org}/${repo.name}/settings">Settings</a>
      <a class="fl" href="/${repo.org}/${repo.name}/changes/new">New change</a>
    </nav>
    <div class="overview-grid">
      <article class="bento-card">
        <h2 class="card-title">Files</h2>
        <label class="label" for="branch-select">Branch</label>
        <select class="input" id="branch-select">${data.branches.map((b: { name: string }) => `<option value="${esc(b.name)}"${b.name === branchName ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        ${fileList}
      </article>
      <article class="bento-card">
        <h2 class="card-title">Open changes</h2>
        ${changeRows}
        <a class="arrow-link" href="/${repo.org}/${repo.name}/changes/new">New change →</a>
      </article>
      <article class="bento-card">
        <h2 class="card-title">Recent revisions</h2>
        ${revRows}
      </article>
      <article class="bento-card">
        <h2 class="card-title">Merge rules</h2>
        <div class="chip-col">
          <span class="chip">Approvals: ${repo.required_approvals}</span>
          <span class="chip">Code owners</span>
          <span class="chip">Required checks: ${repo.required_checks.length ? esc(repo.required_checks.join(', ')) : 'none'}</span>
          <span class="chip">Merge queue: ${repo.queue ? 'on' : 'off'}</span>
          <span class="chip">Restack: automatic</span>
        </div>
      </article>
    </div>
  </section>`) };
}

/* ---------------- Change list and creation ---------------- */

async function changesList(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow): Promise<PageOutcome> {
  const changes = await s.db.withTransaction(async (tx) => tx.query('SELECT * FROM changes WHERE repo_id = $1 ORDER BY number', [repo.id]));
  const list = changes.rows.length === 0
    ? emptyState('No changes yet.', `/${repo.org}/${repo.name}/changes/new`, 'Open a change →')
    : `<ul class="row-list">${changes.rows.map((c: ChangeRow) => rowItem(`/${repo.org}/${repo.name}/changes/${c.number}`, `#${c.number} ${c.title}`, c.state, c.state)).join('')}</ul>`;
  return { html: page({ title: `Changes · ${repo.name}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Changes in ${esc(repo.org)}/${esc(repo.name)}</h1>
    ${list}
    <a class="btn-secondary" href="/${repo.org}/${repo.name}/changes/new">New change</a>
  </section>`) };
}

async function changeCreate(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow): Promise<PageOutcome> {
  const branches = await s.db.withTransaction(async (tx) => tx.query('SELECT name FROM branches WHERE repo_id = $1 ORDER BY name', [repo.id]));
  const opts = branches.rows.map((b: { name: string }) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('');
  return { html: page({ title: 'New change', user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Open a change</h1>
    <form class="bento-card form" id="change-form" data-repo="${esc(repo.org)}/${esc(repo.name)}">
      <label class="label" for="title">Title</label><input class="input" id="title" name="title">
      <label class="label" for="description">Description</label><textarea class="input" id="description" name="description" rows="4"></textarea>
      <label class="label" for="head-branch">Head branch</label><select class="input" id="head-branch" name="head">${opts}</select>
      <label class="label" for="base-branch">Base branch</label><select class="input" id="base-branch" name="base">${opts}</select>
      <label class="checkline"><input type="checkbox" id="draft" name="draft"> <span>Open as draft</span></label>
      <p class="form-error" id="change-error" role="alert"></p>
      <button class="btn-primary" type="submit">Create change</button>
    </form>
  </section>`) };
}

/* ---------------- Blob and revision ---------------- */

async function blobPage(
  s: Services, user: { id: number; username: string; name: string }, repo: RepoRow,
  branch: string, path: string, edit: boolean, url: URL,
): Promise<PageOutcome> {
  const branchRow = await s.db.withTransaction(async (tx) => getBranch(tx, repo.id, branch));
  if (!branchRow) return { html: notFoundHtml(s, user), notFound: true };
  const storageOk = await s.storage.healthy();
  let content = '';
  let announcement: string | null = null;
  if (storageOk) {
    const rows = await s.db.withTransaction(async (tx) => tx.query('SELECT key FROM revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3', [repo.id, branchRow.revision_id, path]));
    if (rows.rows.length === 0 && !edit) return { html: notFoundHtml(s, user), notFound: true };
    if (rows.rows.length > 0) content = await s.storage.get(rows.rows[0].key);
  } else {
    announcement = 'Storage is unavailable. Nothing was saved. Try again in a moment.';
  }
  const escapedContent = esc(content);
  if (edit) {
    return { html: page({ title: `Edit ${path}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx, announcement }, `
    <section class="screen">
      <h1 class="section-title mono">Edit ${esc(path)}</h1>
      <p class="muted">On branch <span class="mono">${esc(branch)}</span>. Expected head <span class="mono" id="expected-head">${branchRow.revision_id}</span>.</p>
      <div id="stale-notice" hidden>
        <p class="stale-text">This file changed on ${esc(branch)} since you opened it. Your edit was not saved.</p>
        <button class="btn-secondary" id="load-latest" type="button">Load latest</button>
      </div>
      <form class="bento-card form" id="edit-form" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-branch="${esc(branch)}" data-path="${esc(path)}">
        <label class="label" for="file-content">File content</label>
        <textarea class="input mono" id="file-content" name="content" rows="18" data-expected-head="${branchRow.revision_id}">${escapedContent}</textarea>
        <label class="label" for="revision-message">Revision message</label>
        <input class="input" id="revision-message" name="message">
        <p class="form-error" id="edit-error" role="alert"></p>
        <button class="btn-primary" id="save-file" type="submit">Save file</button>
        <a class="arrow-link" href="/${repo.org}/${repo.name}/blob/${esc(branch)}/${esc(path)}">Cancel</a>
      </form>
      <section id="latest-region" role="region" aria-label="Latest version" hidden>
        <h2 class="card-title">Latest version</h2>
        <pre class="mono file-body" id="latest-text" role="region" aria-label="File content" data-byte-length="${byteLength(content)}"></pre>
      </section>
    </section>`) };
  }
  return { html: page({ title: path, user, diffBreakpointPx: s.cfg.diffBreakpointPx, announcement }, `
  <section class="screen">
    <h1 class="section-title mono">${esc(path)}</h1>
    <nav class="subnav">
      <a class="fl" href="/api/orgs/${esc(repo.org)}/repos/${esc(repo.name)}/revisions/${branchRow.revision_id}/files/${esc(path)}">Raw</a>
      <a class="fl" href="/${repo.org}/${repo.name}/edit/${esc(branch)}/${esc(path)}">Edit file</a>
    </nav>
    <pre class="mono file-body" role="region" aria-label="File content" data-byte-length="${byteLength(content)}">${escapedContent}</pre>
  </section>`) };
}

async function revisionPage(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow, id: string): Promise<PageOutcome> {
  const rev = await s.db.withTransaction(async (tx) => getRevision(tx, repo.id, id));
  if (!rev) return { html: notFoundHtml(s, user), notFound: true };
  const storageOk = await s.storage.healthy();
  let announcement: string | null = null;
  if (!storageOk) announcement = 'Storage is unavailable. Nothing was saved. Try again in a moment.';
  const files = storageOk ? await s.db.withTransaction(async (tx) => revisionFileTexts(tx, s.storage, repo.id, id)) : new Map<string, string>();
  const fileList = [...files.keys()].sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : 1)).map((path) => `
    <article class="bento-card">
      <h2 class="card-title mono">${esc(path)}</h2>
      <pre class="mono file-body" role="region" aria-label="File content" data-byte-length="${byteLength(files.get(path)!)}">${esc(files.get(path)!)}</pre>
    </article>`).join('');
  return { html: page({ title: `Revision ${id}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx, announcement }, `
  <section class="screen">
    <h1 class="section-title mono">Revision ${esc(id)}</h1>
    <dl class="facts">
      <dt class="muted">Message</dt><dd>${esc(rev.message)}</dd>
      <dt class="muted">Author</dt><dd>${esc(rev.author_name)}</dd>
      <dt class="muted">Parents</dt><dd class="mono">${esc([rev.parent1, rev.parent2].filter(Boolean).join(', ') || 'none')}</dd>
      <dt class="muted">Time</dt><dd>${timeEl(iso(rev.created_at_ms), fmtTime(s, rev.created_at_ms))}</dd>
    </dl>
    <button class="btn-secondary" id="export-archive" type="button" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-revision="${esc(id)}">Export archive</button>
    <p class="form-error" id="export-error" role="alert"></p>
    ${fileList}
  </section>`) };
}

/* ---------------- Settings ---------------- */

async function settingsPage(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow, role: string): Promise<PageOutcome> {
  const canManage = role === 'maintainer' || role === 'owner';
  const data = await s.db.withTransaction(async (tx) => {
    const tokens = await tx.query('SELECT id, name, access FROM tokens WHERE repo_id = $1 ORDER BY id', [repo.id]);
    const roles = await tx.query('SELECT subject, role FROM repo_roles WHERE repo_id = $1 ORDER BY subject', [repo.id]);
    const teams = await tx.query('SELECT name FROM teams WHERE org_id = $1', [repo.org_id]);
    return { tokens: tokens.rows, roles: roles.rows, teams: teams.rows.map((t: { name: string }) => t.name) };
  });
  const disabled = canManage ? '' : 'disabled';
  return { html: page({ title: `Settings · ${repo.name}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Settings for ${esc(repo.org)}/${esc(repo.name)}</h1>
    <form class="bento-card form" id="rules-form" data-repo="${esc(repo.org)}/${esc(repo.name)}">
      <h2 class="card-title">Merge rules</h2>
      <label class="label" for="required-approvals">Required approvals</label>
      <input class="input" id="required-approvals" type="number" min="0" max="10" value="${repo.required_approvals}" ${disabled}>
      <label class="label" for="required-checks">Required checks</label>
      <input class="input" id="required-checks" value="${esc(repo.required_checks.join(', '))}" ${disabled}>
      <label class="checkline"><input type="checkbox" id="use-queue" ${repo.queue ? 'checked' : ''} ${disabled}> <span>Use the merge queue</span></label>
      <p class="form-error" id="rules-error" role="alert"></p>
      <button class="btn-primary" id="save-rules" type="submit" ${disabled}>Save rules</button>
    </form>
    <form class="bento-card form" id="token-form" data-repo="${esc(repo.org)}/${esc(repo.name)}">
      <h2 class="card-title">Repository tokens</h2>
      <label class="label" for="token-name">Token name</label><input class="input" id="token-name" ${disabled}>
      <label class="label" for="token-access">Token access</label>
      <select class="input" id="token-access" ${disabled}><option>Read</option><option>Write</option></select>
      <p class="form-error" id="token-error" role="alert"></p>
      <button class="btn-secondary" type="submit" ${disabled}>Create token</button>
    </form>
    <section id="new-token" role="region" aria-label="New token" hidden>
      <p class="muted">Copy this token now. It is not shown again.</p>
      <label class="label" for="token-value">Token value</label>
      <input class="input mono" id="token-value" readonly>
    </section>
    <ul class="row-list" aria-label="Tokens">
      ${data.tokens.map((t: { id: number; name: string; access: string }) => `<li class="row-item"><span class="row-title">${esc(t.name)}</span><span class="row-muted muted">${esc(t.access)}</span><button class="btn-secondary" data-revoke="${t.id}" ${disabled}>Revoke ${esc(t.name)}</button></li>`).join('')}
    </ul>
    <form class="bento-card form" id="role-form" data-repo="${esc(repo.org)}/${esc(repo.name)}">
      <h2 class="card-title">Members</h2>
      <label class="label" for="role-subject">User or team</label><input class="input" id="role-subject" placeholder="user:name or team:name" ${disabled}>
      <label class="label" for="role-role">Role</label>
      <select class="input" id="role-role" ${disabled}><option>Reader</option><option>Writer</option><option>Maintainer</option><option>Owner</option></select>
      <p class="form-error" id="role-error" role="alert"></p>
      <button class="btn-secondary" type="submit" ${disabled}>Grant role</button>
    </form>
    <ul class="row-list" aria-label="Members">
      ${data.roles.map((r: { subject: string; role: string }) => `<li class="row-item"><span class="row-title mono">${esc(r.subject)}</span><span class="row-muted muted">${esc(r.role)}</span><button class="btn-secondary" data-remove-role="${esc(r.subject)}" ${disabled}>Remove ${esc(r.subject)}</button></li>`).join('')}
    </ul>
  </section>`) };
}

/* ---------------- Queue page ---------------- */

async function queuePage(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow): Promise<PageOutcome> {
  const entries = await s.db.withTransaction(async (tx) => {
    const rows = await tx.query("SELECT * FROM queue_entries WHERE repo_id = $1 AND state IN ('waiting','checking') ORDER BY position", [repo.id]);
    const history = await tx.query("SELECT * FROM queue_entries WHERE repo_id = $1 AND state IN ('merged','removed') ORDER BY ended_at_ms DESC LIMIT 30", [repo.id]);
    return { rows: rows.rows, history: history.rows };
  });
  const role = await s.db.withTransaction(async (tx) => roleFor(tx, repo, user));
  const canManage = role === 'maintainer' || role === 'owner';
  const entryEls: string[] = [];
  for (const e of entries.rows) {
    const change = await s.db.withTransaction(async (tx) => getChange(tx, repo.id, e.change_number));
    const checks = await s.db.withTransaction(async (tx) => {
      const revRow = await tx.query('SELECT created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, e.revision]);
      return checksForRevision(tx, serviceDeps(s), repo, e.revision, repo.required_checks, revRow.rows[0]?.created_at_ms ?? s.clock.nowMs());
    });
    entryEls.push(`<li class="queue-entry" tabindex="0" role="listitem" data-queue-entry-id="${e.id}" data-state="${e.state}" data-position="${e.position}" data-change-number="${e.change_number}" data-anim="none">
      <a class="row-title" href="/${repo.org}/${repo.name}/changes/${e.change_number}">#${e.change_number} ${esc(change?.title ?? '')}</a>
      <span class="row-muted muted">Position ${e.position}</span>
      <span class="row-muted mono">Queue revision ${e.revision}</span>
      <ul class="checks" aria-label="Checks">
        ${checks.map((c) => checkRow(c, fmtTime(s, c.timeoutAtMs ?? 0))).join('')}
      </ul>
      ${canManage ? `<button class="btn-secondary q-up" data-move="up" ${e.position === 1 ? 'disabled' : ''}>Move up</button><button class="btn-secondary q-down" data-move="down" ${e.position === entries.rows.length ? 'disabled' : ''}>Move down</button>` : ''}
    </li>`);
  }
  const list = entries.rows.length === 0
    ? emptyState('The merge queue is empty.', `/${repo.org}/${repo.name}/changes`, 'Back to changes →')
    : `<ul class="queue-list" aria-label="Queue entries">${entryEls.join('')}</ul>`;
  const historyRows = entries.history.length === 0
    ? `<p class="muted">No queue history yet.</p>`
    : `<table class="check-table" aria-label="Queue history"><thead><tr><th>Change</th><th>State</th><th>Time</th><th>Reason</th></tr></thead><tbody>
      ${entries.history.map((e: { change_number: number; state: string; ended_at_ms: number; reason: string | null }) => `<tr><td>#${e.change_number}</td><td>${esc(e.state)}</td><td>${timeEl(iso(e.ended_at_ms), fmtTime(s, e.ended_at_ms))}</td><td>${esc(e.reason ?? '')}</td></tr>`).join('')}
      </tbody></table>`;
  return { html: page({ title: `Merge queue · ${repo.name}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx }, `
  <section class="screen">
    <h1 class="section-title">Merge queue for ${esc(repo.org)}/${esc(repo.name)}</h1>
    ${list}
    <h2 class="list-title">Queue history</h2>
    ${historyRows}
  </section>`) };
}

function checkRow(c: { name: string; state: string; summary: string; required: boolean; timeoutAtMs: number | null }, timeoutDisplay: string): string {
  const words: Record<string, string> = { queued: 'Queued', in_progress: 'In progress', success: 'Passed', failure: 'Failed', timed_out: 'Timed out' };
  const timeout = c.required && (c.state === 'queued' || c.state === 'in_progress') && c.timeoutAtMs
    ? `<span class="muted">Times out at ${esc(timeoutDisplay)}</span>` : '';
  return `<li class="check-row" data-check-name="${esc(c.name)}" data-state="${esc(c.state)}">
    <span class="check-word">${words[c.state] ?? esc(c.state)}</span>
    <span class="check-name mono">${esc(c.name)}</span>
    ${c.required ? '<span class="muted">(required)</span>' : ''}
    <span class="muted">${esc(c.summary)}</span>
    ${timeout}
  </li>`;
}

/* ---------------- Change page ---------------- */

async function changePage(s: Services, user: { id: number; username: string; name: string }, repo: RepoRow, n: number, url: URL): Promise<PageOutcome> {
  const change = await s.db.withTransaction(async (tx) => getChange(tx, repo.id, n));
  if (!change) return { html: notFoundHtml(s, user), notFound: true };
  const storageOk = await s.storage.healthy();
  const announcement = storageOk ? null : 'Storage is unavailable. Nothing was saved. Try again in a moment.';
  const data = await s.db.withTransaction(async (tx) => {
    const diff = storageOk ? await (await import('../store/revisions.js')).changeCombinedDiff(tx, s.storage, change) : [];
    const box = await mergeBoxView(tx, serviceDeps(s), repo, change, diff);
    const threads = await threadViews(tx, repo.id, n);
    const stack = await stackOfChange(tx, change);
    const author = await getUserById(tx, change.author_id);
    const role = await roleFor(tx, repo, user);
    const reviews = await tx.query('SELECT * FROM reviews WHERE repo_id = $1 AND change_number = $2 ORDER BY id DESC', [repo.id, n]);
    const requests = await tx.query(
      `SELECT u.username FROM review_requests rr JOIN users u ON u.id = rr.user_id WHERE rr.repo_id = $1 AND rr.change_number = $2 AND rr.pending = true`,
      [repo.id, n],
    );
    const viewed = await tx.query(
      'SELECT path FROM viewed_marks WHERE repo_id = $1 AND change_number = $2 AND user_id = $3',
      [repo.id, n, user.id],
    );
    const headRev = await changeHeadRevision(tx, change);
    const revRow = await tx.query('SELECT created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, headRev]);
    const checks = await checksForRevision(tx, serviceDeps(s), repo, headRev, repo.required_checks, revRow.rows[0]?.created_at_ms ?? s.clock.nowMs());
    const queueEntry = await tx.query("SELECT * FROM queue_entries WHERE repo_id = $1 AND change_number = $2 AND state IN ('waiting','checking')", [repo.id, n]);
    return { diff, box, threads, stack, author, role, reviews: reviews.rows, requests: requests.rows, viewed: new Set(viewed.rows.map((v: { path: string }) => v.path)), checks, headRev, queueEntry: queueEntry.rows[0] ?? null };
  });
  const diffFiles = storageOk ? data.diff.map((f) => ({
    path: f.path,
    status: f.status,
    hunks: diffFile(f.baseText, f.headText, s.cfg.diffContextLines).hunks,
  })) : [];
  // Stack rows: bottom to top, with restack results above the change itself.
  const changeIdx = data.stack.findIndex((c: { number: number }) => c.number === n);
  const stackHtml = await Promise.all(data.stack.map(async (c: { number: number; title: string; state: string }, i: number) => {
    const isSelf = c.number === n;
    const result = isSelf ? null : await restackResultFor(s, repo, c.number, i, changeIdx);
    return `<li class="stack-row" data-change-number="${c.number}" data-stack-position="${i + 1}" data-restack="${result ?? ''}" data-anim="none">
      <a class="row-title" href="/${repo.org}/${repo.name}/changes/${c.number}">#${c.number} ${esc(c.title)}</a>
      <span class="restack-word">${result ? resultWord(result, 0) : ''}</span>
    </li>`;
  }));
  const diffStage = diffFiles.map((f) => fileDiffHtml(f, data.viewed.has(f.path), repo, n, data.threads)).join('');
  const boxRules = data.box.rules.length === 0
    ? `<li data-rule="met">All merge rules are met</li>`
    : data.box.rules.map((r: { rule: string; text: string }) => `<li data-rule="${esc(r.rule)}">${esc(r.text)}</li>`).join('');
  const queueOn = repo.queue;
  const mergeButton = data.queueEntry
    ? `<p class="muted">In the merge queue, position ${data.queueEntry.position}</p>`
    : change.state === 'merged'
      ? `<p class="muted">Merged into ${esc(change.base_branch)} as ${esc(change.merged_revision ?? '')}</p>`
      : `<button class="btn-merge" id="merge-btn" type="button" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}" ${data.box.rules.length > 0 ? 'disabled' : ''}>${queueOn ? 'Add to merge queue' : 'Merge change'}</button>`;
  const readyButton = change.draft ? `<button class="btn-secondary" id="ready-btn" type="button" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}">Mark ready for review</button>` : '';
  const notice = change.restack_notice
    ? `<ul class="notices" aria-label="Change notices"><li data-notice="${esc(change.restack_notice_type ?? '')}">${esc(change.restack_notice)}</li></ul>`
    : '';
  const reviewer = data.role === 'reader';
  const isAuthor = change.author_id === user.id;
  const reviewDialog = `
  <button class="btn-secondary" id="review-btn" type="button">Review changes</button>
  <div class="dialog-backdrop" id="review-dialog" role="dialog" aria-modal="true" aria-label="Submit review" hidden>
    <div class="dialog">
      <h2 class="card-title">Submit review</h2>
      <fieldset class="radios" role="radiogroup" aria-label="Review type">
        <label class="checkline"><input type="radio" name="review-type" value="comment" checked> <span>Comment</span></label>
        <label class="checkline"><input type="radio" name="review-type" value="approve" ${reviewer || isAuthor ? 'disabled' : ''}> <span>Approve</span>${reviewer ? '<span class="reason muted">Readers cannot approve or request changes</span>' : isAuthor ? '<span class="reason muted">You cannot approve your own change</span>' : ''}</label>
        <label class="checkline"><input type="radio" name="review-type" value="request_changes" ${reviewer ? 'disabled' : ''}> <span>Request changes</span>${reviewer ? '<span class="reason muted">Readers cannot approve or request changes</span>' : ''}</label>
      </fieldset>
      <label class="label" for="review-summary">Review summary</label>
      <textarea class="input" id="review-summary" rows="3"></textarea>
      <p class="form-error" id="review-error" role="alert"></p>
      <button class="btn-primary" id="submit-review" type="button">Submit review</button>
      <button class="btn-secondary" id="cancel-review" type="button">Cancel</button>
    </div>
  </div>`;
  const reviewsList = `<ul class="row-list" aria-label="Reviews">
    ${data.reviews.map((r: { id: number; reviewer_id: number; state: string; reviewer: string; summary: string; reason: string | null }) => reviewRowHtml(s, r)).join('')}
  </ul>`;
  const threadsByAnchor = new Map<string, string[]>();
  for (const t of data.threads) {
    const key = `${t.path}:${t.side}:${t.line}`;
    const arr = threadsByAnchor.get(key) ?? [];
    arr.push(threadHtml(t, repo, n));
    threadsByAnchor.set(key, arr);
  }
  const unresolvedCount = data.threads.filter((t) => t.state === 'unresolved').length;
  const viewedCount = data.viewed.size;
  const content = `
  <section class="screen change-screen" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}" data-stack-count="${data.stack.length}">
    <header class="change-header" data-files-viewed="${viewedCount}" data-files-total="${diffFiles.length}" data-unresolved-threads="${unresolvedCount}" data-approvals-remaining="${Math.max(0, repo.required_approvals - data.box.approvals.length)}">
      <h1 class="section-title">#${n} ${esc(change.title)}</h1>
      <p class="muted">${statusBar(change.state)}</p>
      <p class="muted">${esc(data.author?.username ?? '')} wants to merge <span class="mono">${esc(change.head_branch)}</span> into <span class="mono">${esc(change.base_branch)}</span></p>
      <p class="muted">Unresolved threads: <span id="unresolved-count">${unresolvedCount}</span></p>
      <p class="muted">Approvals remaining: <span id="approvals-remaining">${Math.max(0, repo.required_approvals - data.box.approvals.length)}</span></p>
      <p class="muted toolbar-line" id="files-viewed-line">${viewedCount} of ${diffFiles.length} files viewed</p>
      <div class="toolbar" role="toolbar" aria-label="Diff toolbar">
        <fieldset class="radios inline" role="radiogroup" aria-label="Diff view" id="diff-view-group">
          <label class="checkline"><input type="radio" name="diff-view" value="split"> <span>Split</span></label>
          <label class="checkline"><input type="radio" name="diff-view" value="unified" checked> <span>Unified</span></label>
        </fieldset>
        <label class="checkline switch-line"><input type="checkbox" id="outdated-switch"> <span>Show outdated threads</span></label>
        <button class="btn-secondary" id="apply-batch" type="button" hidden>Apply batch</button>
      </div>
    </header>
    <div class="two-pane">
      <div class="stage" id="diff-stage">
        <nav class="file-tree wide-tree" role="navigation" aria-label="File tree">
          <ul>${diffFiles.map((f) => `<li><a class="fl mono" href="#" data-path="${esc(f.path)}">${esc(f.path)}</a></li>`).join('')}</ul>
        </nav>
        <button class="btn-secondary files-btn" id="files-btn" type="button" hidden>Files</button>
        ${diffStage || (storageOk ? '' : `<p class="muted">The diff needs file text from storage.</p>`)}
      </div>
      <aside class="rail">
        <section class="rail-card" aria-label="Stack">
          <h2 class="card-title">Stack</h2>
          <ul class="stack-list" aria-label="Stack">${stackHtml.join('')}</ul>
        </section>
        <section class="rail-card" role="region" aria-label="Merge box" id="merge-box">
          <h2 class="card-title">Merge box</h2>
          <ul class="merge-rules" aria-label="Merge rules" id="merge-rules">${boxRules}</ul>
          ${mergeButton}
          ${readyButton}
        </section>
        <section class="rail-card" aria-label="Change notices" id="notices">${notice}</section>
        <section class="rail-card">
          <h2 class="card-title">Checks</h2>
          <ul class="checks" aria-label="Checks" id="checks-list">
            ${data.checks.map((c) => checkRow(c, fmtTime(s, c.timeoutAtMs ?? 0))).join('')}
          </ul>
        </section>
        <section class="rail-card">
          <h2 class="card-title">Reviewers</h2>
          <form class="form" id="request-review-form" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}">
            <label class="label" for="reviewer-username">Reviewer username</label>
            <input class="input" id="reviewer-username" name="username">
            <p class="form-error" id="request-error" role="alert"></p>
            <button class="btn-secondary" type="submit">Request review</button>
          </form>
          <ul class="row-list" aria-label="Requested reviewers" id="requested-reviewers">
            ${data.requests.map((r: { username: string }) => `<li class="row-item"><span class="row-title">${esc(r.username)}</span></li>`).join('')}
          </ul>
          ${reviewDialog}
          <div class="reviews">${reviewsList}</div>
        </section>
      </aside>
    </div>
  </section>`;
  return { html: page({ title: `#${n} ${change.title}`, user, diffBreakpointPx: s.cfg.diffBreakpointPx, announcement }, content) };
}

async function restackResultFor(s: Services, repo: RepoRow, number: number, position: number, selfIdx: number): Promise<string | null> {
  const row = await s.db.withTransaction(async (tx) => {
    const r = await tx.query('SELECT restack_result FROM changes WHERE repo_id = $1 AND number = $2', [repo.id, number]);
    return r.rows[0]?.restack_result ?? null;
  });
  return row;
}

function resultWord(result: string, dismissedCount: number): string {
  switch (result) {
    case 'kept': return 'Approvals kept';
    case 'dismissed': return `Approvals dismissed (${dismissedCount})`;
    case 'conflicting': return `Conflicts in 1 files`;
    case 'not_restacked': return 'Not restacked';
    default: return '';
  }
}

async function reviewRowHtml(s: Services, r: { id: number; reviewer_id: number; state: string; summary: string; reason: string | null }): Promise<string> {
  const reviewer = await s.db.withTransaction(async (tx) => getUserById(tx, r.reviewer_id));
  return `<li class="row-item review-row" data-review-id="${r.id}" data-state="${esc(r.state)}">
    <span class="row-title">${esc(reviewer?.name ?? '')}</span>
    <span class="row-muted muted">${esc(r.state)}</span>
    ${r.summary ? `<span class="muted">${esc(r.summary)}</span>` : ''}
    ${r.reason ? `<span class="muted">${esc(r.reason)}</span>` : ''}
  </li>`;
}

function fileDiffHtml(f: { path: string; status: string; hunks: DiffHunk[] }, viewed: boolean, repo: RepoRow, n: number, threads: Array<{ path: string; side: string; line: number; outdated: boolean }>): string {
  const statusWord = f.status === 'added' ? 'Added' : f.status === 'deleted' ? 'Deleted' : 'Modified';
  const rows = f.hunks.flatMap((h) => {
    const headerRow = `<div class="diff-row hunk-row" role="row" data-path="${esc(f.path)}" data-kind="hunk" data-old-line="" data-new-line="" data-side=""><span class="line-text mono" role="gridcell">${esc(h.header)}</span></div>`;
    const lineRows = h.rows.map((r) => {
      const side = r.kind === 'removed' ? 'old' : 'new';
      const anchorThreads = threads.filter((t) => t.path === f.path && t.side === side && t.line === (r.new_line ?? r.old_line) && !t.outdated);
      const name = rowName(r.kind, r.old_line, r.new_line, r.text);
      const lineText = r.text === '' ? '(empty line)' : r.text;
      return `<div class="diff-row line-row k-${r.kind}" role="row" tabindex="-1" aria-label="${esc(name)}" data-path="${esc(f.path)}" data-kind="${r.kind}" data-old-line="${r.old_line ?? ''}" data-new-line="${r.new_line ?? ''}" data-side="${side}">
        <span class="ln old mono" role="gridcell">${r.old_line ?? ''}</span>
        <span class="ln new mono" role="gridcell">${r.new_line ?? ''}</span>
        <span class="marker" role="gridcell" aria-hidden="true">${r.kind === 'added' ? '+' : r.kind === 'removed' ? '−' : ''}</span>
        <span class="line-text mono" role="gridcell">${esc(lineText)}</span>
        <span class="row-comment-slot" role="gridcell"></span>
      </div>
      ${anchorThreads.length > 0 ? `<div class="thread-slot" data-anchor="${esc(f.path)}:${side}:${r.new_line ?? r.old_line}"></div>` : ''}`;
    });
    return [headerRow, ...lineRows];
  }).join('');
  return `<section class="file-section" data-viewed="${viewed}" data-path="${esc(f.path)}">
    <header class="file-header">
      <h2 class="card-title mono">${esc(f.path)}</h2>
      <span class="muted">${statusWord}</span>
      <label class="checkline"><input type="checkbox" class="viewed-check" data-path="${esc(f.path)}" ${viewed ? 'checked' : ''}> <span>Viewed</span></label>
    </header>
    <div class="diff-table" role="table" aria-label="Diff of ${esc(f.path)}">
      <div role="rowgroup">${rows}</div>
    </div>
    <div class="file-threads" data-file-threads="${esc(f.path)}"></div>
  </section>`;
}

function rowName(kind: string, oldLine: number | null, newLine: number | null, text: string): string {
  const display = text === '' ? '(empty line)' : text;
  if (kind === 'added') return `Line ${newLine}, added: ${display}`;
  if (kind === 'removed') return `Old line ${oldLine}, removed: ${display}`;
  return `Line ${newLine}, unchanged: ${display}`;
}

function threadHtml(t: {
  id: number; path: string; side: string; line: number; end_line: number; state: string; outdated: boolean;
  comments: Array<{ id: number; author: string; body: string; created_at_ms: number; suggestion: { lines: string[]; state: string } | null }>;
}, repo: RepoRow, n: number): string {
  const comments = t.comments.map((c) => `
    <article class="comment">
      <p class="comment-meta muted">${esc(c.author)}</p>
      <p class="comment-body">${esc(c.body)}</p>
      ${c.suggestion ? `<div class="suggested" role="region" aria-label="Suggested change">
        <pre class="mono suggestion-lines">${esc(c.suggestion.lines.join('\n'))}</pre>
        ${c.suggestion.state === 'applied' ? '<span class="muted applied-text">Applied</span>' : `<button class="btn-secondary apply-suggestion" data-comment="${c.id}" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}" type="button">Apply suggestion</button>
        <button class="btn-secondary batch-suggestion" data-comment="${c.id}" type="button">Add to batch</button>`}
      </div>` : ''}
    </article>`).join('');
  return `<article class="thread" role="article" aria-label="Thread on ${esc(t.path)} line ${t.line}" data-thread-id="${t.id}" data-state="${esc(t.state)}" data-outdated="${t.outdated}" data-path="${esc(t.path)}" data-side="${esc(t.side)}" data-line="${t.line}" data-anim="none">
    <header class="thread-head"><span class="muted mono">${esc(t.path)} ${t.side} line ${t.line}</span></header>
    ${comments}
    <label class="label sr-only" for="reply-${t.id}">Reply</label>
    <textarea class="input" id="reply-${t.id}" rows="2"></textarea>
    <button class="btn-secondary send-reply" data-thread="${t.id}" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}" type="button">Send reply</button>
    <button class="btn-secondary resolve-thread" data-thread="${t.id}" data-state="${esc(t.state)}" data-repo="${esc(repo.org)}/${esc(repo.name)}" data-change="${n}" type="button">${t.state === 'unresolved' ? 'Resolve thread' : 'Unresolve thread'}</button>
  </article>`;
}
