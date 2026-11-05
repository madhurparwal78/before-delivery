import { studioClockLabel, studioInstant } from "../time.js";
import { type UserRow } from "../domain/accounts.js";
import { icon } from "./icons.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function jsonScript(id: string, data: unknown): string {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${id}">${payload}</script>`;
}

export const STUDIO_EMAIL = "studio@pampero.test";

interface LayoutOptions {
  title: string;
  shell: "public" | "portal" | "studio";
  user: UserRow | null;
  body: string;
  data?: unknown;
  scene?: boolean;
}

function navLinks(user: UserRow | null, shell: LayoutOptions["shell"]): string {
  const prefix = shell === "public" ? "/" : "/";
  const items = [
    `<a href="${prefix}#work">Work</a>`,
    `<a href="${prefix}#process">Process</a>`,
    `<a href="${prefix}#pricing">Pricing</a>`,
    `<a href="/journal">Journal</a>`,
    user ? `<a href="/portal">Portal</a>` : `<a href="/sign-in">Sign in</a>`,
  ];
  return items.join("");
}

function header(user: UserRow | null, shell: LayoutOptions["shell"]): string {
  return `<header class="site-header">
  <span class="brand">Pampero Build Co.</span>
  <nav aria-label="Main">
    <div class="nav-inline">${navLinks(user, shell)}</div>
    <button type="button" class="nav-menu-button" data-menu-open>${icon("menu")}Menu</button>
  </nav>
</header>
<div class="menu-drawer" data-menu-drawer hidden>
  <div role="dialog" aria-modal="true" aria-label="Menu" class="menu-panel">
    <nav>${navLinks(user, shell)}</nav>
    <button type="button" data-menu-close>${icon("x")}Close menu</button>
  </div>
</div>`;
}

function footer(now: Date): string {
  return `<footer class="site-footer">
  <div role="timer" aria-label="Studio time" data-studio-clock data-now="${studioInstant(now)}">Studio time ${studioClockLabel(
    now,
  )}</div>
  <a href="mailto:${STUDIO_EMAIL}">${STUDIO_EMAIL}</a>
</footer>`;
}

function scene(): string {
  return `<div class="studio-scene" data-scene data-scene-section="hero" data-scene-turn="0" data-scene-mode="still" aria-hidden="true">
  <div class="scene-still" data-scene-still="hero"></div>
  <div class="scene-still" data-scene-still="work"></div>
  <div class="scene-still" data-scene-still="process"></div>
  <div class="scene-still" data-scene-still="pricing"></div>
  <div class="scene-still" data-scene-still="contact"></div>
</div>`;
}

export function renderPage(options: LayoutOptions): string {
  const now = new Date();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} — Pampero Build Co.</title>
<link rel="stylesheet" href="/assets/styles.css">
<script type="module" src="/assets/main.js"></script>
</head>
<body class="shell-${options.shell}">
<a class="skip-link" href="#main">Skip to content</a>
${options.scene ? scene() : ""}
${header(options.user, options.shell)}
<main id="main" class="shell-main">${options.body}</main>
${footer(now)}
${options.data === undefined ? "" : jsonScript("page-data", options.data)}
</body>
</html>`;
}
