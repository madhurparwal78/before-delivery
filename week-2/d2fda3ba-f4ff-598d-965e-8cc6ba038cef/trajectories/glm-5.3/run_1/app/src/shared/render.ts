import type { CandidateNote, Manifest } from './domain';
import { linkTargets, splitTarget, resolveLink } from './domain';

export interface PageDoc {
  slug: string;
  title: string;
  html: string;
  plainText: string;
  linkedFrom: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');

export const pageSlugOf = (title: string): string => {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
};

/** Assign page slugs with the collision rule: first by hop then title keeps the plain slug. */
export const assignSlugs = (manifest: Manifest, notes: CandidateNote[]): Map<string, string> => {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const ordered = [...manifest.inside].map((i) => ({
    note: byId.get(i.note_id) as CandidateNote,
    hop: i.hop,
  }));
  ordered.sort((a, b) => a.hop - b.hop || a.note.title.localeCompare(b.note.title));
  const taken = new Set<string>();
  const map = new Map<string, string>();
  for (const { note } of ordered) {
    const base = pageSlugOf(note.title) || 'note';
    if (!taken.has(base)) {
      taken.add(base);
      map.set(note.id, base);
      continue;
    }
    let k = 2;
    while (taken.has(`${base}-${k}`)) k++;
    taken.add(`${base}-${k}`);
    map.set(note.id, `${base}-${k}`);
  }
  return map;
};

const stripTags = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const inline = (src: string, render: (label: string, href: string | null) => string): string => {
  const out: string[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(esc(buf));
      buf = '';
    }
  };
  while (i < src.length) {
    if (src.startsWith('`', i)) {
      const end = src.indexOf('`', i + 1);
      if (end < 0) { buf += src[i]; i++; continue; }
      flush();
      const code = src.slice(i + 1, end);
      out.push(code.includes('\n') ? `<pre><code>${esc(code)}</code></pre>` : `<code>${esc(code)}</code>`);
      i = end + 1;
      continue;
    }
    if (src.startsWith('[[', i)) {
      const end = src.indexOf(']]', i + 2);
      if (end < 0) { buf += src[i]; i++; continue; }
      flush();
      const { target, label } = splitTarget(src.slice(i + 2, end));
      out.push(render(label ?? '', `wiki:${target}`));
      i = end + 2;
      continue;
    }
    if (src[i] === '[' && src[i + 1] !== '[' && src[i - 1] !== '[' && src[i - 1] !== '!') {
      const close = src.indexOf('](', i + 1);
      if (close > 0) {
        const paren = src.indexOf(')', close + 2);
        if (paren > 0) {
          flush();
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, paren);
          const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
          const scheme = m ? m[1].toLowerCase() : '';
          if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
            out.push(`<a href="${esc(href)}" rel="noopener noreferrer nofollow">${esc(label)}</a>`);
          } else {
            out.push(esc(src.slice(i, paren + 1)));
          }
          i = paren + 1;
          continue;
        }
      }
    }
    if (src[i] === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > 0) { flush(); const inner = inline(src.slice(i + 2, end), render); out.push(`<strong>${inner}</strong>`); i = end + 2; continue; }
    }
    if (src[i] === '*') {
      const end = src.indexOf('*', i + 1);
      if (end > 0) { flush(); const inner = inline(src.slice(i + 1, end), render); out.push(`<em>${inner}</em>`); i = end + 1; continue; }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out.join('');
};

