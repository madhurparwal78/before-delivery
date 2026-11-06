/**
 * Bio rendering: the published subset of CommonMark inline syntax, rendered by
 * the server into `bio_html`. The only elements ever produced are em, strong,
 * code, br and a; the only attribute is href, and only http: and https:
 * destinations become links.
 *
 * The renderer walks the input item by item following the published grammar.
 * It never applies a backtracking regular expression to user input. Emphasis
 * is resolved with CommonMark's delimiter algorithm over an item list, so
 * nesting and leftover characters fall out of the match positions.
 */

const ASCII_PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));

function escapeHtml(s: string): string {
  let out = '';
  for (const ch of s) {
    out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch;
  }
  return out;
}

function isWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** Punctuation for the flanking rules: any Unicode punctuation or symbol. */
function isPunct(ch: string): boolean {
  if (ASCII_PUNCT.has(ch)) return true;
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x00a1 && c <= 0x00bf && c !== 0x00a7 && c !== 0x00b6) ||
    c === 0x00a7 ||
    c === 0x00b6 ||
    c === 0x00d7 ||
    c === 0x00f7 ||
    (c >= 0x2010 && c <= 0x205f) ||
    (c >= 0x2190 && c <= 0x2bff) ||
    (c >= 0x3000 && c <= 0x3020) ||
    (c >= 0xfe10 && c <= 0xfe19) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff01 && c <= 0xff65) ||
    (c >= 0x1f300 && c <= 0x1f5ff) ||
    (c >= 0x1f680 && c <= 0x1f6ff)
  );
}

/* ------------------------------------------------------------------ *
 * Items: the inline stream after code spans, autolinks, escapes and   *
 * breaks are extracted. Delimiter runs appear as their own items so   *
 * the matcher can walk them.                                          *
 * ------------------------------------------------------------------ */

interface TxtItem {
  k: 'txt';
  s: string;
  /** Escaped characters can never be delimiters or markup. */
  esc: boolean;
}
interface AtomItem {
  k: 'atom';
  html: string;
}
interface DelimItem {
  k: 'delim';
  ch: string;
  /** Characters remaining on the run. */
  len: number;
  /** The run's original length, for the rule of three. */
  origLen: number;
  canOpen: boolean;
  canClose: boolean;
}
interface NodeItem {
  k: 'node';
  tag: 'em' | 'strong' | 'a';
  href: string;
  children: Item[];
}

type Item = TxtItem | AtomItem | DelimItem | NodeItem;

/** Scan the source into items. */
function scanItems(src: string): Item[] {
  const items: Item[] = [];
  let txt = '';
  const flush = (): void => {
    if (txt !== '') items.push({ k: 'txt', s: txt, esc: false });
    txt = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n' || next === '\r') {
        flush();
        items.push({ k: 'atom', html: '<br>\n' });
        i += next === '\r' && src[i + 2] === '\n' ? 3 : 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
        continue;
      }
      if (next !== undefined && ASCII_PUNCT.has(next)) {
        flush();
        items.push({ k: 'txt', s: next, esc: true });
        i += 2;
        continue;
      }
      txt += ch;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      // Two or more trailing spaces made a hard break; they are dropped either
      // way, as are spaces at the start of the next line.
      let spaces = 0;
      while (spaces < 2) {
        const last = items[items.length - 1];
        if (!last || last.k !== 'txt' || last.esc) break;
        const before = last.s.length;
        last.s = last.s.replace(/ +$/, '');
        spaces += before - last.s.length;
        if (last.s === '') items.pop();
        if (before === last.s.length) break;
      }
      if (txt !== '') {
        const before = txt.length;
        txt = txt.replace(/ +$/, '');
        spaces += before - txt.length;
      }
      flush();
      items.push(spaces >= 2 ? { k: 'atom', html: '<br>\n' } : { k: 'txt', s: '\n', esc: false });
      while (src[i] === ' ' || src[i] === '\t') i++;
      continue;
    }
    if (ch === '`') {
      const run = backtickRun(src, i);
      const close = findCodeCloser(src, i + run, run);
      if (close !== -1) {
        flush();
        let content = src.slice(i + run, close).replace(/\r\n?|\n/g, ' ');
        if (content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        items.push({ k: 'atom', html: '<code>' + escapeHtml(content) + '</code>' });
        i = close + run;
        continue;
      }
      txt += '`'.repeat(run);
      i += run;
      continue;
    }
    if (ch === '<') {
      const auto = tryAutolink(src, i);
      if (auto) {
        flush();
        items.push({ k: 'atom', html: auto.html });
        i = auto.next;
        continue;
      }
      txt += ch;
      i++;
      continue;
    }
    if (ch === '*' || ch === '_') {
      flush();
      let end = i;
      while (src[end] === ch) end++;
      items.push(makeDelim(src, ch, i, end));
      i = end;
      continue;
    }
    if (ch === '[' || ch === ']') {
      flush();
      items.push({ k: 'txt', s: ch, esc: false });
      i++;
      continue;
    }
    txt += ch;
    i++;
  }
  flush();
  return items;
}

