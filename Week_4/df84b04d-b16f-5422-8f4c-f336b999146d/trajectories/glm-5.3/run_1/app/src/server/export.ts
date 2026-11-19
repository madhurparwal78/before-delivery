import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError } from './store.js';
import type { Account } from '../domain/types.js';
import { viewOrder } from '../domain/tree.js';
import { loadScope } from './outline-service.js';
import { escapeXml, slug, PLACEHOLDER_COPY } from '../domain/text.js';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

export async function buildExport(
  pool: Pool,
  config: Config,
  account: Account,
  rootId: string | null,
  format: 'text' | 'markdown' | 'opml',
): Promise<ExportFile> {
  const now = Date.now();
  const loaded = await loadScope(pool, account, rootId, now, config);
  const entries = viewOrder(loaded.rows, loaded.root ? loaded.root.id : null, now, config.trashSeconds);
  const visible = new Set(entries.map((e) => e.placement.id));
  const viewText = loaded.root ? loaded.root.text.trim() || 'Untitled' : 'Home';
  const base = slug(loaded.root ? loaded.root.text.trim() || 'Untitled' : 'home');
  if (format === 'text' || format === 'markdown') {
    const lines: string[] = [];
    if (format === 'markdown') {
      lines.push(`# ${viewText}`);
      lines.push('');
    }
    for (const entry of entries) {
      const indent = '  '.repeat(entry.depth);
      const text = entry.placeholder ? PLACEHOLDER_COPY : entry.placement.text;
      const completedMark = format === 'markdown' && entry.original.completed && !entry.placeholder ? '[x] ' : '';
      let line = `${indent}- ${completedMark}${text}`;
      if (entry.placement.originalId !== null && !entry.placeholder) {
        line += ' (mirror)';
      }
      if (format === 'text' && entry.original.completed && !entry.placeholder) {
        line += ' (completed)';
      }
      lines.push(line);
    }
    return {
      filename: `${base}.${format === 'text' ? 'txt' : 'md'}`,
      contentType: format === 'text' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      body: lines.join('\n') + '\n',
    };
  }
  const outline = (entry: (typeof entries)[number]): string => {
    const text = entry.placeholder ? PLACEHOLDER_COPY : entry.placement.text;
    const attrs: string[] = [`_id="${escapeXml(entry.placement.id)}"`];
    if (!entry.placeholder && entry.original.completed) attrs.push('_complete="true"');
    if (entry.placement.originalId) attrs.push(`_mirrorOf="${escapeXml(entry.placement.originalId)}"`);
    if (!entry.placeholder) {
      if (entry.original.tags.length > 0) attrs.push(`_tags="${escapeXml(entry.original.tags.join(' '))}"`);
      if (entry.original.mentions.length > 0) attrs.push(`_mentions="${escapeXml(entry.original.mentions.join(' '))}"`);
      if (entry.original.date) attrs.push(`_date="${escapeXml(entry.original.date)}"`);
    }
    const children = entries.filter((e) => e.placement.parentId === entry.placement.id);
    if (children.length === 0) {
      return `<outline text="${escapeXml(text)}" ${attrs.join(' ')}/>`;
    }
    const inner = children.map(outline).join('\n');
    return `<outline text="${escapeXml(text)}" ${attrs.join(' ')}>\n${inner}\n</outline>`;
  };
  const top = entries.filter((e) => {
    if (e.placement.parentId === null) return true;
    return !visible.has(e.placement.parentId);
  });
  const body = top.map(outline).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>${escapeXml(viewText)}</title></head>\n<body>\n${body}\n</body>\n</opml>\n`;
  return { filename: `${base}.opml`, contentType: 'text/x-opml; charset=utf-8', body: xml };
}

export function parseExportFormat(value: string | null): 'text' | 'markdown' | 'opml' {
  if (value === 'text' || value === 'markdown' || value === 'opml') return value;
  throw new ApiError(422, { errors: { format: 'Send text, markdown or opml.' } });
}
