import { PAGE_TITLES, isShellRoute } from "./pages.js";
/** The accent of a route: cyan on part routes, band on dashboard and rooms. */
export function accentOf(path: string): "cyan" | "band" {
  if (path === "/dashboard" || path.startsWith("/rooms/")) return "band";
  return "cyan";
}

export function shellHtml(path: string): string {
  const accent = accentOf(path);
  const title = PAGE_TITLES[path] ?? "Tinework";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="preload" href="/fonts/stack-sans-text-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/stack-sans-text-500.woff2" as="font" type="font/woff2" crossorigin>
<script src="/app/main.js" type="module" defer></script>
</head>
<body data-accent="${accent}">
<a class="skip" href="#main">Skip to content</a>
<header class="top-bar">
  <a class="mark" href="/" aria-label="Gimbrel Works Tinework home">Tinework</a>
  <nav class="top-links" aria-label="Account">
    <a id="nav-dashboard" href="/dashboard" hidden>Dashboard</a>
    <a id="nav-signin" href="/signin">Sign in</a>
    <button id="nav-signout" class="link-button" hidden>Sign out</button>
  </nav>
</header>
<main id="main" tabindex="-1" data-route="${escapeHtml(path)}">
  <noscript>Tinework needs JavaScript for the 3D viewport.</noscript>
  <div id="app">Loading…</div>
</main>
<div class="status-banners" id="status-banners"></div>
<svg class="chrome" aria-hidden="true">
  <rect data-ui="frame" x="0" y="0" width="0" height="0" fill="none" stroke="currentColor" stroke-width="1"/>
  <g data-ui="vertex-dots"></g>
  <g data-ui="crosshair"></g>
  <g data-ui="dimension-leader">
    <line class="leader-ext" x1="0" y1="0" x2="0" y2="0"/>
    <line class="leader-ext" x1="0" y1="0" x2="0" y2="0"/>
    <line class="leader-line" x1="0" y1="0" x2="0" y2="0"/>
    <polygon class="leader-arrow" points=""/>
    <polygon class="leader-arrow" points=""/>
    <text data-ui="leader-figure" x="0" y="0"></text>
    <text data-ui="leader-unit" x="0" y="0">\u2033</text>
  </g>
</svg>
<div id="dialog-root"></div>
</body>
</html>`;
}

export function pageOr404(path: string): { status: number; html: string } {
  if (isShellRoute(path)) return { status: 200, html: shellHtml(path) };
  return { status: 404, html: notFoundHtml() };
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found — Tinework</title><link rel="stylesheet" href="/styles.css"></head>
<body data-accent="cyan">
<main id="main" tabindex="-1" class="notfound">
<h1>Not found.</h1>
<p>That part or page does not exist.</p>
<p><a href="/">Go to the home page</a></p>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
