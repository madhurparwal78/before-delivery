import type { Principal } from '../http';
import type { Config } from '../config';
import { query } from '../db';
import { readClock } from '../clock';
import { formatDay } from '../datetime';
import { sha256 } from '../crypto';
import { CHAPTER_SLUGS, type Role } from '../../shared/domain';
import { chapterTitle } from '../routes-chapters';

export interface RenderResult {
  status: number;
  html: string;
}

export interface RenderRedirect {
  redirect: string;
}

const SWATCHES = [
  ['Ember', 'Ember 700', 'A3341F', '6.84:1', 'AA', '2.63:1', 'Fail'],
  ['Ember', 'Ember 300', 'F2A08C', '2.06:1', 'Fail', '8.72:1', 'AAA'],
  ['Saffron', 'Saffron 700', '9A5B00', '5.43:1', 'AA', '3.31:1', 'AA Large'],
  ['Saffron', 'Saffron 300', 'F7C266', '1.63:1', 'Fail', '11.01:1', 'AAA'],
  ['Meadow', 'Meadow 700', '2F6B2A', '6.45:1', 'AA', '2.79:1', 'Fail'],
  ['Meadow', 'Meadow 300', 'A9D99A', '1.61:1', 'Fail', '11.20:1', 'AAA'],
  ['Lagoon', 'Lagoon 700', '00666B', '6.75:1', 'AA', '2.67:1', 'Fail'],
  ['Lagoon', 'Lagoon 300', '7FD3D0', '1.73:1', 'Fail', '10.39:1', 'AAA'],
  ['Harbour', 'Harbour 700', '1F4E8C', '8.31:1', 'AAA', '2.16:1', 'Fail'],
  ['Harbour', 'Harbour 300', '9DBDF0', '1.91:1', 'Fail', '9.39:1', 'AAA'],
  ['Iris', 'Iris 700', '5B3A9E', '8.26:1', 'AAA', '2.18:1', 'Fail'],
  ['Iris', 'Iris 300', 'C6B2F0', '1.90:1', 'Fail', '9.44:1', 'AAA'],
  ['Orchid', 'Orchid 700', '8E2C77', '7.56:1', 'AAA', '2.38:1', 'Fail'],
  ['Orchid', 'Orchid 300', 'EDA8DC', '1.87:1', 'Fail', '9.62:1', 'AAA'],
  ['Clay', 'Clay 700', '7A4A33', '7.36:1', 'AAA', '2.44:1', 'Fail'],
  ['Clay', 'Clay 300', 'E0B9A0', '1.81:1', 'Fail', '9.95:1', 'AAA'],
  ['Moss', 'Moss 700', '4F5A1E', '7.46:1', 'AAA', '2.41:1', 'Fail'],
  ['Moss', 'Moss 300', 'CFD88E', '1.51:1', 'Fail', '11.87:1', 'AAA'],
  ['Stone', 'Stone 700', '4D4A55', '8.66:1', 'AAA', '2.08:1', 'Fail'],
  ['Stone', 'Stone 300', 'C9C6CF', '1.69:1', 'Fail', '10.67:1', 'AAA'],
] as const;

const TILE_FIELDS: Record<string, string> = {
  Logo: 'lagoon',
  Voice: 'moss',
  Colour: 'saffron',
  Typography: 'ember',
  Iconography: 'meadow',
  Motion: 'iris',
  Library: 'clay',
  'Rule index': 'orchid',
};

