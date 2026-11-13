import { ProjectRow } from './access';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';

export type WikiRow = { id: number; slug: string; version: number; title: string; content: string; author: string };

export const slugPattern = /^[a-z0-9\-/]+$/;

export function escapeHtml(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, body: string) => `<strong>${body}</strong>`);
  out = out.replace(/\*([^*]+)\*/g, (_match, body: string) => `<em>${body}</em>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt: string, href: string) =>
    href.startsWith('http') || href.startsWith('/') ? `<img src="${href}" alt="${alt}">` : match,
  );
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/') || href.startsWith('#')) {
      return `<a href="${href}">${label}</a>`;
    }
    return match;
  });
  return out;
}

export function renderMarkdown(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        body.push(escapeHtml(lines[index]));
        index += 1;
      }
      index += 1;
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*[-*]\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[index + 1])) {
      const header = line.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '');
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && lines[index].includes('|')) {
        const cells = lines[index].split('|').map((cell) => cell.trim()).filter((cell) => cell !== '');
        rows.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }
      out.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join(
          '',
        )}</tbody></table>`,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() !== '' && !lines[index].startsWith('#') && !lines[index].startsWith('```')) {
      paragraph.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('');
}

export async function latestWiki(sql: Sql, projectId: number, slug: string): Promise<WikiRow | null> {
  const row = await sql.one<WikiRow>(
    `select id, slug, version, title, content, author from wiki_pages
     where project_id = $1 and slug = $2 order by version desc limit 1`,
    [projectId, slug],
  );
  return row === null ? null : { ...row, id: Number(row.id), version: Number(row.version) };
}

export async function wikiVersions(sql: Sql, projectId: number, slug: string): Promise<WikiRow[]> {
  const rows = await sql.query<WikiRow>(
    `select id, slug, version, title, content, author from wiki_pages
     where project_id = $1 and slug = $2 order by version`,
    [projectId, slug],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), version: Number(row.version) }));
}

export async function saveWiki(
  t: Tx,
  project: ProjectRow,
  slug: string,
  title: string,
  content: string,
  baseVersion: number,
  author: string,
): Promise<WikiRow> {
  if (!slugPattern.test(slug)) throw errors.validation('slug', `bad value for slug`);
  const latest = await latestWiki(t.sql, project.id, slug);
  const currentVersion = latest === null ? 0 : latest.version;
  if (baseVersion !== currentVersion) {
    throw errors.conflict(
      'stale_wiki',
      `${latest?.author ?? 'Someone'} edited this page. Your base version ${baseVersion} is behind ${currentVersion}.`,
    );
  }
  const version = currentVersion + 1;
  const row = await t.sql.one<{ id: string }>(
    `insert into wiki_pages (project_id, slug, version, title, content, author)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [project.id, slug, version, title, content, author],
  );
  await emit(t, project.id, 'wiki', { slug, version });
  return { id: Number(row?.id), slug, version, title, content, author };
}
