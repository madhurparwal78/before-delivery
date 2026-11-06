// The note search ranking and the command score (Business rules: "Note search ranking").
import type { ThemeName } from './tokens.ts';
import { compareIds, compareText } from './query.ts';

/** Longest `q`, in characters after trimming, that block search and note search accept. */
export const SEARCH_CAP = 200;
const RESULT_LIMIT = 20;
const TITLE_WEIGHT = 3;
const K1 = 1.2;
const B = 0.75;
const TYPO_MIN_LENGTH = 5;
const TYPO_FACTOR = 0.5;
const RECENCY_BOOST = 0.2;
const RECENCY_HALF_LIFE_DAYS = 14;
const SNIPPET_LENGTH = 80;
const SNIPPET_LEAD = 20;
const DAY_MS = 86_400_000;

/** A token with its span in the source text, in code points. */
type SpannedToken = { term: string; start: number; end: number };

/**
 * Splits text into search tokens while remembering where each one sits in the source text.
 * Each source character is normalised (NFKC, lowercase) together with the combining marks
 * and conjoining jamo after it, so every normalised character maps back to one source span.
 */
function spannedTokens(text: string): SpannedToken[] {
  const tokens: SpannedToken[] = [];
  let term = '';
  let start = 0;
  let end = 0;
  let at = 0;
  for (const cluster of text.match(/[\s\S][\p{M}ᅠ-ᇿힰ-퟿]*/gu) ?? []) {
    const width = Array.from(cluster).length;
    for (const ch of cluster.normalize('NFKC').toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        if (term === '') start = at;
        term += ch;
        end = at + width;
      } else if (term !== '') {
        tokens.push({ term, start, end });
        term = '';
      }
    }
    at += width;
  }
  if (term !== '') tokens.push({ term, start, end });
  return tokens;
}

/** NFKC, lowercase, then maximal runs of Unicode letters and digits. */
export function searchTokens(text: string): string[] {
  return spannedTokens(text).map((t) => t.term);
}

export interface NoteDocument {
  objectId: string;
  title: string;
  typeName: string;
  /** Plain text of the object's own text blocks, in position order. */
  blockTexts: string[];
  /** The object's `updated_at` as a date on the home clock, YYYY-MM-DD. */
  updatedDate: string;
}

export type SnippetSegment = { text: string; match: boolean };

export interface NoteResult {
  object_id: string;
  title: string;
  type_name: string;
  score: number;
  snippet: SnippetSegment[];
}

/** Plain Levenshtein distance is exactly 1 (one insertion, deletion or substitution). */
function isOneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const x = Array.from(a);
  const y = Array.from(b);
  if (Math.abs(x.length - y.length) > 1 || a === b) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const skipLong = short.length < long.length ? 1 : 0;
  const skipShort = 1 - skipLong;
  for (let j = i; j + skipShort < short.length; j++) {
    if (short[j + skipShort] !== long[j + 1]) return false;
  }
  return true;
}

type IndexedDocument = {
  doc: NoteDocument;
  titleTokens: SpannedToken[];
  blockTokens: SpannedToken[][];
  tf: Map<string, number>;
  length: number;
};

function indexDocument(doc: NoteDocument): IndexedDocument {
  const titleTokens = spannedTokens(doc.title);
  const blockTokens = doc.blockTexts.map(spannedTokens);
  const tf = new Map<string, number>();
  for (const t of titleTokens) tf.set(t.term, (tf.get(t.term) ?? 0) + TITLE_WEIGHT);
  let bodyLength = 0;
  for (const tokens of blockTokens) {
    bodyLength += tokens.length;
    for (const t of tokens) tf.set(t.term, (tf.get(t.term) ?? 0) + 1);
  }
  return { doc, titleTokens, blockTokens, tf, length: bodyLength + TITLE_WEIGHT * titleTokens.length };
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
}

function snippetFor(text: string, tokens: SpannedToken[], isMatch: (term: string) => boolean): SnippetSegment[] {
  const chars = Array.from(text);
  const matched = tokens.filter((t) => isMatch(t.term));
  let from = 0;
  let to = chars.length;
  if (chars.length > SNIPPET_LENGTH) {
    from = Math.max(0, Math.min(matched[0].start - SNIPPET_LEAD, chars.length - SNIPPET_LENGTH));
    to = from + SNIPPET_LENGTH;
  }
  const segments: SnippetSegment[] = [];
  let at = from;
  for (const t of matched) {
    if (t.start < from || t.end > to) continue;
    if (t.start > at) segments.push({ text: chars.slice(at, t.start).join(''), match: false });
    segments.push({ text: chars.slice(t.start, t.end).join(''), match: true });
    at = t.end;
  }
  if (at < to) segments.push({ text: chars.slice(at, to).join(''), match: false });
  return segments;
}