export async function renderPage(
  path: string,
  principal: Principal | null,
  cfg: Config,
): Promise<RenderResult | RenderRedirect> {
  if (path === '/' || path === '') {
    return { status: 200, html: await homePage() };
  }
  if (path === '/signin') {
    if (principal) return { redirect: '/library' };
    return { status: 200, html: shell('Sign in', principal, signInBody(), cfg, { bodyClass: 'auth' }) };
  }
  const activate = /^\/activate\/([A-Za-z0-9_-]+)$/.exec(path);
  if (activate) {
    if (principal) return { redirect: '/library' };
    const valid = await invitationValid(activate[1], cfg);
    if (!valid) {
      return {
        status: 200,
        html: shell(
          'Activate your account',
          principal,
          `<main class="field-cell notice-cell"><h1>Activate your account</h1><p class="notice">This invitation link is no longer valid.</p></main>`,
          cfg,
          { bodyClass: 'auth' },
        ),
      };
    }
    return {
      status: 200,
      html: shell(
        'Activate your account',
        principal,
        `<main class="field-cell notice-cell"><h1>Activate your account</h1><form id="activate-form" data-token="${escapeAttr(activate[1])}"><label class="field"><span>Password</span><input type="password" name="password" id="password" autocomplete="new-password" required minlength="12"></label><button type="submit" class="primary">Activate account</button><div class="alert-slot" aria-live="polite"></div></form></main>`,
        cfg,
        { bodyClass: 'auth' },
      ),
    };
  }
  if (path.startsWith('/chapters/')) {
    const slug = path.slice('/chapters/'.length);
    return { status: 200, html: await chapterPage(slug, principal, cfg) };
  }
  if (path === '/rules') {
    return { status: 200, html: await rulesPage(principal, cfg) };
  }
  if (path.startsWith('/rules/')) {
    const identifier = decodeURIComponent(path.slice('/rules/'.length));
    return { status: 200, html: await rulePage(identifier, principal, cfg) };
  }
  if (!principal) {
    return { redirect: '/signin' };
  }
  const role = principal.role as Role;
  if (path === '/library') {
    return { status: 200, html: shell('Library', principal, libraryBody(), cfg, { signedIn: true, script: 'library' }) };
  }
  if (path === '/requests') {
    if (role !== 'agency') return { status: 200, html: shell('Not found', principal, notFoundBody(), cfg, { signedIn: true }) };
    return {
      status: 200,
      html: shell('My requests', principal, `<main id="page"><h1>My requests</h1><div id="requests-root"></div></main>`, cfg, { signedIn: true, script: 'requests' }),
    };
  }
  if (path.startsWith('/requests/')) {
    return { status: 200, html: shell('Request', principal, `<main id="page"><div id="request-root"></div></main>`, cfg, { signedIn: true, script: 'request' }) };
  }
  if (path === '/queue') {
    if (!['brand_reviewer', 'legal_reviewer', 'owner'].includes(role)) {
      return { status: 200, html: shell('Not found', principal, notFoundBody(), cfg, { signedIn: true }) };
    }
    return {
      status: 200,
      html: shell('Review queue', principal, `<main id="page"><h1>Review queue</h1><div id="queue-root"></div></main>`, cfg, { signedIn: true, script: 'queue' }),
    };
  }
  if (path.startsWith('/editor/')) {
    if (!['author', 'brand_reviewer', 'owner'].includes(role)) {
      return { status: 200, html: shell('Not found', principal, notFoundBody(), cfg, { signedIn: true }) };
    }
    return { status: 200, html: shell('Editor', principal, `<main id="page"><div id="editor-root"></div></main>`, cfg, { signedIn: true, script: 'editor' }) };
  }
  if (path.startsWith('/admin/')) {
    const screen = path.slice('/admin/'.length);
    const allowed =
      (screen === 'assets' && role === 'owner') ||
      (screen === 'people' && role === 'owner') ||
      (screen === 'audit' && (role === 'owner' || role === 'legal_reviewer')) ||
      (screen === 'grants' && (role === 'owner' || role === 'legal_reviewer'));
    if (!allowed) {
      return { status: 200, html: shell('Not found', principal, notFoundBody(), cfg, { signedIn: true }) };
    }
    const script = ({ assets: 'admin-assets', people: 'admin-people', audit: 'admin-audit', grants: 'admin-grants' } as Record<string, string>)[screen] ?? '';
    return { status: 200, html: shell(`Admin ${screen}`, principal, `<main id="page"><div id="admin-root"></div></main>`, cfg, { signedIn: true, script }) };
  }
  return { status: 200, html: shell('Not found', principal, notFoundBody(), cfg, { signedIn: principal !== null }) };
}

