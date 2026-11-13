import { Ctx, sendHtml } from './http';
import { loadPart, loadRevision, loadRoom, revisionLabel } from './records';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Shell = {
  title: string;
  accent: 'cyan' | 'band';
  route: string;
  heading: string;
  headingLevel?: 1;
  main: string;
};

const SKIP_LINK = '<a class="skip-link" href="#main">Skip to content</a>';

function header(ctx: Ctx): string {
  const signedIn = ctx.user !== null;
  const account = signedIn
    ? `<a class="chip" href="/dashboard">Dashboard</a><button class="chip" type="button" data-ui="sign-out">Sign out</button>`
    : `<a class="chip" href="/signin">Sign in</a>`;
  return `<header class="app-header"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Gimbrel Works<span class="brand-sub">Tinework</span></a><nav class="app-nav" aria-label="Account">${account}</nav></header>`;
}

function chrome(): string {
  return [
    '<div data-ui="frame" aria-hidden="true" class="drawn-frame">',
    '<span data-ui="vertex-dot" class="vertex-dot vertex-dot-1"></span>',
    '<span data-ui="vertex-dot" class="vertex-dot vertex-dot-2"></span>',
    '<span data-ui="vertex-dot" class="vertex-dot vertex-dot-3"></span>',
    '<span data-ui="vertex-dot" class="vertex-dot vertex-dot-4"></span>',
    '</div>',
  ].join('');
}

export function dimensionLeader(): string {
  return [
    '<span data-ui="dimension-leader" aria-hidden="true" class="dimension-leader">',
    '<svg viewBox="0 0 96 28" class="leader-art" focusable="false"><path d="M6 4 L6 24 M90 4 L90 24 M6 14 L90 14" /><path d="M6 14 l7 -4 l0 8 Z" /><path d="M90 14 l-7 -4 l0 8 Z" /></svg>',
    '<span data-ui="leader-figure" class="leader-figure">0</span><span data-ui="leader-unit" class="leader-unit">\u2033</span>',
    '</span>',
  ].join('');
}

function document(ctx: Ctx, shell: Shell): string {
  return `<!doctype html>
<html lang="en" data-route="${shell.route}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shell.title)}</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/stack-sans-text.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body data-accent="${shell.accent}" data-route="${shell.route}">
${SKIP_LINK}
${header(ctx)}
<main id="main" tabindex="-1" data-route="${shell.route}">
${shell.main}
</main>
${chrome()}
<script src="/app.js" defer></script>
</body>
</html>`;
}

function cardSkeletons(): string {
  return Array.from({ length: 12 })
    .map(() => '<li class="part-card-slot"><div data-ui="card-skeleton" class="card-skeleton"></div></li>')
    .join('');
}

function galleryRegion(): string {
  return `<section class="gallery" aria-labelledby="gallery-heading" data-ui="gallery">
<h2 id="gallery-heading">Gallery</h2>
<div class="gallery-shell">
<nav class="categories" aria-label="Categories" data-ui="categories"></nav>
<div class="gallery-main">
<div class="gallery-tools"><label class="field-label" for="sort-by">Sort by</label><select id="sort-by" data-ui="sort-by"><option value="featured">Featured</option><option value="liked">Most liked</option><option value="newest">Newest</option><option value="name">Name A\u2013Z</option></select></div>
<ul class="gallery-grid" data-ui="gallery-grid" data-epoch="0" aria-label="Parts">${cardSkeletons()}</ul>
<div class="gallery-foot"><button type="button" data-ui="show-more" hidden>Show more parts</button></div>
<p class="status-line" role="status" aria-label="Gallery" data-ui="gallery-status"></p>
</div>
</div>
</section>`;
}

