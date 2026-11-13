import { importOfVersion, type Page, type Site, type Version } from '../db/content';
import { parsePage, renderPage, type HeadingInfo } from '../domain/markdown';
import { findOperation, parseSpec, renderReference } from '../domain/openapi';

export interface PageRender {
  aboveTitle: string;
  html: string;
  text: string;
  headings: HeadingInfo[];
}

/** Renders one page's content the one way: markdown pages and generated reference pages. */
export async function renderPageContent(
  page: Page,
  site: Site,
  version: Version,
): Promise<PageRender> {
  const ctx = { siteSlug: site.slug, versionSlug: version.slug };
  if (page.kind === 'reference' && page.operationId !== null) {
    const stored = await importOfVersion(version.id);
    const spec = stored === null ? null : parseSpec(Buffer.from(JSON.stringify(stored.spec)));
    const operation = spec === null ? undefined : findOperation(spec, page.operationId);
    if (operation !== undefined) return renderReference(operation, ctx);
  }
  const parsed = parsePage(page.source);
  const rendered = renderPage(parsed, ctx);
  return { aboveTitle: '', html: rendered.html, text: rendered.text, headings: rendered.headings };
}