export function renderErrorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rulehouse</title><link rel="stylesheet" href="/app.css"></head><body class="error-body"><main class="field-cell notice-cell"><div class="glyph-large">${notFoundGlyph()}</div><h1>${escape(message)}</h1></main></body></html>`;
}

function notFoundBody(): string {
  return `<main class="field-cell notice-cell"><div class="glyph-large">${notFoundGlyph()}</div><h1>Not found</h1></main>`;
}

function signInBody(): string {
  return `<main class="field-cell auth-cell">
  <h1>Sign in</h1>
  <form id="signin-form">
    <label class="field"><span>Email</span><input type="email" name="email" id="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" id="password" autocomplete="current-password" required></label>
    <button type="submit" class="primary">Sign in</button>
    <div class="alert-slot" aria-live="polite"></div>
  </form>
</main>`;
}

function libraryBody(): string {
  return `<main id="page">
  <h1>Library</h1>
  <div class="library-layout">
    <section class="cell filters-cell">
      <h2>Filters</h2>
      <div role="group" aria-label="Filters" class="filters">
        <label class="field"><span>Class</span><select id="class-filter" aria-label="Class"></select></label>
        <label class="check"><input type="checkbox" id="filter-available"> <span>Available</span></label>
        <label class="check"><input type="checkbox" id="filter-request"> <span>Request required</span></label>
        <label class="check"><input type="checkbox" id="filter-restricted"> <span>Restricted</span></label>
        <label class="check"><input type="checkbox" id="filter-retired"> <span>Retired</span></label>
        <label class="field"><span>Search assets</span><input type="search" id="asset-search" aria-label="Search assets"></label>
      </div>
    </section>
    <section>
      <p class="sr-only" id="library-results" role="status" aria-live="polite"></p>
      <div id="cards-root" class="cards"></div>
    </section>
  </div>
</main>`;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escape(value);
}

async function invitationValid(token: string, cfg: Config): Promise<boolean> {
  const now = await readClock(cfg);
  const rows = await query<{ used_at: Date | null; expires_at: Date }>(
    'SELECT used_at, expires_at FROM invitations WHERE token_hash = $1',
    [sha256(token)],
  );
  if (rows.length === 0) return false;
  return rows[0].used_at === null && rows[0].expires_at.getTime() > now.getTime();
}

async function homePage(): Promise<string> {
  const chapters = await publishedChapters();
  const liveRuleCount = await countLiveRules();
  const tiles = [
    { label: 'Logo', slug: 'logo', line: chapterLine(chapters, 'logo'), glyph: logoGlyph(), href: '/chapters/logo' },
    { label: 'Voice', slug: 'voice', line: chapterLine(chapters, 'voice'), glyph: voiceGlyph(), href: '/chapters/voice' },
    { label: 'Colour', slug: 'colour', line: chapterLine(chapters, 'colour'), glyph: colourGlyph(), href: '/chapters/colour' },
    { label: 'Typography', slug: 'typography', line: chapterLine(chapters, 'typography'), glyph: typographyGlyph(), href: '/chapters/typography' },
    { label: 'Iconography', slug: 'iconography', line: chapterLine(chapters, 'iconography'), glyph: iconographyGlyph(), href: '/chapters/iconography' },
    { label: 'Motion', slug: 'motion', line: chapterLine(chapters, 'motion'), glyph: motionGlyph(), href: '/chapters/motion' },
    { label: 'Library', slug: 'library', line: 'Assets and grants', glyph: libraryGlyph(), href: '/library' },
    { label: 'Rule index', slug: 'rules', line: `${liveRuleCount} rules`, glyph: rulesGlyph(), href: '/rules' },
  ];
  const tileHtml = tiles
    .map(
      (tile) => `<a class="tile tile-${tile.slug} field-${TILE_FIELDS[tile.label]}" href="${tile.href}" data-tile="${tile.label}" aria-label="${tile.label}" aria-describedby="tile-line-${tile.slug}">
        <span class="tile-label">${tile.label}</span>
        <span class="tile-line" id="tile-line-${tile.slug}">${escape(tile.line)}</span>
        <span class="tile-glyph">${tile.glyph}</span>
      </a>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quenby &amp; Co. rulebook</title>
