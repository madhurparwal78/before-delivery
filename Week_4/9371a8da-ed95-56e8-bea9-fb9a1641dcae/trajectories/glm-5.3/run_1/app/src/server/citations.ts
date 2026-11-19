export interface BibEntry {
  key: string;
  line: number;
}

export interface CitationFinding {
  key: string;
  path: string;
  line: number;
}

export interface ScanResult {
  undefined: CitationFinding[];
  unused: CitationFinding[];
  duplicate: CitationFinding[];
}

interface FileMap {
  [path: string]: string;
}

function normaliseIncludePath(raw: string): string | null {
  let x = raw.trim();
  if (x.length === 0) return null;
  const parts = x.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(p);
  }
  if (out.length === 0) return null;
  return out.join('/');
}

function withExtension(p: string, ext: string): string {
  const last = p.split('/').pop() ?? '';
  if (last.includes('.')) return p;
  return p + ext;
}

/** Strip comments: an unescaped % comments out the rest of the line. */
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && text[i + 1] === '%') {
      out += '\\%';
      i++;
      continue;
    }
    if (ch === '%') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (c === '\n') line++;
    else if (c === '\r' && text[i + 1] === '\n') {
      line++;
      i++;
    }
  }
  return line;
}

interface CiteHit {
  key: string;
  line: number;
}

/** Scan a .tex file's text for citation keys. */
function scanTexCitations(text: string): CiteHit[] {
  const clean = stripComments(text);
  const hits: CiteHit[] = [];
  const names = ['cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite'];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '\\') continue;
    let matched = '';
    for (const n of names) {
      if (clean.startsWith(n, i + 1) && (matched === '' || n.length > matched.length)) matched = n;
    }
    if (!matched) continue;
    let p = i + 1 + matched.length;
    if (clean[p] === '*') p++;
    let brackets = 0;
    let ok = true;
    while (brackets < 2 && clean[p] === '[') {
      const close = clean.indexOf(']', p);
      if (close < 0) { ok = false; break; }
      p = close + 1;
      brackets++;
    }
    if (!ok || clean[p] !== '{') continue;
    let depth = 1;
    let q = p + 1;
    while (q < clean.length && depth > 0) {
      if (clean[q] === '{') { depth++; ok = false; break; }
      if (clean[q] === '}') depth--;
      q++;
    }
    if (!ok || depth !== 0) continue;
    const inner = clean.slice(p + 1, q - 1);
    const line = lineAt(clean, i);
    for (const rawKey of inner.split(',')) {
      const k = rawKey.trim();
      if (k) hits.push({ key: k, line });
    }
  }
  return hits;
}

interface IncludeHit {
  target: string;
}

/** Scan for \input{x} and \include{x} targets. */
function scanIncludes(clean: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '\\') continue;
    let name = '';
    if (clean.startsWith('input{', i + 1)) name = 'input';
    else if (clean.startsWith('include{', i + 1)) name = 'include';
    else continue;
    const start = i + 1 + name.length + 1; // skip the opening brace
    const close = clean.indexOf('}', start);
    if (close < 0) continue;
    out.push(clean.slice(start, close));
    i = close;
  }
  return out;
}

function scanBibliographies(clean: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '\\') continue;
    if (clean.startsWith('bibliography{', i + 1)) {
      const start = i + 1 + 'bibliography'.length + 1;
      const close = clean.indexOf('}', start);
      if (close < 0) continue;
      for (const part of clean.slice(start, close).split(',')) {
        const t = part.trim();
        if (t) out.push(t);
      }
      i = close;
    } else if (clean.startsWith('addbibresource{', i + 1)) {
      const start = i + 1 + 'addbibresource'.length + 1;
      const close = clean.indexOf('}', start);
      if (close < 0) continue;
      const t = clean.slice(start, close).trim();
      if (t) out.push(t);
      i = close;
    }
  }
  return out;
}

/** Parse .bib entries. */
export function scanBibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    // The @ must start an entry: it follows whitespace or nothing, not a word character.
    if (i > 0 && !/[\s{},"]/.test(text[i - 1])) continue;
    let p = i + 1;
    let name = '';
    while (p < text.length && /[A-Za-z]/.test(text[p])) {
      name += text[p];
      p++;
    }
    const lower = name.toLowerCase();
    if (!name || lower === 'string' || lower === 'preamble' || lower === 'comment') continue;
    if (text[p] !== '{' && text[p] !== '(') continue;
    const open = text[p];
    const closeCh = open === '{' ? '}' : ')';
    let depth = 1;
    let q = p + 1;
    while (q < text.length && depth > 0) {
      if (text[q] === open) depth++;
      else if (text[q] === closeCh) depth--;
      if (depth === 0) break;
      q++;
    }
    if (depth !== 0) continue;
    const body = text.slice(p + 1, q);
    const comma = body.indexOf(',');
    const key = (comma < 0 ? body : body.slice(0, comma)).trim();
    const line = lineAt(text, i);
    if (key) entries.push({ key, line });
    i = q;
  }
  return entries;
}

