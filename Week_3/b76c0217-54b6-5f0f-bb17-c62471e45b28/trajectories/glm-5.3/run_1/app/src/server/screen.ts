import { readFileSync } from 'node:fs';
import { pool } from './db';
import { getLivePages } from './queries';
import { storage } from './storage';
import { parseOpenApi } from './openapi';
import { renderPageHtml, renderTryItPanel, internalBase, renderContent } from './render';
import type { NavigationJson, PageRow, VersionRow, SiteRow } from './queries';
import type { RenderPageArgs } from './render';
import { pageHeadings } from '../shared/headings';

let cssCache: string | null = null;

export function css(): string {
  if (cssCache === null) {
    try {
      cssCache = readFileSync(`${process.cwd()}/dist/client/styles.css`, 'utf8');
    } catch {
      cssCache = '';
    }
  }
  return cssCache;
}

async function tryItPanelFor(operationId: string, siteId: string, versionId: string): Promise<string> {
  const importRow = await pool.query<{ id: string }>(
    'SELECT id FROM openapi_imports WHERE version_id = $1 ORDER BY imported_at DESC LIMIT 1', [versionId],
  );
  const row = importRow.rows[0];
  if (!row) return '';
  let bytes: Buffer | null = null;
  try {
    bytes = await storage.tryGet(`sites/${siteId}/versions/${versionId}/openapi/${row.id}.json`);
  } catch {
    return '';
  }
  if (!bytes) return '';
  let operation = null;
  try {
    operation = parseOpenApi(bytes).operations.find((o) => o.operationId === operationId) ?? null;
  } catch {
    return '';
  }
  if (!operation) return '';
  const codes = operation.responses.map((r) => ({ code: r.code, description: r.description }));
  const defaultCode = operation.responses.find((r) => r.code.startsWith('2'))?.code ?? operation.responses[0]?.code ?? '200';
  return renderTryItPanel(operationId, {
    method: operation.method,
    path: operation.path,
    parameters: operation.parameters.map((p) => ({ name: p.name, in: p.in, required: p.required })),
    hasBody: operation.bodyExample !== null,
    codes,
    defaultCode,
  });
}

async function replaceTryItPanels(html: string, siteId: string, versionId: string): Promise<string> {
  const matches = [...html.matchAll(/<!--TRYIT:([A-Za-z0-9_-]+)-->\n?/g)];
  let out = html;
  for (const m of matches) {
    const panel = await tryItPanelFor(m[1], siteId, versionId);
    out = out.replace(m[0], panel);
  }
  return out;
}

export type ScreenArgs = {
  page: PageRow;
  site: SiteRow;
  version: VersionRow;
  navigation: NavigationJson;
  mode: 'public' | 'preview' | 'shared';
};

export async function renderScreen(args: ScreenArgs): Promise<string> {
  const pages = await getLivePages(args.version.id);
  const pageTitles = new Map<string, string>();
  const pagePaths = new Map<string, string>();
  for (const p of pages) {
    pageTitles.set(p.id, p.title);
    pagePaths.set(p.id, p.path);
  }
  const published = await pool.query<{ slug: string; title: string }>(
    `SELECT DISTINCT v.slug, v.title FROM versions v
     JOIN publish_attempts pa ON pa.version_id = v.id AND pa.status = 'published'
     WHERE v.site_id = $1 ORDER BY v.slug`, [args.site.id],
  );
  let groupTitle = '';
  for (const tab of args.navigation.tabs) {
    for (const group of tab.groups) {
      if (group.pages.includes(args.page.id)) groupTitle = group.title;
    }
  }
  const shell = renderPageHtml({
    ...args,
    pageTitles,
    pagePaths,
    publishedVersions: published.rows,
    groupTitle,
    css: css(),
  });
  return replaceTryItPanels(shell, args.site.id, args.version.id);
}

export { renderTryItPanel, internalBase, renderContent, pageHeadings, renderPageHtml };
export type { RenderPageArgs };