<link rel="stylesheet" href="/app.css">
</head>
<body class="home-body" data-page="home">
<div class="grid-lines" aria-hidden="true"></div>
<header class="top-bar">
  ${markGlyph(34)}
</header>
<div class="home-stage" id="home-stage">
  <section class="opening-cell" id="opening-cell">
    <p class="opening-statement">Quenby &amp; Co. is not a mood board. It is a set of rules, each with a name you can cite.</p>
    <div class="opening-row">
      ${markGlyph(34)}
      <button class="jump-cue" id="jump-cue" aria-label="Jump to chapters">${chevronsGlyph()}</button>
    </div>
  </section>
  <section class="promise-card" id="promise-card" role="region" aria-label="Brand promise">
    <p class="promise-statement">Every colour, letter, mark and move here is a rule with an identifier. Ask for what you need by name, and we answer by name.</p>
    ${markGlyph(46)}
  </section>
  <nav class="chapter-mosaic" id="mosaic" aria-label="Chapters">
    ${tileHtml}
  </nav>
</div>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function chapterLine(chapters: { slug: string; version: number; ruleCount: number }[], slug: string): string {
  const chapter = chapters.find((c) => c.slug === slug);
  if (!chapter) return '';
  return `v${chapter.version} · ${chapter.ruleCount} rules`;
}

async function publishedChapters(): Promise<{ slug: string; version: number; ruleCount: number }[]> {
  const out: { slug: string; version: number; ruleCount: number }[] = [];
  for (const slug of CHAPTER_SLUGS) {
    const rows = await query<{ number: number; statements: { identifier: string }[] }>(
      `SELECT number, statements FROM chapter_versions WHERE chapter_slug = $1 AND state = 'published'`,
      [slug],
    );
    if (rows.length === 0) continue;
    out.push({
      slug,
      version: rows[0].number,
      ruleCount: rows[0].statements.filter((s) => s.identifier).length,
    });
  }
  return out;
}