/**
 * Build a delimiter item with its flanking flags. The flanking characters are
 * read from the raw source: an escaped delimiter is never a delimiter, so the
 * character before a run is the last unescaped delimiter of the run itself.
 */
function makeDelim(src: string, ch: string, start: number, end: number): DelimItem {
  const prev = start === 0 ? ' ' : src[start - 1]!;
  const next = end === src.length ? ' ' : src[end]!;
  const leftFl = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
  const rightFl = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
  const canOpen = ch === '*' ? leftFl : leftFl && (!rightFl || isPunct(prev));
  const canClose = ch === '_' ? rightFl && (!leftFl || isPunct(next)) : rightFl;
  return { k: 'delim', ch, len: end - start, origLen: end - start, canOpen, canClose };
}

function backtickRun(src: string, at: number): number {
  let n = 0;
  while (src[at + n] === '`') n++;
  return n;
}

function findCodeCloser(src: string, from: number, len: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '`') {
      const run = backtickRun(src, i);
      if (run === len) return i;
      i += run;
      continue;
    }
    i++;
  }
  return -1;
}

function tryAutolink(src: string, i: number): { html: string; next: number } | null {
  let j = i + 1;
  let scheme = '';
  while (j < src.length) {
    const c = src[j]!;
    if (c === ':') break;
    if (!/[A-Za-z0-9+.\-]/.test(c)) return null;
    scheme += c;
    j++;
  }
  if (scheme === '' || !/[A-Za-z]/.test(scheme[0]!) || src[j] !== ':') return null;
  let url = '';
  j++;
  while (j < src.length) {
    const c = src[j]!;
    if (c === '>' || isWs(c) || c === '<') break;
    url += c;
    j++;
  }
  if (url === '' || src[j] !== '>') return null;
  const full = scheme + ':' + url;
  if (/^https?:/i.test(full)) {
    const esc = escapeHtml(full);
    return { html: '<a href="' + esc + '">' + esc + '</a>', next: j + 1 };
  }
  return { html: escapeHtml('<' + full + '>'), next: j + 1 };
}

/* ------------------------------------------------------------------ *
 * Links: pair brackets with their destinations. Link text may contain  *
 * emphasis and code spans, but not other links. A bracketed shape     *
 * whose destination is not http(s) is held literal, with no markup    *
 * inside, exactly as its source characters read.                      *
 * ------------------------------------------------------------------ */

/**
 * Read a destination `( … )` starting at item index `at`, whose item must begin
 * with `(`. The destination may span several consecutive items; the first `)`
 * that is not balanced ends it. Returns the href, the index of the item holding
 * the closing paren, and any text that followed it in that same item.
 */
function readDestination(
  items: Item[],
  at: number,
): { href: string; lastIdx: number; tail: string } | null {
  const first = items[at];
  if (!first || first.k !== 'txt' || first.esc || first.s[0] !== '(') return null;
  let depth = 1;
  let href = '';
  let idx = at;
  let charPos = 1;
  while (idx < items.length) {
    const item = items[idx]!;
    if (item.k === 'atom' || item.k === 'node') {
      return null; // a code span, autolink, break or link ends the shape
    }
    const s = item.k === 'delim' ? item.ch.repeat(item.len) : item.s;
    while (charPos < s.length) {
      const c = s[charPos]!;
      if (c === '(') depth++;
      if (c === ')') {
        depth--;
        if (depth === 0) {
          if (href === '' || isWs(href[0]!) || isWs(href[href.length - 1]!)) return null;
          return { href, lastIdx: idx, tail: s.slice(charPos + 1) };
        }
      }
      if (isWs(c) || c === '[' || c === ']') return null;
      href += c;
      charPos++;
    }
    idx++;
    charPos = 0;
  }
  return null;
}

/** Replace bracketed links with link nodes, innermost first. */
function formLinks(items: Item[]): void {
  let progress = true;
  while (progress) {
    progress = false;
    const opens: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.k !== 'txt' || item.esc) continue;
      if (item.s === '[') {
        opens.push(i);
        continue;
      }
      if (item.s === ']') {
        const open = opens.pop();
        if (open === undefined) continue;
        const read = readDestination(items, i + 1);
        if (!read) continue;
        const children = items.slice(open + 1, i);
        const allowed =
          /^https?:\/\//i.test(read.href) && read.href.length > 'https://'.length;
        // The whole bracket shape, from `[` through the closing paren. The
        // destination item's tail is excluded, because it is kept as text after
        // the shape.
        let source = literalText(items.slice(open, read.lastIdx + 1));
        if (read.tail !== '') source = source.slice(0, source.length - read.tail.length);
        const replacement: Item[] = allowed
          ? [{ k: 'node', tag: 'a', href: read.href, children: processChildren(children) }]
          : [{ k: 'txt', s: source, esc: false }];
        if (read.tail !== '') replacement.push({ k: 'txt', s: read.tail, esc: false });
        items.splice(open, read.lastIdx + 1 - open, ...replacement);
        // Restart the scan: indices have shifted.
        progress = true;
        break;
      }
    }
  }
}