/** Render a note body to allowlisted HTML. Everything else appears as escaped text. */
export const renderBody = (body: string, renderLink: (label: string | null, target: string) => string | null): string => {
  const render = (label: string, href: string | null): string => {
    if (href === null) return esc(label);
    if (href.startsWith('wiki:')) {
      const r = renderLink(label === '' ? null : label, href.slice(5));
      return r ?? esc(label || '[withheld]');
    }
    return esc(label);
  };
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';
  let quoteBuf: string[] = [];

  const closeList = () => {
    if (listKind) { out.push(`</${listKind}>`); listKind = null; }
  };
  const closeQuote = () => {
    if (quoteBuf.length) { out.push(`<blockquote>${quoteBuf.join('<br>')}</blockquote>`); quoteBuf = []; }
  };
  const flushPara = () => {
    if (para.length) {
      closeList();
      closeQuote();
      out.push(`<p>${para.map((l) => inline(l, render)).join('<br>')}</p>`);
      para = [];
    }
  };
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const t = raw.trim();
    if (t.startsWith('```')) {
      flushPara();
      closeList();
      closeQuote();
      if (!inCode) { inCode = true; codeLang = t.slice(3).trim(); codeLines = []; }
      else {
        const attr = codeLang ? ` class="language-${esc(codeLang)}"` : '';
        out.push(`<pre><code${attr}>${esc(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }
    if (t === '') { flushPara(); closeList(); closeQuote(); continue; }
    const li = t.match(/^([-*])\s+(.*)$/);
    const oli = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (li || oli) {
      closeQuote();
      const content = li ? li[2] : oli![2];
      const isOl = Boolean(oli);
      if (listKind !== (isOl ? 'ol' : 'ul')) {
        if (listKind) out.push(`</${listKind}>`);
        listKind = isOl ? 'ol' : 'ul';
        out.push(`<${listKind}>`);
      }
      out.push(`<li>${inline(content, render)}</li>`);
      continue;
    }
    if (listKind) { out.push(`</${listKind}>`); listKind = null; }
    const bq = t.match(/^>\s?(.*)$/);
    if (bq) { quoteBuf.push(inline(bq[1], render)); continue; }
    closeQuote();
    if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) { out.push('<hr>'); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length <= 1 ? 2 : h[1].length === 2 ? 3 : 4;
      out.push(`<h${lvl}>${inline(h[2], render)}</h${lvl}>`);
      continue;
    }
    para.push(t);

  }
  flushPara();
  if (listKind) out.push(`</${listKind}>`);
  if (inCode && codeLines.length) {
    const attr = codeLang ? ` class="language-${esc(codeLang)}"` : '';
    out.push(`<pre><code${attr}>${esc(codeLines.join('\n'))}</code></pre>`);
  }
  return out.join('\n');
};

export interface RenderedPages {
  pages: PageDoc[];
  rootId: string;
  slugs: Map<string, string>;
  manifest: Manifest;
  searchIndex: Array<{ path: string; title: string; text: string }>;
  previews: Record<string, { title: string; excerpt: string }>;
  linkedFromAll: Map<string, string[]>;
}

export const renderDossierPages = (
  manifest: Manifest,
  notes: CandidateNote[],
  rootId: string,
): RenderedPages => {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const slugs = assignSlugs(manifest, notes);
  const insideIds = new Set(manifest.inside.map((i) => i.note_id));
  const slugOf = new Map<string, string>();
  for (const i of manifest.inside) slugOf.set(i.note_id, i.note_id === rootId ? '' : (slugs.get(i.note_id) as string));
  // linked-from map (inside notes linking to an inside note)
  const linkedFromAll = new Map<string, string[]>();
  for (const target of manifest.inside) linkedFromAll.set(target.note_id, []);
  for (const src of manifest.inside) {
    const note = byId.get(src.note_id) as CandidateNote;
    const seen = new Set<string>();
    for (const raw of linkTargets(note.body)) {
      const { target } = splitTarget(raw);
      const t = resolveLink(notes, target);
      if (!t || !insideIds.has(t.id)) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      (linkedFromAll.get(t.id) as string[]).push(src.note_id);
    }
  }
  // A severed link renders as plain text: its explicit label, or [withheld] when it has none.
  const renderLinkFn = (explicitLabel: string | null, target: string): string | null => {
    const t = resolveLink(notes, target);
    if (!t || !insideIds.has(t.id)) return esc(explicitLabel ?? '[withheld]');
    const slug = t.id === rootId ? '' : (slugs.get(t.id) as string);
    const href = slug === '' ? './' : `./${slug}`;
    return `<a href="${esc(href)}">${esc(explicitLabel ?? t.title)}</a>`;
  };
  const pages: PageDoc[] = manifest.inside.map((i) => {
    const note = byId.get(i.note_id) as CandidateNote;
    const slug = i.note_id === rootId ? '' : (slugs.get(i.note_id) as string);
    const html = renderBody(note.body, renderLinkFn);
    return {
      slug,
      title: note.title,
      html,
      plainText: stripTags(html),
      linkedFrom: (linkedFromAll.get(note.id) as string[]).map((id) => (id === rootId ? '' : (slugs.get(id) as string))),
    };
  });
  const searchIndex = pages.map((p) => ({ path: p.slug, title: p.title, text: p.plainText }));
  const previews: Record<string, { title: string; excerpt: string }> = {};
  for (const p of pages) previews[p.slug] = { title: p.title, excerpt: p.plainText.slice(0, 160) };
  return { pages, rootId, slugs, manifest, searchIndex, previews, linkedFromAll };
};