async function countLiveRules(): Promise<number> {
  const rows = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM rule_events WHERE event = 'live'`);
  return Number(rows[0]?.c ?? 0);
}

async function chapterPage(slug: string, principal: Principal | null, cfg: Config): Promise<string> {
  const published = await query<{ number: number; published_at: Date; intro: string; statements: { identifier: string; text: string }[] }>(
    `SELECT number, published_at, intro, statements FROM chapter_versions WHERE chapter_slug = $1 AND state = 'published'`,
    [slug],
  );
  if (published.length === 0) {
    return shell('Not found', principal, notFoundBody(), cfg, { signedIn: principal !== null });
  }
  const row = published[0];
  const statements = row.statements
    .map(
      (statement) =>
        `<li id="${escape(statement.identifier)}"><span class="rule-id">${escape(statement.identifier)}</span> ${escape(statement.text)}</li>`,
    )
    .join('\n');
  const figures = figureHtml(slug);
  const body = `<main id="page" class="chapter-page">
  <h1>${escape(chapterTitle(slug))}</h1>
  <p class="version-line">Version ${row.number}, published ${formatDay(row.published_at, cfg.appTimeZone)}</p>
  <p class="intro">${escape(row.intro)}</p>
  <div class="chapter-columns">
    <div class="statements-col">
      <ul class="rules-list" aria-label="Rules">
        ${statements}
      </ul>
    </div>
    <div class="figures-col">
      ${figures}
    </div>
  </div>
</main>`;
  return shell(chapterTitle(slug), principal, body, cfg, { signedIn: principal !== null, script: slug });
}

function figureHtml(slug: string): string {
  if (slug === 'typography') {
    return `<figure class="cell figure-cell" aria-label="Weight specimen">
      <label class="field"><span>Weight</span><input type="range" id="weight-slider" min="250" max="900" step="1" value="400" aria-label="Weight"></label>
      <p class="readout" id="weight-readout">Weight 400</p>
      <p class="specimen" id="weight-specimen" style="font-weight: 400">Quenby &amp; Co. sets every letter by rule.</p>
      <p class="sr-only" id="weight-announcement" role="status" aria-live="polite"></p>
      <figcaption>Display type runs from weight 250 to 900; body text sits at 400.</figcaption>
    </figure>`;
  }
  if (slug === 'colour') {
    const rows = SWATCHES.map(
      (row) =>
        `<tr data-family="${row[0]}"><th scope="row">${row[1]}</th><td>#${row[2]}</td><td>${row[3]}</td><td>${row[4]}</td><td>${row[5]}</td><td>${row[6]}</td></tr>`,
    ).join('\n');
    const buttons = ['Ember', 'Saffron', 'Meadow', 'Lagoon', 'Harbour', 'Iris', 'Orchid', 'Clay', 'Moss', 'Stone']
      .map(
        (family, index) =>
          `<button type="button" class="wheel-disc disc-${family.toLowerCase()}" data-family="${family}" aria-label="${family} family" aria-pressed="false" data-index="${index}"></button>`,
      )
      .join('\n');
    return `<div class="cell figure-cell">
      <div class="palette-wheel" role="group" aria-label="Palette wheel" id="palette-wheel">
        ${buttons}
        <button type="button" class="show-all" id="show-all">Show all families</button>
      </div>
      <p class="sr-only" id="swatch-filter" role="status" aria-live="polite">20 swatches</p>
      <table class="swatch-table" id="swatch-table">
        <caption>Swatches</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Hex</th><th scope="col">On white</th><th scope="col">Rating</th><th scope="col">On ink</th><th scope="col">Rating</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p class="table-note">Ratings are measured against White #FFFFFF and Ink #17161C.</p>
    </div>`;
  }
  if (slug === 'motion') {
    return `<div class="cell figure-cell">
      <ul class="tracks" role="list" aria-label="Tracks" id="tracks"></ul>
      <div class="timeline" role="group" aria-label="Timeline" id="timeline">
        <input type="range" id="playhead" min="0" max="12" step="1" value="0" aria-label="Playhead">
      </div>
      <p class="readout" id="playhead-readout">00:00 / 00:12</p>
      <div class="keyframes" id="keyframes"></div>
      <table class="values-table" id="values-table">
        <caption class="sr-only">Values at playhead</caption>
        <thead><tr><th scope="col">Property</th><th scope="col">Value</th></tr></thead>
        <tbody id="values-body"></tbody>
      </table>
      <button type="button" class="play-button" id="play-button">Play</button>
      <div class="curve-block">
        <div class="curve-editor" role="group" aria-label="Curve editor" id="curve-editor">
          <div class="curve-plot" id="curve-plot">
            <svg id="curve-svg" width="320" height="320" viewBox="0 0 320 320" aria-hidden="true"></svg>
            <button type="button" class="curve-handle" id="handle-1" aria-label="Handle 1"><span class="handle-value" id="handle-1-value">x 0.30, y 0.00</span></button>
            <button type="button" class="curve-handle" id="handle-2" aria-label="Handle 2"><span class="handle-value" id="handle-2-value">x 0.20, y 1.00</span></button>
          </div>
        </div>
        <p class="sr-only" id="printed-curve" role="status" aria-live="polite">cubic-bezier(0.30, 0.00, 0.20, 1.00)</p>
        <div class="curve-actions">
          <button type="button" id="reset-curve">Reset curve</button>
          <button type="button" id="replay-curve">Replay</button>
        </div>
        <div class="curve-demo" role="region" aria-label="Curve demo" id="curve-demo"><div class="demo-block" id="demo-block"></div></div>
      </div>
    </div>`;
  }
  return '';
}

