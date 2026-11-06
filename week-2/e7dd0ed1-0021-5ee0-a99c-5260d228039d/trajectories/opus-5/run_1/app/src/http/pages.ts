import * as fs from 'node:fs';
import * as path from 'node:path';
import { query } from '../db';
import { resolveCaller } from '../domain/auth';
import { plans, regionSeeds } from '../domain/seeddata';
import { dotGrid, project } from '../worldmap';
import { sendText, type Context } from './core';
import type { Router } from './router';

const publicDir = path.join(__dirname, '..', '..', 'public');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(title: string, bodyClass: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="${bodyClass}">
${inner}
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function worldStrip(width: number, height: number): string {
  const grid = dotGrid(width, height);
  const dots = grid.dots
    .map((dot) => `<circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="1.5" class="world-dot" />`)
    .join('');
  const pins = regionSeeds
    .map((region) => {
      const point = project(region.lon, region.lat, width, height);
      return `<g class="world-pin"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" /><text x="${(
        point.x + 10
      ).toFixed(1)}" y="${(point.y + 4).toFixed(1)}">${escapeHtml(region.name)} · ${escapeHtml(region.continent)}</text></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Farshore regions" preserveAspectRatio="xMidYMid meet" class="world-strip">${dots}${pins}</svg>`;
}

function pricingTable(): string {
  const head =
    '<thead><tr><th scope="col">Plan</th><th scope="col">Monthly price</th><th scope="col">Included storage</th><th scope="col">Included egress</th><th scope="col">Storage overage</th><th scope="col">Egress overage</th><th scope="col">Request units</th></tr></thead>';
  const body = plans
    .map(
      (plan) =>
        `<tr><th scope="row">${escapeHtml(plan.name)}</th><td class="num">${escapeHtml(plan.monthlyPrice)}</td>` +
        `<td class="num">${plan.includedStorageBytes.toLocaleString('en-US')} bytes</td>` +
        `<td class="num">${plan.includedEgressBytes.toLocaleString('en-US')} bytes</td>` +
        `<td>${escapeHtml(plan.storageOverage)}</td><td>${escapeHtml(plan.egressOverage)}</td><td>${escapeHtml(
          plan.requestUnits,
        )}</td></tr>`,
    )
    .join('');
  const cards = plans
    .map(
      (plan) =>
        `<li class="plan-card"><h3>${escapeHtml(plan.name)}</h3><dl>` +
        `<div><dt>Monthly price</dt><dd class="num">${escapeHtml(plan.monthlyPrice)}</dd></div>` +
        `<div><dt>Included storage</dt><dd class="num">${plan.includedStorageBytes.toLocaleString('en-US')} bytes</dd></div>` +
        `<div><dt>Included egress</dt><dd class="num">${plan.includedEgressBytes.toLocaleString('en-US')} bytes</dd></div>` +
        `<div><dt>Storage overage</dt><dd>${escapeHtml(plan.storageOverage)}</dd></div>` +
        `<div><dt>Egress overage</dt><dd>${escapeHtml(plan.egressOverage)}</dd></div>` +
        `<div><dt>Request units</dt><dd>${escapeHtml(plan.requestUnits)}</dd></div>` +
        `</dl></li>`,
    )
    .join('');
  return `<table class="pricing"><caption>Pricing</caption>${head}<tbody>${body}</tbody></table><ul class="plan-cards">${cards}</ul>`;
}

function marketingPage(): string {
  return shell(
    'Farshore Buckets',
    'marketing',
    `<header class="top-bar">
  <span class="wordmark">Farshore</span>
  <nav aria-label="Marketing"><a href="#pricing">Pricing</a><a href="/signin">Sign in</a></nav>
</header>
<main>
  <section class="hero">
    <h1>Every region you pick holds the bytes you shipped.</h1>
    <p class="lead">Farshore Buckets is object storage for small studios with players on several continents. Pick the regions for each bucket and watch every copy settle, object by object.</p>
    <a class="primary" href="/signin">Open the console</a>
  </section>
  <section class="strip" aria-label="Farshore regions">${worldStrip(1200, 520)}</section>
  <section class="features">
    <ul>
      <li><h2>One endpoint</h2><p>One S3-compatible endpoint for every region you place.</p></li>
      <li><h2>Per-object replica state</h2><p>See which regions hold the current version, and how long each copy took.</p></li>
      <li><h2>Versions that expire on your rules</h2><p>Old versions go when you say; held ones stay.</p></li>
      <li><h2>The bill before the invoice</h2><p>Month-to-date storage, egress and request units, as they build up.</p></li>
    </ul>
  </section>
  <section class="pricing-section" id="pricing">
    <h2>Pricing</h2>
    ${pricingTable()}
  </section>
</main>
<footer><p>Farshore Buckets · invented studios, real bytes.</p></footer>`,
  );
}

function appShell(title: string, bodyClass: string, suspended: string[] = []): string {
  const html = shell(title, bodyClass, '<div id="app"></div>');
  if (suspended.length === 0) return html;
  return html.replace(`<body class="${bodyClass}">`, `<body class="${bodyClass}" data-suspended="${escapeHtml(suspended.join(' '))}">`);
}

/** The caller's own suspended workspaces, so the console can show the banner on every page. */
async function suspendedWorkspaces(ctx: Context): Promise<string[]> {
  try {
    const caller = await resolveCaller(ctx);
    if (caller.kind !== 'active') return [];
    const slugs = caller.principal.memberships.map((membership) => membership.slug);
    if (slugs.length === 0) return [];
    const found = await query<{ slug: string }>(
      "select slug from workspaces where slug = any($1) and status = 'suspended'",
      [slugs],
    );
    return found.map((workspace) => workspace.slug);
  } catch {
    return [];
  }
}

function redirect(ctx: Context, location: string): void {
  ctx.res.statusCode = 302;
  ctx.res.setHeader('Location', location);
  ctx.res.setHeader('Content-Length', 0);
  ctx.res.end();
}

type Access = 'anonymous' | 'pending' | 'member' | 'operator' | 'unknown';

async function accessFor(ctx: Context): Promise<Access> {
  try {
    const caller = await resolveCaller(ctx);
    if (caller.kind === 'anonymous') return 'anonymous';
    if (caller.kind === 'pending') return 'pending';
    return caller.principal.user.is_operator === true ? 'operator' : 'member';
  } catch {
    return 'unknown';
  }
}

function nextTarget(ctx: Context): string {
  return encodeURIComponent(`${ctx.path}${ctx.rawQuery === '' ? '' : `?${ctx.rawQuery}`}`);
}

export function registerPageRoutes(router: Router): void {
  router.get('/', async (ctx) => {
    sendText(ctx, 200, marketingPage(), 'text/html; charset=utf-8');
  });

  router.get('/signin', async (ctx) => {
    sendText(ctx, 200, appShell('Sign in · Farshore', 'signin'), 'text/html; charset=utf-8');
  });

  router.get('/invite/:token', async (ctx) => {
    sendText(ctx, 200, appShell('Join a workspace · Farshore', 'invite'), 'text/html; charset=utf-8');
  });

  for (const pattern of ['/console', '/console/*']) {
    router.get(pattern, async (ctx) => {
      const access = await accessFor(ctx);
      if (access === 'anonymous' || access === 'pending') return redirect(ctx, `/signin?next=${nextTarget(ctx)}`);
      if (access === 'operator') return redirect(ctx, '/ops');
      sendText(ctx, 200, appShell('Console \u00b7 Farshore', 'console', await suspendedWorkspaces(ctx)), 'text/html; charset=utf-8');
    });
  }

  for (const pattern of ['/ops', '/ops/*']) {
    router.get(pattern, async (ctx) => {
      const access = await accessFor(ctx);
      if (access === 'anonymous' || access === 'pending') return redirect(ctx, `/signin?next=${nextTarget(ctx)}`);
      if (access === 'member') return redirect(ctx, '/console');
      sendText(ctx, 200, appShell('Operator · Farshore', 'ops'), 'text/html; charset=utf-8');
    });
  }

  router.get('/account', async (ctx) => {
    const access = await accessFor(ctx);
    if (access === 'anonymous' || access === 'pending') return redirect(ctx, `/signin?next=${nextTarget(ctx)}`);
    sendText(ctx, 200, appShell('Account · Farshore', 'account'), 'text/html; charset=utf-8');
  });

  router.get('/assets/*', async (ctx) => {
    const requested = path.normalize(path.join(publicDir, ctx.params.rest));
    if (!requested.startsWith(publicDir) || !fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
      sendText(ctx, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const body = fs.readFileSync(requested);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', contentTypes[path.extname(requested)] ?? 'application/octet-stream');
    ctx.res.setHeader('Content-Length', body.length);
    ctx.res.setHeader('Cache-Control', 'public, max-age=3600');
    ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
  });
}
