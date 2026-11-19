import { fixed } from '../shared/copy.js';
import { displayText } from '../shared/types.js';
import type { LoadedView } from './outline.js';
import type { DisplayNode } from './tree.js';

export type ExportFormat = 'text' | 'markdown' | 'opml';

export interface ExportFile {
  body: string;
  contentType: string;
  filename: string;
}

const EXTENSIONS: Record<ExportFormat, string> = { text: 'txt', markdown: 'md', opml: 'opml' };
const CONTENT_TYPES: Record<ExportFormat, string> = {
  text: 'text/plain; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  opml: 'text/x-opml; charset=utf-8'
};

function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'bullet' : slug;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Line {
  node: DisplayNode;
  level: number;
  text: string;
  completed: boolean;
  isCopy: boolean;
  tags: string[];
  mentions: string[];
  date: string | null;
}

/** The rows a download covers: the view's own rows, with copies as single lines. */
function linesOf(view: LoadedView): Line[] {
  const rows = view.rootId === null ? view.nodes : view.nodes.slice(1);
  const baseLevel = rows[0]?.depth ?? 0;
  const lines: Line[] = [];
  const skipped = new Set<string>();
  for (const node of rows) {
    if (node.displayParentId !== null && skipped.has(node.displayParentId)) {
      skipped.add(node.row.id);
      continue;
    }
    const original = view.tree.original(node.row);
    const placeholder = original === undefined;
    if (node.row.mirrorOf !== null) skipped.add(node.row.id);
    lines.push({
      node,
      level: node.depth - baseLevel,
      text: placeholder ? fixed.placeholder : original.text,
      completed: placeholder ? false : original.completed,
      isCopy: node.row.mirrorOf !== null,
      tags: placeholder ? [] : original.tags,
      mentions: placeholder ? [] : original.mentions,
      date: placeholder ? null : original.date
    });
  }
  return lines;
}

function viewTitle(view: LoadedView): string {
  const first = view.nodes[0];
  if (view.rootId === null || first === undefined) return 'Home';
  const original = view.tree.original(first.row);
  return displayText({
    text: original?.text ?? '',
    placeholder: original === undefined
  });
}

export function buildExport(view: LoadedView, format: ExportFormat): ExportFile {
  const title = viewTitle(view);
  const lines = linesOf(view);
  const slug = view.rootId === null ? 'home' : slugOf(title);
  const body = format === 'opml' ? opmlBody(title, lines) : listBody(title, lines, format);
  return {
    body,
    contentType: CONTENT_TYPES[format],
    filename: `twigline-${slug}.${EXTENSIONS[format]}`
  };
}

function listBody(title: string, lines: Line[], format: 'text' | 'markdown'): string {
  const out: string[] = [];
  if (format === 'markdown') {
    out.push(`# ${title}`, '');
  }
  for (const line of lines) {
    const indent = '  '.repeat(line.level);
    if (format === 'markdown') {
      const marker = line.completed ? '- [x] ' : '- ';
      out.push(`${indent}${marker}${line.text}${line.isCopy ? ' (mirror)' : ''}`);
    } else {
      const completed = line.completed ? ' (completed)' : '';
      out.push(`${indent}- ${line.text}${completed}${line.isCopy ? ' (mirror)' : ''}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function opmlBody(title: string, lines: Line[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `<head><title>${escapeAttribute(title)}</title></head>`,
    '<body>'
  ];
  const stack: number[] = [];
  for (const line of lines) {
    while (stack.length > 0 && stack[stack.length - 1]! >= line.level) {
      const level = stack.pop()!;
      out.push(`${'  '.repeat(level + 1)}</outline>`);
    }
    const indent = '  '.repeat(line.level + 1);
    const attributes = [`_id="${escapeAttribute(line.node.row.id)}"`, `text="${escapeAttribute(line.text)}"`];
    if (line.completed) attributes.push('_complete="true"');
    if (line.tags.length > 0) attributes.push(`_tags="${escapeAttribute(line.tags.join(' '))}"`);
    if (line.mentions.length > 0) {
      attributes.push(`_mentions="${escapeAttribute(line.mentions.join(' '))}"`);
    }
    if (line.date !== null) attributes.push(`_date="${line.date}"`);
    if (line.node.row.mirrorOf !== null) {
      attributes.push(`_mirrorOf="${escapeAttribute(line.node.row.mirrorOf)}"`);
    }
    out.push(`${indent}<outline ${attributes.join(' ')}>`);
    stack.push(line.level);
  }
  while (stack.length > 0) {
    const level = stack.pop()!;
    out.push(`${'  '.repeat(level + 1)}</outline>`);
  }
  out.push('</body>', '</opml>');
  return `${out.join('\n')}\n`;
}
