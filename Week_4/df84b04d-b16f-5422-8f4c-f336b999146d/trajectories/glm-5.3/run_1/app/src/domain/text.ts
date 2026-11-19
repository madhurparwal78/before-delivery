import type { BulletRow, BulletView } from './types.js';

export const PLACEHOLDER_COPY = 'This bullet was deleted.';
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function countBullets(n: number): string {
  return n === 1 ? '1 bullet' : `${n} bullets`;
}

export function trimmedName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'Untitled';
  return trimmed.slice(0, 60);
}

export function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base || 'bullet';
}

export function toBulletView(
  row: BulletRow,
  depth: number,
  placeholder: boolean,
  childCount: number,
): Record<string, unknown> & BulletView {
  const isPlaceholder = placeholder || row.purged;
  return {
    id: row.id,
    parentId: row.parentId,
    position: row.position,
    depth,
    text: isPlaceholder ? '' : row.text,
    completed: isPlaceholder ? false : row.completed,
    collapsed: row.collapsed,
    date: isPlaceholder ? null : row.date,
    tags: isPlaceholder ? [] : row.tags,
    mentions: isPlaceholder ? [] : row.mentions,
    mirrorOf: row.originalId,
    placeholder: isPlaceholder,
    revision: isPlaceholder ? 1 : row.revision,
    childCount: isPlaceholder ? 0 : childCount,
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseIsoDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) {
      return zeroPad(y, 4) + '-' + zeroPad(m, 2) + '-' + zeroPad(d, 2);
    }
    return null;
  }
  return null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zeroPad(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

const DATE_TOKEN = /!\(([^)]*)\)/;

export interface DateRecognition {
  canonicalText: string;
  date: string | null;
}

export function formatDateForDisplay(date: string): string {
  const parts = date.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return `${d} ${(MONTHS[m - 1] ?? '').toLowerCase()} ${y}`;
}

export function parseDateToken(raw: string, today: string): { iso: string } | null {
  const value = raw.trim();
  const iso = parseIsoDate(value);
  if (iso) return { iso };
  const dayMonthName = value.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (dayMonthName) {
    const d = Number(dayMonthName[1] ?? '');
    const month = MONTHS.indexOf(String(dayMonthName[2] ?? '').toLowerCase());
    const y = Number(dayMonthName[3] ?? '');
    if (month >= 0 && d >= 1 && d <= daysInMonth(y, month + 1)) {
      return { iso: `${zeroPad(y, 4)}-${zeroPad(month + 1, 2)}-${zeroPad(d, 2)}` };
    }
    return null;
  }
  const monthDay = value.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (monthDay) {
    const month = MONTHS.indexOf(String(monthDay[1] ?? '').toLowerCase());
    const d = Number(monthDay[2] ?? '');
    if (month >= 0 && d >= 1 && d <= daysInMonth(2026, month + 1)) {
      const tp = today.split('-');
      const ty = Number(tp[0]);
      const tm = Number(tp[1]);
      const td = Number(tp[2]);
      let y = ty;
      if (month + 1 < tm || (month + 1 === tm && d < td)) y = ty + 1;
      return { iso: `${zeroPad(y, 4)}-${zeroPad(month + 1, 2)}-${zeroPad(d, 2)}` };
    }
    return null;
  }
  if (/^today$/i.test(value)) return { iso: today };
  if (/^tomorrow$/i.test(value)) {
    const t = new Date(today + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1);
    return { iso: t.toISOString().slice(0, 10) };
  }
  return null;
}

export function rewriteDates(text: string, today: string): DateRecognition {
  const match = DATE_TOKEN.exec(text);
  if (!match) return { canonicalText: text, date: null };
  const parsed = parseDateToken(match[1] ?? '', today);
  if (!parsed) return { canonicalText: text, date: null };
  const canonicalText =
    text.slice(0, match.index) + `!(${parsed.iso})` + text.slice(match.index + match[0].length);
  return { canonicalText, date: parsed.iso };
}

export function extractTags(text: string): string[] {
  return unique(
    (text.match(/(?:^|\s)#([A-Za-z0-9_-]+)/g) ?? []).map((t) =>
      t.trim().slice(1).toLowerCase(),
    ),
  );
}

export function extractMentions(text: string): string[] {
  return unique(
    (text.match(/(?:^|\s)@([A-Za-z0-9_-]+)/g) ?? []).map((t) =>
      t.trim().slice(1).toLowerCase(),
    ),
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export interface SearchTerm {
  exclude: boolean;
  kind: 'word' | 'tag' | 'mention' | 'complete' | 'date';
  value: string;
}

export function parseSearchQuery(query: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  let rest = query;
  const phraseRe = /^-?"([^"]*)"|^\S+/;
  while (rest.length > 0) {
    if (/^\s/.test(rest)) {
      rest = rest.slice(1);
      continue;
    }
    const match = phraseRe.exec(rest);
    if (!match) break;
    const token = match[0];
    rest = rest.slice(token.length);
    let body = token;
    let exclude = false;
    if (body.startsWith('-')) {
      exclude = true;
      body = body.slice(1);
    }
    let inner = body;
    let quoted = false;
    if (inner.startsWith('"')) {
      quoted = true;
      inner = inner.slice(1, -1);
    }
    if (quoted) {
      terms.push({ exclude, kind: 'word', value: inner.toLowerCase() });
      continue;
    }
    if (/^is:complete$/i.test(inner)) {
      terms.push({ exclude, kind: 'complete', value: 'true' });
      continue;
    }
    if (/^has:date$/i.test(inner)) {
      terms.push({ exclude, kind: 'date', value: 'true' });
      continue;
    }
    if (inner.startsWith('#') && inner.length > 1) {
      terms.push({ exclude, kind: 'tag', value: inner.slice(1).toLowerCase() });
      continue;
    }
    if (inner.startsWith('@') && inner.length > 1) {
      terms.push({ exclude, kind: 'mention', value: inner.slice(1).toLowerCase() });
      continue;
    }
    if (inner.length > 0) {
      terms.push({ exclude, kind: 'word', value: inner.toLowerCase() });
    }
  }
  return terms;
}

export function bulletMatches(
  bullet: Pick<BulletRow, 'text' | 'completed' | 'date' | 'tags' | 'mentions'>,
  terms: SearchTerm[],
): boolean {
  let result = true;
  for (const term of terms) {
    const hit = matchesTerm(bullet, term);
    if (term.exclude) {
      if (hit) {
        result = false;
        break;
      }
    } else if (!hit) {
      result = false;
      break;
    }
  }
  return result;
}

function matchesTerm(
  bullet: Pick<BulletRow, 'text' | 'completed' | 'date' | 'tags' | 'mentions'>,
  term: SearchTerm,
): boolean {
  switch (term.kind) {
    case 'word':
      return bullet.text.toLowerCase().includes(term.value);
    case 'tag':
      return bullet.tags.includes(term.value);
    case 'mention':
      return bullet.mentions.includes(term.value);
    case 'complete':
      return bullet.completed;
    case 'date':
      return bullet.date !== null;
  }
}
