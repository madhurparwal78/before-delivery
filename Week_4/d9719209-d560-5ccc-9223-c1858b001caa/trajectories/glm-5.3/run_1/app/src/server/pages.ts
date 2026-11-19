/* Page rendering: server-rendered HTML shells for every screen. Each page is
   a small static shell plus the client bundle, which fetches its data from the
   same origin. The CSP nonce is injected per response. */
import type { Ctx } from './context.js';

const SHELL_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moothall</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script type="module" src="/assets/app.js" nonce="__NONCE__" defer></script>
</head>
<body>
<div id="app"></div>
<div id="live-status" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="live-alert" role="alert" class="visually-hidden"></div>
<div id="toast-stack" aria-hidden="true"></div>
<template id="app-state">__STATE__</template>
</body>
</html>`;

export class PageRenderer {
  render(ctx: Ctx): string {
    const state = JSON.stringify({ path: ctx.path, search: ctx.url.search });
    return SHELL_HEAD.replace('__STATE__', escapeHtml(state));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
