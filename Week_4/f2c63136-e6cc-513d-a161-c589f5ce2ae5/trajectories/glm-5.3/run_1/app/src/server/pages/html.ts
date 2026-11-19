/** HTML rendering helpers; everything user-supplied passes through esc(). */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attr(s: string | number | boolean | null | undefined): string {
  if (s === null || s === undefined) return '';
  return esc(String(s));
}

export interface PageOptions {
  title: string;
  user: { username: string; name: string } | null;
  diffBreakpointPx: number;
  bodyClass?: string;
  statusText?: string | null;
  announcement?: string | null;
}

/**
 * The shared frame: near-black ground, centred column, the floating workspace
 * nav pill stuck 10px below the top, the announcement strip and both live
 * regions on every screen.
 */
export function page(opts: PageOptions, content: string): string {
  const nav = opts.user
    ? `<a class="navlink" href="/inbox">Inbox</a><a class="navlink" href="/repos">Repositories</a><button class="navbtn" id="logout" type="button">Log out</button>`
    : `<a class="navlink" href="/login">Log in</a><a class="navlink" href="/signup">Sign up</a>`;
  const announcement = opts.announcement
    ? `<div class="alert-strip" role="alert" id="announcement">${esc(opts.announcement)}</div>`
    : `<div class="alert-strip" role="alert" id="announcement" hidden></div>`;
  return `<!doctype html>
<html lang="en" data-diff-breakpoint="${opts.diffBreakpointPx}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · Ridgestack</title>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/app.css">
</head>
<body class="${esc(opts.bodyClass ?? '')}">
${announcement}
<nav class="navpill" role="navigation" aria-label="Workspace">
  <a class="wordmark-link" href="/"><span class="wordmark-small" aria-hidden="true">Ridgestack</span></a>
  ${nav}
</nav>
<main class="column">
${content}
</main>
<div class="sr-status" role="status" aria-label="Action status" id="action-status"></div>
<div class="sr-status" role="status" aria-label="Review updates" id="review-updates"></div>
<div class="toast-stack" id="toast-stack" aria-hidden="true"></div>
<script src="/client.js" defer></script>
</body>
</html>`;
}

/** A time element with the server-formatted text and ISO datetime. */
export function timeEl(iso: string, display: string): string {
  return `<time datetime="${esc(iso)}">${esc(display)}</time>`;
}

export function emptyState(sentence: string, linkHref: string, linkText: string): string {
  return `<div class="empty"><p class="empty-text">${esc(sentence)}</p><a class="arrow-link" href="${esc(linkHref)}">${esc(linkText)}</a></div>`;
}

export function statusBar(state: string): string {
  const icons: Record<string, string> = {
    draft: '○', open: '◑', queued: '◈', merged: '●', removed: '✕',
  };
  return `<span class="status-bar st-${esc(state)}"><span aria-hidden="true">${icons[state] ?? '○'}</span><span class="st-word">${esc(state)}</span></span>`;
}
