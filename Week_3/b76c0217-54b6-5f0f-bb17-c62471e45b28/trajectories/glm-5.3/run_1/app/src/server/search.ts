import { pool } from './db';
import { getLivePages, getTabs, getGroupsForTabs } from './queries';
import { pageHeadings } from '../shared/headings';
import { parsePage, plainTextOfInlines } from '../shared/markdown';
import type { Block } from '../shared/markdown';

export type SearchResult = { pageId: string; title: string; group: string; heading: string | null; url: string };

export function searchRank(query: string, pages: { id: string; path: string; title: string; source: string; group: string }[]): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const out: SearchResult[] = [];
  for (const p of pages) {
    const titleMatch = p.title.toLowerCase().includes(q);
    if (titleMatch) {
      out.push({ pageId: p.id, title: p.title, group: p.group, heading: null, url: `/docs-path/${p.path}` });
      continue;
    }
    const headings = pageHeadings(p.source);
    const headingMatch = headings.find((h) => h.text.toLowerCase().includes(q));
    if (headingMatch) {
      out.push({ pageId: p.id, title: p.title, group: p.group, heading: headingMatch.text, url: `/docs-path/${p.path}#${headingMatch.anchor}` });
      continue;
    }
    if (bodyText(p.source).toLowerCase().includes(q)) {
      out.push({ pageId: p.id, title: p.title, group: p.group, heading: null, url: `/docs-path/${p.path}` });
    }
  }
  return out;
}

export function bodyText(source: string): string {
  const parsed = parsePage(source);
  const parts: string[] = [];
  collectText(parsed.blocks, parts);
  return parts.join(' ');
}

function collectText(blocks: Block[], out: string[]): void {
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading': out.push(b.text); break;
      case 'paragraph': out.push(plainTextOfInlines(b.inlines)); break;
      case 'list': for (const item of b.items) out.push(plainTextOfInlines(item)); break;
      case 'code': break;
      case 'callout': collectText(b.children, out); break;
      case 'accordion': collectText(b.children, out); break;
      case 'tabs': for (const t of b.tabs) collectText(t.children, out); collectText(b.trailing, out); break;
      case 'steps': for (const s of b.steps) collectText(s.children, out); collectText(b.trailing, out); break;
      case 'cards': for (const c of b.cards) collectText(c.children, out); collectText(b.trailing, out); break;
      case 'code-group': break;
    }
  }
}

export async function navigationOrderedPages(versionId: string): Promise<{ id: string; path: string; title: string; source: string; group: string }[]> {
  const pages = await getLivePages(versionId);
  const tabs = await getTabs(versionId);
  const groups = await getGroupsForTabs(tabs.map((t) => t.id));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ordered: { id: string; path: string; title: string; source: string; group: string }[] = [];
  for (const tab of tabs) {
    for (const g of groups.filter((x) => x.tab_id === tab.id).sort((a, b) => a.position - b.position)) {
      for (const p of pages.filter((x) => x.group_id === g.id).sort((a, b) => a.position - b.position)) {
        ordered.push({ id: p.id, path: p.path, title: p.title, source: p.source, group: g.title });
      }
    }
  }
  for (const p of pages) {
    if (!groupById.has(p.group_id ?? '') && !ordered.some((x) => x.id === p.id)) {
      ordered.push({ id: p.id, path: p.path, title: p.title, source: p.source, group: '' });
    }
  }
  return ordered;
}
