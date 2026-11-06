import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  previewLinkInvalid,
  previewUnavailableHeading,
  previewWithdrawnHeading,
} from '../../shared/copy';
import type { Snapshot } from '../../shared/types';
import { formatDimensions, formatLength } from '../../shared/units';

interface ManifestEntry {
  file: string;
  css?: string[];
  imports?: string[];
}

const clientRoot = join(__dirname, '..', 'client');

function readManifest(): Record<string, ManifestEntry> {
  const text = readFileSync(join(clientRoot, '.vite', 'manifest.json'), 'utf8');
  return JSON.parse(text) as Record<string, ManifestEntry>;
}

const manifest = readManifest();

interface ClientAssets {
  file: string;
  css: string[];
}

function entry(name: 'main' | 'lender'): ClientAssets {
  const key = `src/client/${name}.tsx`;
  const found = manifest[key];
  if (!found) throw new Error(`client entry ${name} is missing from the build manifest`);
  const css: string[] = [];
  const seen = new Set<string>();
  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const asset = manifest[current];
    if (!asset) return;
    for (const href of asset.css ?? []) {
      if (!css.includes(href)) css.push(href);
    }
    for (const next of asset.imports ?? []) walk(next);
  };
  walk(key);
  return { file: found.file, css };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function head(title: string, name: 'main' | 'lender'): string {
  const asset = entry(name);
  const styles = asset.css
    .map((href) => `<link rel="stylesheet" href="/${href}">`)
    .join('');
  return [
    '<!doctype html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<link rel="preload" href="/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>',
    styles,
    `<script type="module" src="/${asset.file}"></script>`,
    '</head>',
  ].join('');
}

export function renderStaffShell(): string {
  return [
    head('Hangline', 'main'),
    '<body><div id="app"></div></body></html>',
  ].join('');
}

export function renderLenderErrorPage(kind: 'not-found' | 'withdrawn' | 'unavailable'): string {
  const heading =
    kind === 'not-found'
      ? previewLinkInvalid
      : kind === 'withdrawn'
        ? previewWithdrawnHeading
        : previewUnavailableHeading;
  return [
    head('Lender preview', 'lender'),
    '<body class="lender-page">',
    '<a class="skip-link" href="#main">Skip to main content</a>',
    '<main id="main" tabindex="-1" class="lender-main">',
    `<h1>${escapeHtml(heading)}</h1>`,
    '</main>',
    '</body></html>',
  ].join('');
}

export function renderLenderPage(snapshot: Snapshot, token: string): string {
  const works = snapshot.works
    .map((work) =>
      [
        '<li class="lender-work">',
        `<h3>${escapeHtml(work.title)}</h3>`,
        `<p class="lender-work-number">${escapeHtml(work.objectNumber)}</p>`,
        `<p class="lender-work-wall">${escapeHtml(work.wallName)}</p>`,
        `<p>Offset ${escapeHtml(formatLength(work.offsetMm, 'cm'))} from the left end</p>`,
        `<p>Centre ${escapeHtml(formatLength(work.centreHeightMm, 'cm'))} from the floor</p>`,
        `<p>${escapeHtml(formatDimensions(work.widthMm, work.heightMm, 'cm'))}</p>`,
        '</li>',
      ].join(''),
    )
    .join('');
  return [
    head(`${snapshot.exhibition.title} \u2014 lender preview`, 'lender'),
    '<body class="lender-page">',
    '<a class="skip-link" href="#main">Skip to main content</a>',
    '<main id="main" tabindex="-1" class="lender-main">',
    `<h1 class="display-title">${escapeHtml(snapshot.exhibition.title)}</h1>`,
    `<p class="lender-prepared">Prepared for ${escapeHtml(snapshot.lender.name)}</p>`,
    `<p class="lender-published">Published ${escapeHtml(snapshot.publishedAtDisplay)}</p>`,
    '<div class="lender-body">',
    '<div id="preview-scene-root"></div>',
    '<div class="lender-list">',
    '<h2>Your works in place</h2>',
    `<ul class="lender-works" aria-label="Your works">${works}</ul>`,
    '</div>',
    '</div>',
    '</main>',
    `<script type="application/json" id="snapshot-data">${JSON.stringify({
      snapshot,
      token,
    }).replace(/</g, '\\u003c')}</script>`,
    '</body></html>',
  ].join('');
}