/** Ranks every object for `q` and returns the top results with their snippets. */
export function rankNotes(q: string, docs: NoteDocument[], today: string): NoteResult[] {
  const terms = [...new Set(searchTokens(q))];
  if (terms.length === 0) return [];
  const indexed = docs.map(indexDocument);
  const avgdl = indexed.reduce((sum, d) => sum + d.length, 0) / Math.max(1, indexed.length);
  const documentFrequency = new Map<string, number>();
  for (const d of indexed) for (const term of d.tf.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const idf = (term: string): number => {
    const n = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (indexed.length - n + 0.5) / (n + 0.5));
  };
  // Index terms one edit away from each query term long enough for typo tolerance.
  const typoTerms = new Map<string, string[]>();
  for (const term of terms) {
    if (Array.from(term).length < TYPO_MIN_LENGTH) continue;
    typoTerms.set(term, [...documentFrequency.keys()].filter((indexTerm) => isOneEditApart(term, indexTerm)));
  }
  // Tokens that match a query term exactly or through typo tolerance.
  const matching = new Set([...terms, ...[...typoTerms.values()].flat()]);
  const isMatch = (token: string): boolean => matching.has(token);

  const scored: { total: number; result: NoteResult }[] = [];
  for (const d of indexed) {
    const termScore = (term: string): number => {
      const tf = d.tf.get(term) ?? 0;
      return tf === 0 ? 0 : (idf(term) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avgdl));
    };
    let sum = 0;
    for (const term of terms) {
      let best = 0;
      for (const near of typoTerms.get(term) ?? []) best = Math.max(best, termScore(near));
      sum += Math.max(termScore(term), TYPO_FACTOR * best);
    }
    const total = sum * (1 + RECENCY_BOOST * 2 ** (-daysBetween(d.doc.updatedDate, today) / RECENCY_HALF_LIFE_DAYS));
    if (total <= 0) continue;
    const titleMatches = d.titleTokens.some((t) => isMatch(t.term));
    const blockIndex = d.blockTokens.findIndex((tokens) => tokens.some((t) => isMatch(t.term)));
    const snippet = titleMatches
      ? snippetFor(d.doc.title, d.titleTokens, isMatch)
      : snippetFor(d.doc.blockTexts[blockIndex], d.blockTokens[blockIndex], isMatch);
    scored.push({
      total,
      result: {
        object_id: d.doc.objectId,
        title: d.doc.title,
        type_name: d.doc.typeName,
        score: Math.round(total * 10_000) / 10_000,
        snippet,
      },
    });
  }
  scored.sort(
    (a, b) =>
      b.total - a.total || compareText(a.result.title, b.result.title) || compareIds(a.result.object_id, b.result.object_id),
  );
  return scored.slice(0, RESULT_LIMIT).map((s) => s.result);
}


/** The palette's commands in list order; the theme command offers the other theme. */
export function paletteCommands(theme: ThemeName): string[] {
  return [
    'Go to Today',
    'Open graph',
    'Open timeline',
    'Open queries',
    'Open settings',
    theme === 'lamplight' ? 'Switch to Paper' : 'Switch to Lamplight',
    'New type',
  ];
}

/** Subsequence score of `query` against `command`, or null when some query character cannot match. */
export function commandScore(command: string, query: string): number | null {
  const commandChars = Array.from(command);
  const lowered = commandChars.map((c) => c.toLowerCase());
  let previous = -2;
  let from = 0;
  let score = 0;
  for (const ch of Array.from(query.toLowerCase())) {
    if (ch === ' ') continue;
    const i = lowered.indexOf(ch, from);
    if (i < 0) return null;
    score += 1 + (i === 0 || commandChars[i - 1] === ' ' ? 2 : 0) + (i === previous + 1 ? 1 : 0);
    previous = i;
    from = i + 1;
  }
  return score;
}

/** Commands that match `query`, by score highest first, then list order. */
export function rankCommands(commands: string[], query: string): string[] {
  return commands
    .map((command, index) => ({ command, index, score: commandScore(command, query) }))
    .filter((c): c is { command: string; index: number; score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((c) => c.command);
}
