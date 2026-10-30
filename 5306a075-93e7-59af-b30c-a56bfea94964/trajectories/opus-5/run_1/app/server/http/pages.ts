import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicRoadmapColumn } from './routes/roadmap';

export const CLIENT_ROOT = join(process.cwd(), 'dist', 'client');

let shell = '';
let styleHrefs: string[] = [];

export function loadClientShell(): void {
  shell = readFileSync(join(CLIENT_ROOT, 'index.html'), 'utf8');
  styleHrefs = [...shell.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)].map((match) => match[1]);
}

export function appShellHtml(): string {
  return shell;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

const ORNAMENT = `<svg class="ornament" viewBox="0 0 240 24" role="img" aria-label="Paper and ink ornament"
 xmlns="http://www.w3.org/2000/svg" focusable="false">
<path d="M0 12h72" stroke="currentColor" stroke-width="1" />
<path d="M168 12h72" stroke="currentColor" stroke-width="1" />
<path d="M84 12c6-9 12-9 18 0s12 9 18 0 12-9 18 0" fill="none" stroke="currentColor" stroke-width="1.5" />
<circle cx="120" cy="12" r="2.5" fill="currentColor" />
</svg>`;

function head(title: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<meta name="robots" content="noindex" />' +
    `<title>${escapeHtml(title)}</title>` +
    styleHrefs.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`).join('') +
    '</head>'
  );
}

export function publicRoadmapPage(columns: readonly PublicRoadmapColumn[]): string {
  const sections = columns
    .map(
      (column) =>
        `<section class="public-month" aria-labelledby="month-${escapeHtml(column.month)}">` +
        `<h2 id="month-${escapeHtml(column.month)}" class="display">${escapeHtml(column.label)}</h2>` +
        column.releases
          .map(
            (release) =>
              '<article class="public-release">' +
              `<h3 class="display">${escapeHtml(release.name)}</h3>` +
              '<ul class="public-features">' +
              release.features
                .map(
                  (feature) =>
                    `<li><span class="public-feature-name">${escapeHtml(feature.name)}</span>` +
                    `<span class="public-feature-description">${escapeHtml(feature.publicDescription)}</span></li>`,
                )
                .join('') +
              '</ul></article>',
          )
          .join('') +
        '</section>',
    )
    .join('');
  return (
    head('Product roadmap') +
    '<body class="public-body"><main class="public-roadmap">' +
    `<header class="public-header">${ORNAMENT}<h1 class="display">Product roadmap</h1></header>` +
    (sections === '' ? '<p class="empty">No public releases yet.</p>' : sections) +
    '</main></body></html>'
  );
}

export function inactiveRoadmapPage(): string {
  return (
    head('Roadmap link') +
    '<body class="public-body"><main class="public-roadmap">' +
    '<h1 class="display">This roadmap link is no longer active</h1>' +
    '</main></body></html>'
  );
}