/** Flatten a held-literal span back to its source characters. */
function literalText(span: Item[]): string {
  let out = '';
  for (const item of span) {
    switch (item.k) {
      case 'txt':
        out += item.s;
        break;
      case 'atom':
        out += atomSource(item.html);
        break;
      case 'delim':
        out += item.ch.repeat(item.len);
        break;
      case 'node':
        out += nodeSource(item);
        break;
    }
  }
  return out;
}

/** The source characters that produced an atom. */
function atomSource(html: string): string {
  if (html === '<br>\n') return '  \n';
  if (html.startsWith('<code>')) {
    const body = html
      .slice(6, -7)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    return '`' + body + '`';
  }
  if (html.startsWith('<a href="')) {
    const url = html
      .slice(9, -4)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
    return '<' + url + '>';
  }
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function nodeSource(node: NodeItem): string {
  if (node.tag === 'a') return '[' + literalText(node.children) + '](' + node.href + ')';
  return literalText(node.children);
}

/** Resolve emphasis inside link text, where it never crosses the brackets. */
function processChildren(children: Item[]): Item[] {
  processEmphasis(children);
  return children;
}

/* ------------------------------------------------------------------ *
 * Emphasis: CommonMark's delimiter algorithm over the item list.      *
 * ------------------------------------------------------------------ */

function processEmphasis(items: Item[]): void {
  let i = 0;
  while (i < items.length) {
    const closer = items[i]!;
    if (closer.k !== 'delim' || !closer.canClose || closer.len === 0) {
      i++;
      continue;
    }
    let openerIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      const o = items[j]!;
      if (o.k !== 'delim' || o.ch !== closer.ch || !o.canOpen || o.len === 0) continue;
      const oAmbi = o.canOpen && o.canClose;
      const cAmbi = closer.canOpen && closer.canClose;
      if (oAmbi || cAmbi) {
        const sum = o.origLen + closer.origLen;
        if (sum % 3 === 0 && !(o.origLen % 3 === 0 && closer.origLen % 3 === 0)) continue;
      }
      openerIdx = j;
      break;
    }
    if (openerIdx === -1) {
      i++;
      continue;
    }
    const opener = items[openerIdx] as DelimItem;
    const use = opener.len >= 2 && closer.len >= 2 ? 2 : 1;
    const children = items.splice(openerIdx + 1, i - openerIdx - 1);
    // Delimiter runs inside the new element are resolved first: emphasis never
    // crosses out of it, so anything left inside is literal.
    processEmphasis(children);
    items.splice(
      openerIdx + 1,
      0,
      { k: 'node', tag: use === 2 ? 'strong' : 'em', href: '', children },
    );
    opener.len -= use;
    closer.len -= use;
    // Indices shifted: the closer is now at openerIdx + 2.
    let closerIdx = openerIdx + 2;
    if (opener.len === 0) {
      items.splice(openerIdx, 1);
      closerIdx--;
    }
    if (closer.len === 0) {
      items.splice(closerIdx, 1);
      // Stay at the item that followed the closer.
      i = closerIdx;
      continue;
    }
    // The closer has characters left; it may close again.
    i = closerIdx;
  }
  // Delimiter runs left over are literal text.
  for (let j = 0; j < items.length; j++) {
    const item = items[j]!;
    if (item.k === 'delim') {
      items[j] = { k: 'txt', s: item.ch.repeat(item.len), esc: false };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Rendering.                                                          *
 * ------------------------------------------------------------------ */

function renderItems(items: Item[]): string {
  let out = '';
  for (const item of items) out += renderItem(item);
  return out;
}

function renderItem(item: Item): string {
  switch (item.k) {
    case 'txt':
      return escapeHtml(item.s);
    case 'atom':
      return item.html;
    case 'delim':
      // Leftover delimiter runs that survived resolution are literal text.
      return escapeHtml(item.ch.repeat(item.len));
    case 'node':
      if (item.tag === 'a') {
        return '<a href="' + escapeHtml(item.href) + '">' + renderItems(item.children) + '</a>';
      }
      return '<' + item.tag + '>' + renderItems(item.children) + '</' + item.tag + '>';
  }
}

/** Render a bio to inline HTML with no paragraph wrapper. */
export function renderBio(src: string): string {
  const trimmed = src.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');
  if (trimmed === '') return '';
  const items = scanItems(trimmed);
  formLinks(items);
  processEmphasis(items);
  return renderItems(items);
}