async function rulesPage(principal: Principal | null, cfg: Config): Promise<string> {
  const rows = await query<{ identifier: string; chapter_slug: string }>(
    `SELECT identifier, chapter_slug FROM rule_events WHERE event = 'live' ORDER BY chapter_slug, identifier`,
  );
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.chapter_slug) ?? [];
    list.push(row.identifier);
    grouped.set(row.chapter_slug, list);
  }
  const sections = [...grouped.entries()]
    .map(([slug, identifiers]) => {
      const items = identifiers
        .map((id) => `<li><a href="/rules/${encodeURIComponent(id)}">${escape(id)}</a></li>`)
        .join('\n');
      return `<section class="cell"><h2>${escape(chapterTitle(slug))}</h2><ul class="rule-links">${items}</ul></section>`;
    })
    .join('\n');
  return shell('Rule index', principal, `<main id="page"><h1>Rule index</h1>${sections}</main>`, cfg, {
    signedIn: principal !== null,
  });
}

async function rulePage(identifier: string, principal: Principal | null, cfg: Config): Promise<string> {
  const live = await query<{ chapter_slug: string; version_number: number }>(
    `SELECT chapter_slug, version_number FROM rule_events WHERE identifier = $1 AND event = 'live'`,
    [identifier],
  );
  if (live.length === 0) {
    const withdrawn = await query<{ version_number: number; replaced_by: string }>(
      `SELECT version_number, replaced_by FROM rule_events WHERE identifier = $1 AND event = 'withdrawn' ORDER BY version_number DESC`,
      [identifier],
    );
    if (withdrawn.length === 0) {
      return shell('Not found', principal, notFoundBody(), cfg, { signedIn: principal !== null });
    }
    const body = `<main id="page" class="rule-page">
      <h1>${escape(identifier)}</h1>
      <p class="notice">This rule was withdrawn in version ${withdrawn[0].version_number}. It is replaced by <a href="/rules/${encodeURIComponent(withdrawn[0].replaced_by)}">${escape(withdrawn[0].replaced_by)}</a>.</p>
    </main>`;
    return shell(identifier, principal, body, cfg, { signedIn: principal !== null });
  }
  const html = await chapterPage(live[0].chapter_slug, principal, cfg);
  return html.replace(
    '</main>',
    `<script>window.__focusRule = ${JSON.stringify(identifier)};</script></main>`,
  );
}

interface ShellOptions {
  signedIn?: boolean;
  script?: string;
  bodyClass?: string;
}

function shell(title: string, principal: Principal | null, body: string, cfg: Config, options: ShellOptions): string {
  void cfg;
  const topBar = principal
    ? `<header class="top-bar"><a href="/" class="mark-link">${markGlyph(34)}</a><nav aria-label="Main" id="main-nav">${mainNav(principal.role as Role)}</nav><button type="button" id="sign-out">Sign out</button></header><p class="sr-only" id="page-status" role="status" aria-live="polite"></p>`
    : `<header class="top-bar"><a href="/" class="mark-link">${markGlyph(34)}</a></header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Quenby &amp; Co. Rulehouse</title>
<link rel="stylesheet" href="/app.css">
</head>
<body class="${options.bodyClass ?? 'app-body'}" ${options.script ? `data-page="${options.script}"` : ''}>
<div class="grid-lines" aria-hidden="true"></div>
${topBar}
${body}
<script src="/app.js" defer></script>
</body>
</html>`;
}

