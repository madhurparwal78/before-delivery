import { resolveFromRoot, withBibExtension, withTexExtension } from './paths.js';

export interface CitationWarning {
  key: string;
  path: string;
  line: number;
}

export interface CitationLists {
  undefined: CitationWarning[];
  unused: CitationWarning[];
  duplicate: CitationWarning[];
}

const CITATION_COMMANDS = [
  'citeauthor',
  'parencite',
  'autocite',
  'citeyear',
  'footcite',
  'textcite',
  'citealp',
  'nocite',
  'citep',
  'citet',
  'cite',
];

const LF = 10;
const CR = 13;
const PERCENT = 37;
const BACKSLASH = 92;

/** Replaces commented characters with spaces, keeping every line break in place. */
function maskComments(text: string): string {
  const pieces: string[] = [];
  let copiedTo = 0;
  let commentStart = -1;
  let backslashes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === LF || code === CR) {
      if (commentStart >= 0) {
        pieces.push(text.slice(copiedTo, commentStart), ' '.repeat(index - commentStart));
        copiedTo = index;
        commentStart = -1;
      }
      backslashes = 0;
      continue;
    }
    if (commentStart >= 0) continue;
    if (code === PERCENT && backslashes % 2 === 0) {
      commentStart = index;
      backslashes = 0;
      continue;
    }
    backslashes = code === BACKSLASH ? backslashes + 1 : 0;
  }
  if (commentStart >= 0) {
    pieces.push(text.slice(copiedTo, commentStart), ' '.repeat(text.length - commentStart));
    copiedTo = text.length;
  }
  if (copiedTo === 0) return text;
  pieces.push(text.slice(copiedTo));
  return pieces.join('');
}

/** next[i] is the smallest j >= i whose character is `ch`, or text.length. */
function buildNext(text: string, ch: string): Int32Array {
  const length = text.length;
  const next = new Int32Array(length + 1);
  next[length] = length;
  const code = ch.charCodeAt(0);
  for (let index = length - 1; index >= 0; index -= 1) {
    next[index] = text.charCodeAt(index) === code ? index : next[index + 1];
  }
  return next;
}

function lineIndex(text: string): Int32Array {
  const lines = new Int32Array(text.length + 1);
  let line = 1;
  for (let index = 0; index < text.length; index += 1) {
    lines[index] = line;
    if (text.charCodeAt(index) === 10) line += 1;
  }
  lines[text.length] = line;
  return lines;
}

function matchCommand(text: string, at: number): string | null {
  for (const name of CITATION_COMMANDS) {
    if (text.startsWith(name, at)) return name;
  }
  return null;
}

function readBracedArgument(
  text: string,
  openAt: number,
  nextClose: Int32Array,
  nextOpen: Int32Array,
): { value: string; end: number } | null {
  const start = openAt + 1;
  const close = nextClose[start];
  if (close >= text.length) return null;
  const open = nextOpen[start];
  if (open < close) return null;
  return { value: text.slice(start, close), end: close };
}

interface Citation {
  key: string;
  path: string;
  line: number;
}

interface ScanResult {
  citations: Citation[];
  nocitedAll: boolean;
  bibNames: string[];
  includes: string[];
}

function scanTexFile(path: string, raw: string): ScanResult {
  const text = maskComments(raw);
  const nextClose = buildNext(text, '}');
  const nextOpen = buildNext(text, '{');
  const nextBracket = buildNext(text, ']');
  const lines = lineIndex(text);
  const citations: Citation[] = [];
  const bibNames: string[] = [];
  const includes: string[] = [];
  let nocitedAll = false;

  let index = 0;
  while (index < text.length) {
    const backslash = text.indexOf('\\', index);
    if (backslash < 0) break;
    const nameStart = backslash + 1;

    if (text.startsWith('input', nameStart) || text.startsWith('include', nameStart)) {
      const keyword = text.startsWith('input', nameStart) ? 'input' : 'include';
      const after = nameStart + keyword.length;
      if (text.charAt(after) === '{') {
        const braced = readBracedArgument(text, after, nextClose, nextOpen);
        if (braced !== null) {
          includes.push(braced.value);
          index = braced.end + 1;
          continue;
        }
      }
      index = after;
      continue;
    }

    if (text.startsWith('bibliography', nameStart) && text.charAt(nameStart + 12) === '{') {
      const braced = readBracedArgument(text, nameStart + 12, nextClose, nextOpen);
      if (braced !== null) {
        for (const name of braced.value.split(',')) {
          const trimmed = name.trim();
          if (trimmed !== '') bibNames.push(trimmed);
        }
        index = braced.end + 1;
        continue;
      }
      index = nameStart + 12;
      continue;
    }

    if (text.startsWith('addbibresource', nameStart) && text.charAt(nameStart + 14) === '{') {
      const braced = readBracedArgument(text, nameStart + 14, nextClose, nextOpen);
      if (braced !== null) {
        const trimmed = braced.value.trim();
        if (trimmed !== '') bibNames.push(trimmed);
        index = braced.end + 1;
        continue;
      }
      index = nameStart + 14;
      continue;
    }

    const command = matchCommand(text, nameStart);
    if (command === null) {
      index = nameStart;
      continue;
    }
    const resume = nameStart + command.length;
    let cursor = resume;
    if (text.charAt(cursor) === '*') cursor += 1;
    let brackets = 0;
    let broken = false;
    while (brackets < 2 && text.charAt(cursor) === '[') {
      const close = nextBracket[cursor + 1];
      if (close >= text.length) {
        broken = true;
        break;
      }
      cursor = close + 1;
      brackets += 1;
    }
    if (broken || text.charAt(cursor) !== '{') {
      index = resume;
      continue;
    }
    const braced = readBracedArgument(text, cursor, nextClose, nextOpen);
    if (braced === null) {
      index = resume;
      continue;
    }
    const line = lines[backslash];
    for (const rawKey of braced.value.split(',')) {
      const key = rawKey.trim();
      if (key === '') continue;
      if (key === '*' && command === 'nocite') {
        nocitedAll = true;
        continue;
      }
      citations.push({ key, path, line });
    }
    index = braced.end + 1;
  }

  return { citations, nocitedAll, bibNames, includes };
}