export async function renderPage(ctx: Ctx): Promise<void> {
  const path = ctx.url.pathname;

  if (path === '/') {
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: 'Tinework by Gimbrel Works',
        accent: 'cyan',
        route: 'home',
        heading: 'Parts that fit the thing you measured.',
        main: `<section class="hero" data-ui="hero">
<div class="hero-left">
<div class="hero-copy">
<h1>Parts that fit the thing you measured.${dimensionLeader()}</h1>
<p class="muted">Open a shared part, set it to your measurements and check it against your printer or mill before you spend filament.</p>
<a class="button-light" href="#gallery-heading" data-ui="open-gallery">Open the gallery</a>
</div>
</div>
<div class="hero-right"><div class="hero-fragment" data-ui="hero-fragment"></div></div>
</section>
<section class="statements" data-ui="statements"></section>
${galleryRegion()}`,
      }),
    );
    return;
  }

  if (path === '/parts/new') {
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: 'Publish a part · Tinework',
        accent: 'cyan',
        route: 'publish',
        heading: 'Publish a part',
        main: `<h1>Publish a part${dimensionLeader()}</h1><div data-ui="publish"></div>`,
      }),
    );
    return;
  }

  if (path === '/signin' || path === '/signup') {
    const signin = path === '/signin';
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: `${signin ? 'Sign in' : 'Create an account'} · Tinework`,
        accent: 'cyan',
        route: signin ? 'signin' : 'signup',
        heading: signin ? 'Sign in' : 'Create an account',
        main: `<h1>${signin ? 'Sign in' : 'Create an account'}${dimensionLeader()}</h1><div data-ui="${
          signin ? 'signin' : 'signup'
        }"></div>`,
      }),
    );
    return;
  }

  if (path === '/dashboard') {
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: 'Dashboard · Tinework',
        accent: 'band',
        route: 'dashboard',
        heading: 'Dashboard',
        main: `<h1>Dashboard${dimensionLeader()}</h1><div data-ui="dashboard"></div>`,
      }),
    );
    return;
  }

  const compareMatch = /^\/parts\/([^/]+)\/compare$/.exec(path);
  if (compareMatch) {
    const part = await loadPart(decodeURIComponent(compareMatch[1]));
    if (!part) {
      renderNotFound(ctx);
      return;
    }
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: `Compare revisions of ${part.title} · Tinework`,
        accent: 'cyan',
        route: 'compare',
        heading: 'Compare revisions',
        main: `<div data-ui="compare" data-slug="${escapeHtml(part.slug)}">${dimensionLeader()}</div>`,
      }),
    );
    return;
  }

  const partMatch = /^\/parts\/([^/]+)$/.exec(path);
  if (partMatch) {
    const part = await loadPart(decodeURIComponent(partMatch[1]));
    if (!part) {
      renderNotFound(ctx);
      return;
    }
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: `${part.title} · Tinework`,
        accent: 'cyan',
        route: 'part',
        heading: part.title,
        main: `<div data-ui="part" data-slug="${escapeHtml(part.slug)}">${dimensionLeader()}</div>`,
      }),
    );
    return;
  }

  const tapeMatch = /^\/tapes\/([^/]+)$/.exec(path);
  if (tapeMatch) {
    const revision = await loadRevision(decodeURIComponent(tapeMatch[1]));
    const part = revision ? await loadPart(revision.part_slug) : null;
    if (!revision || !part) {
      renderNotFound(ctx);
      return;
    }
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: `${part.title} · ${revisionLabel(revision.label_number)} build tape · Tinework`,
        accent: 'cyan',
        route: 'tape',
        heading: `${part.title} · ${revisionLabel(revision.label_number)} build tape`,
        main: `<h1>${escapeHtml(part.title)} · ${revisionLabel(
          revision.label_number,
        )} build tape${dimensionLeader()}</h1><div data-ui="tape-page" data-revision="${escapeHtml(
          revision.id,
        )}" data-slug="${escapeHtml(part.slug)}" data-label="${revisionLabel(
          revision.label_number,
        )}"></div>`,
      }),
    );
    return;
  }

  const roomMatch = /^\/rooms\/([^/]+)$/.exec(path);
  if (roomMatch) {
    const room = await loadRoom(decodeURIComponent(roomMatch[1]));
    sendHtml(
      ctx,
      200,
      document(ctx, {
        title: `${room ? room.title : 'Review room'} · Tinework`,
        accent: 'band',
        route: 'room',
        heading: room ? room.title : 'Review room',
        main: `<div data-ui="room" data-room="${escapeHtml(roomMatch[1])}">${dimensionLeader()}</div>`,
      }),
    );
    return;
  }

  renderNotFound(ctx);
}

export function renderNotFound(ctx: Ctx): void {
  sendHtml(
    ctx,
    404,
    document(ctx, {
      title: 'Not found · Tinework',
      accent: 'cyan',
      route: 'not-found',
      heading: 'Not found',
      main: `<h1>Not found${dimensionLeader()}</h1><p class="muted">That page is not here. <a href="/">Open the gallery</a></p>`,
    }),
  );
}