function mainNav(role: Role): string {
  const links: string[] = ['<a href="/library">Library</a>'];
  if (role === 'agency') links.push('<a href="/requests">My requests</a>');
  if (role === 'brand_reviewer' || role === 'legal_reviewer' || role === 'owner') links.push('<a href="/queue">Queue</a>');
  if (role === 'author' || role === 'brand_reviewer' || role === 'owner') links.push('<a href="/editor/logo">Editor</a>');
  if (role === 'owner') links.push('<a href="/admin/assets">Admin</a>');
  else if (role === 'legal_reviewer') links.push('<a href="/admin/grants">Admin</a>');
  return links.join('\n');
}

function markGlyph(size: number): string {
  return `<img src="data:image/svg+xml;utf8,${encodeURIComponent(markSvg())}" width="${size}" height="${size}" alt="Quenby & Co. mark">`;
}

function markSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 12 h48 l-8 12 h-40 z" fill="#1F4E8C"/><path d="M12 28 h44 l-6 12 h-38 z" fill="#1F4E8C" opacity="0.8"/><path d="M16 44 h36 l-4 10 h-32 z" fill="#1F4E8C" opacity="0.6"/><path d="M20 18 h4 l-8 12 h-4 z" fill="#ffffff"/></svg>`;
}

function chevronsGlyph(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5 l8 6 -8 6" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M12 5 l8 6 -8 6" stroke="currentColor" stroke-width="2.5" fill="none"/></svg>`;
}

function logoGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M20 30 h100 l-16 26 h-90 z" fill="#00444a"/><path d="M26 66 h100 l-14 26 h-92 z" fill="#00666B"/><path d="M32 102 h88 l-12 26 h-84 z" fill="#00555c"/></svg>`;
}

function voiceGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M20 20 h22 v10 l-14 26 h-8 z" fill="#2b3212"/><path d="M118 118 h22 v-10 l-14 -26 h-8 z" fill="#3a4218"/><circle cx="30" cy="30" r="10" fill="#3a4218"/><circle cx="130" cy="128" r="10" fill="#2b3212"/></svg>`;
}

function colourGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><rect x="30" y="40" width="70" height="70" fill="#9A5B00"/><rect x="60" y="70" width="70" height="70" fill="#F7C266"/></svg>`;
}

function typographyGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><text x="20" y="140" font-family="system-ui, sans-serif" font-weight="700" font-size="150" fill="#7a2a14">Aa</text></svg>`;
}

function iconographyGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><rect x="40" y="30" width="80" height="60" rx="4" fill="#1d4419"/><path d="M56 90 v-16 h48 v16" fill="none" stroke="#1d4419" stroke-width="8"/><rect x="34" y="100" width="16" height="16" fill="#1d4419"/><rect x="110" y="100" width="16" height="16" fill="#1d4419"/></svg>`;
}

function motionGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M20 130 C 50 20, 110 20, 140 130" stroke="#3a2678" stroke-width="3" fill="none"/><rect x="12" y="122" width="18" height="18" rx="4" fill="#5B3A9E"/><rect x="130" y="122" width="18" height="18" rx="4" fill="#5B3A9E"/></svg>`;
}

function libraryGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><rect x="40" y="66" width="80" height="64" rx="6" fill="none" stroke="#4a2c1c" stroke-width="8"/><path d="M56 66 v-14 a24 24 0 0 1 48 0 v14" fill="none" stroke="#4a2c1c" stroke-width="8"/></svg>`;
}

function rulesGlyph(): string {
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><rect x="26" y="30" width="88" height="14" fill="#5c1c4d"/><rect x="26" y="70" width="108" height="14" fill="#8E2C77"/><rect x="26" y="110" width="72" height="14" fill="#5c1c4d"/><path d="M70 44 v26 M70 84 v26" stroke="#8E2C77" stroke-width="3"/><rect x="66" y="40" width="8" height="8" fill="#8E2C77"/><rect x="66" y="80" width="8" height="8" fill="#8E2C77"/></svg>`;
}

function notFoundGlyph(): string {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M20 30 h80 v50 h-46 l-16 16 v-16 h-18 z" fill="none" stroke="#4D4A55" stroke-width="6"/></svg>`;
}