interface BibEntry {
  key: string;
  path: string;
  line: number;
}

const SKIPPED_BIB_TYPES = ['string', 'preamble', 'comment'];

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function scanBibFile(path: string, raw: string): BibEntry[] {
  const lines = lineIndex(raw);
  const entries: BibEntry[] = [];
  let index = 0;
  while (index < raw.length) {
    const at = raw.indexOf('@', index);
    if (at < 0) break;
    let cursor = at + 1;
    while (cursor < raw.length && isLetter(raw.charCodeAt(cursor))) cursor += 1;
    const type = raw.slice(at + 1, cursor).toLowerCase();
    const opener = raw.charAt(cursor);
    if (type === '' || (opener !== '{' && opener !== '(')) {
      index = at + 1;
      continue;
    }
    if (SKIPPED_BIB_TYPES.includes(type)) {
      index = cursor + 1;
      continue;
    }
    const closer = opener === '{' ? '}' : ')';
    const keyStart = cursor + 1;
    let keyEnd = raw.length;
    for (let probe = keyStart; probe < raw.length; probe += 1) {
      const ch = raw.charAt(probe);
      if (ch === ',' || ch === closer) {
        keyEnd = probe;
        break;
      }
    }
    const key = raw.slice(keyStart, keyEnd).trim();
    if (key !== '') entries.push({ key, path, line: lines[at] });
    index = keyEnd;
  }
  return entries;
}

function byPathThenLine(left: CitationWarning, right: CitationWarning): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return left.line - right.line;
}

/** The include-graph citation scan, computed from a project's text files. */
export function computeCitationLists(files: ReadonlyMap<string, string>): CitationLists {
  if (!files.has('main.tex')) return { undefined: [], unused: [], duplicate: [] };

  const scannedTex = new Set<string>();
  const queue = ['main.tex'];
  const citations: Citation[] = [];
  const bibTargets: string[] = [];
  let nocitedAll = false;

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (scannedTex.has(path)) continue;
    const content = files.get(path);
    if (content === undefined) continue;
    scannedTex.add(path);
    const result = scanTexFile(path, content);
    citations.push(...result.citations);
    if (result.nocitedAll) nocitedAll = true;
    for (const name of result.bibNames) {
      const resolved = resolveFromRoot(name);
      if (resolved !== null) bibTargets.push(withBibExtension(resolved));
    }
    for (const target of result.includes) {
      const resolved = resolveFromRoot(target);
      if (resolved === null) continue;
      const candidate = withTexExtension(resolved);
      if (!scannedTex.has(candidate) && files.has(candidate)) queue.push(candidate);
    }
  }

  const scannedBib = new Set<string>();
  const entries: BibEntry[] = [];
  for (const target of bibTargets) {
    if (scannedBib.has(target)) continue;
    const content = files.get(target);
    if (content === undefined) continue;
    scannedBib.add(target);
    entries.push(...scanBibFile(target, content));
  }

  entries.sort(byPathThenLine);

  const firstDefinition = new Map<string, BibEntry>();
  const duplicate: CitationWarning[] = [];
  for (const entry of entries) {
    if (firstDefinition.has(entry.key)) {
      duplicate.push({ key: entry.key, path: entry.path, line: entry.line });
    } else {
      firstDefinition.set(entry.key, entry);
    }
  }

  const sortedCitations = [...citations].sort(byPathThenLine);
  const firstCitation = new Map<string, Citation>();
  for (const citation of sortedCitations) {
    if (!firstCitation.has(citation.key)) firstCitation.set(citation.key, citation);
  }

  const undefinedKeys: CitationWarning[] = [];
  for (const [key, citation] of firstCitation) {
    if (!firstDefinition.has(key)) {
      undefinedKeys.push({ key, path: citation.path, line: citation.line });
    }
  }

  const unused: CitationWarning[] = [];
  if (!nocitedAll) {
    for (const [key, entry] of firstDefinition) {
      if (!firstCitation.has(key)) {
        unused.push({ key, path: entry.path, line: entry.line });
      }
    }
  }

  undefinedKeys.sort(byPathThenLine);
  unused.sort(byPathThenLine);
  duplicate.sort(byPathThenLine);
  return { undefined: undefinedKeys, unused, duplicate };
}