export interface ScanInput {
  files: FileMap;
}

/** Exposed for tests: the comment-stripped text of a .tex file. */
export function texCitationsOf(text: string): CiteHit[] {
  return scanTexCitations(text);
}

/** Run the include-graph citation scan for a project. */
export function scanCitations(files: FileMap): ScanResult {
  const empty: ScanResult = { undefined: [], unused: [], duplicate: [] };
  const main = files['main.tex'];
  if (main === undefined) return empty;

  // 1. Collect scanned .tex files via include graph.
  const scanned = new Map<string, string>();
  const queue: string[] = ['main.tex'];
  scanned.set('main.tex', main);
  while (queue.length) {
    const path = queue.shift() as string;
    const text = files[path];
    if (text === undefined) continue;
    const clean = stripComments(text);
    for (const raw of scanIncludes(clean)) {
      const norm = normaliseIncludePath(raw);
      if (!norm) continue;
      const target = withExtension(norm, '.tex');
      if (files[target] === undefined) continue;
      if (!scanned.has(target)) {
        scanned.set(target, files[target]);
        queue.push(target);
      }
    }
  }

  // 2. Bibliographies named in scanned files.
  const bibs = new Set<string>();
  for (const [, text] of scanned) {
    const clean = stripComments(text);
    for (const raw of scanBibliographies(clean)) {
      const norm = normaliseIncludePath(raw);
      if (!norm) continue;
      const target = norm.toLowerCase().endsWith('.bib') ? norm : withExtension(norm, '.bib');
      if (files[target] !== undefined) bibs.add(target);
    }
  }

  // 3. Citations from scanned .tex files.
  const cites: { key: string; path: string; line: number }[] = [];
  let nociteAll = false;
  for (const [path, text] of scanned) {
    for (const hit of scanTexCitations(text)) {
      if (hit.key === '*' && path === 'main.tex') {
        // \nocite{*} anywhere in scanned files counts
      }
      cites.push({ key: hit.key, path, line: hit.line });
      if (hit.key === '*') nociteAll = true;
    }
  }

  // 4. Entries from scanned .bib files.
  const defs: { key: string; path: string; line: number }[] = [];
  for (const bib of bibs) {
    const text = files[bib];
    if (text === undefined) continue;
    for (const e of scanBibEntries(text)) defs.push({ key: e.key, path: bib, line: e.line });
  }

  const defined = new Set(defs.map((d) => d.key));
  const cited = new Set(cites.filter((c) => c.key !== '*').map((c) => c.key));

  const undef: CitationFinding[] = [];
  const seenUndef = new Set<string>();
  const sortedCites = [...cites].filter((c) => c.key !== '*');
  sortedCites.sort((x, y) => (x.path === y.path ? x.line - y.line : x.path < y.path ? -1 : 1));
  for (const c of sortedCites) {
    if (defined.has(c.key) || seenUndef.has(c.key)) continue;
    seenUndef.add(c.key);
    undef.push({ key: c.key, path: c.path, line: c.line });
  }

  const used = new Set(cited);
  if (nociteAll) for (const d of defs) used.add(d.key);
  const unused: CitationFinding[] = [];
  const seenUnused = new Set<string>();
  const sortedDefs = [...defs];
  sortedDefs.sort((x, y) => (x.path === y.path ? x.line - y.line : x.path < y.path ? -1 : 1));
  for (const d of sortedDefs) {
    if (used.has(d.key) || seenUnused.has(d.key)) continue;
    seenUnused.add(d.key);
    unused.push({ key: d.key, path: d.path, line: d.line });
  }

  const duplicate: CitationFinding[] = [];
  const seenCount = new Map<string, number>();
  for (const d of sortedDefs) {
    const c = (seenCount.get(d.key) ?? 0) + 1;
    seenCount.set(d.key, c);
    if (c > 1) duplicate.push({ key: d.key, path: d.path, line: d.line });
  }

  return { undefined: undef, unused, duplicate };
}
