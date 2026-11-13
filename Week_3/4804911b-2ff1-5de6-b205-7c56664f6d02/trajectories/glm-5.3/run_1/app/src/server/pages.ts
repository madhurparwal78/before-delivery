import type { ServerResponse } from 'node:http';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LOADING_SLIDE = `<div class="intermission"><div class="display-line">REEL CHANGE</div><p class="italic-line">One moment while the next reel is threaded.</p></div>`;
const NOT_FOUND_SLIDE = `<div class="intermission"><div class="display-line">REEL MISSING</div><p class="italic-line">This page isn't in the programme.</p></div>`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/icons.css">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${body}
<script type="module" src="/assets/entry.js"></script>
</body>
</html>`;
}

/** Page routing. The client script builds each screen's controls on top of this shell. */
export async function renderPage(app: { copyId: string }, path: string, res: ServerResponse): Promise<void> {
  const known =
    path === '/' ||
    path === '/sign-in' ||
    path === '/stockist' ||
    path === '/editor' ||
    /^\/notices\/[A-Za-z0-9-]+$/.test(path);
  if (!known) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(shell('Not found', NOT_FOUND_SLIDE));
    return;
  }
  let body = '';
  let title = 'Vasant Talkies Drinks';
  if (path === '/') {
    title = 'Vasant Talkies Drinks — Now Showing';
    body = `<div id="app" data-route="/">${LOADING_SLIDE}</div>`;
  } else if (path === '/sign-in') {
    title = 'Sign in — Vasant Talkies Drinks';
    body = `<div id="app" data-route="/sign-in">${LOADING_SLIDE}</div>`;
  } else if (path === '/stockist') {
    title = 'Stockist — Vasant Talkies Drinks';
    body = `<div id="app" data-route="/stockist">${LOADING_SLIDE}</div>`;
  } else if (path === '/editor') {
    title = 'Editor — Vasant Talkies Drinks';
    body = `<div id="app" data-route="/editor">${LOADING_SLIDE}</div>`;
  } else {
    const number = path.split('/')[2];
    title = `Notice ${escapeHtml(number)} — Vasant Talkies Drinks`;
    body = `<div id="app" data-route="/notices" data-number="${escapeHtml(number)}">${LOADING_SLIDE}</div>`;
  }
  const noStore = path === '/stockist' || path === '/editor' || path === '/sign-in';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': noStore ? 'no-store' : 'no-cache' });
  res.end(shell(title, body));
}
