import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LANDING, NOT_FOUND_HEADING, SESSION_ENDED } from '../shared/copy';
import { send } from './respond';

/**
 * The app's own shell. Every page carries the published content security policy,
 * and no page uses an inline script or an inline event handler.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const PUBLIC_ASSETS = join(__dirname, '..', 'public');

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The hero's mainsail, drawn in thin white strokes with its crosscut seams. */
function heroSail(): string {
  const seams = [];
  for (let i = 1; i <= 7; i += 1) {
    const y = 120 * i;
    const x = 60 + (760 * (1000 - y)) / 1000;
    seams.push(`<line x1="60" y1="${y}" x2="${Math.round(x)}" y2="${y}"/>`);
  }
  return `<svg class="hero-sail" viewBox="0 0 900 1000" aria-hidden="true" focusable="false">
<g fill="none" stroke="#ffffff" stroke-width="2">
<polygon points="60,1000 60,40 820,1000"/>
${seams.join('\n')}
</g></svg>`;
}

function landingBody(): string {
  return `<main class="landing">
<section class="hero">
${heroSail()}
<h1 class="hero-headline">${escapeHtml(LANDING.headline)}</h1>
<div class="hero-foot">
<p class="hero-label">${escapeHtml(LANDING.label)}</p>
<a class="action" href="/signin">${escapeHtml(LANDING.action)}</a>
</div>
</section>
<section class="statement">
<p class="statement-figure">${escapeHtml(LANDING.area)}</p>
<p class="statement-line">${escapeHtml(LANDING.statement)}</p>
</section>
</main>`;
}

/** The session-ended copy shows only after a failed session refresh. */
function signInBody(sessionEnded: boolean): string {
  return `<main class="signin">
<h1>Sign in to the loft</h1>
<form class="signin-form" id="signin-form" method="post" action="/signin">
<p class="field"><label for="signin-email">Email</label><input id="signin-email" name="email" type="email" autocomplete="username"></p>
<p class="field"><label for="signin-password">Password</label><input id="signin-password" name="password" type="password" autocomplete="current-password"></p>
<p><button class="action" type="submit">Sign in</button></p>
</form>
${sessionEnded ? `<p class="session-ended">${escapeHtml(SESSION_ENDED)}</p>` : ''}
</main>`;
}

function notFoundBody(): string {
  return `<main class="notfound"><h1>${escapeHtml(NOT_FOUND_HEADING)}</h1></main>`;
}

/** The app routes render their field and heading at once; data fills in after. */
function appBody(): string {
  return '<div id="app" class="app"></div>';
}

const APP_ROUTES: readonly RegExp[] = [
  /^\/loft$/,
  /^\/boats\/[^/]+$/,
  /^\/drawings\/[^/]+$/,
  /^\/drawings\/[^/]+\/(measure|draw|nest|confirm)$/,
  /^\/floor$/,
  /^\/floor\/[^/]+$/,
  /^\/stock$/,
  /^\/ledger$/,
  /^\/console$/,
  /^\/rulesets$/,
  /^\/accounts$/,
  /^\/owner$/,
  /^\/sheets\/[^/]+$/,
];

export type PageKind = 'landing' | 'signin' | 'app' | 'notfound';

export function pageKindOf(pathname: string): PageKind {
  if (pathname === '/') return 'landing';
  if (pathname === '/signin') return 'signin';
  if (APP_ROUTES.some((pattern) => pattern.test(pathname))) return 'app';
  return 'notfound';
}

function document(kind: PageKind, body: string): string {
  return `<!doctype html>
<html lang="en" data-page="${kind}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boltrope</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="preload" href="/assets/fonts/red-hat-display-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/red-hat-text-latin.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div class="live"><p id="loft-status" role="status" aria-live="polite"></p><p id="loft-alert" role="alert"></p></div>
${body}
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

export async function servePage(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const kind = pageKindOf(url.pathname);
  const body =
    kind === 'landing'
      ? landingBody()
      : kind === 'signin'
        ? signInBody(url.searchParams.get('ended') === '1')
        : kind === 'app'
          ? appBody()
          : notFoundBody();
  const html = Buffer.from(document(kind, body), 'utf8');
  send(response, kind === 'notfound' ? 404 : 200, 'text/html; charset=utf-8', html, {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  });
}

/** Only the app's own fonts and scripts may be cached. */
export function serveAsset(_request: IncomingMessage, response: ServerResponse, url: URL): void {
  const relative = normalize(url.pathname.replace(/^\/assets\//, ''));
  if (relative.startsWith('..')) {
    void servePage(_request, response, new URL('/not-found', url));
    return;
  }
  const file = join(PUBLIC_ASSETS, relative);
  const type = ASSET_TYPES[extname(file)];
  if (type === undefined) {
    void servePage(_request, response, new URL('/not-found', url));
    return;
  }
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    void servePage(_request, response, new URL('/not-found', url));
    return;
  }
  response.writeHead(200, {
    'content-type': type,
    'content-length': String(size),
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(response);
}
