// Note search ranking (BM25 with typo tolerance and recency), the snippet
// builder and the command score. The single home of all three.

export interface SearchBlock {
  plain: string;
  tokens: string[];
}

export interface SearchDoc {
  objectId: string;
  title: string;
  titleTokens: string[];
  blocks: SearchBlock[]; // own text blocks in position order
  updatedDate: string; // home-clock date
}

export interface Snippet {
  text: string;
  match: boolean;
}

export const SEARCH_CAP = 200;

/** NFKC normalise, lowercase, split into maximal runs of Unicode letters and digits. */
export function tokens(text: string): string[] {
  const norm = text.normalize("NFKC").toLowerCase();
  const out: string[] = [];
  const re = /[\p{L}\p{Nd}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) out.push(m[0]);
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

function wholeDaysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export interface RankedResult {
  object_id: string;
  title: string;
  score: number;
  snippet: Snippet[];
}

/** Rank documents against the query; the top 20, highest total first. */
export function rankSearch(q: string, docs: SearchDoc[], today: string): RankedResult[] {
  const queryTerms = [...new Set(tokens(q))];
  if (queryTerms.length === 0 || docs.length === 0) return [];
  const N = docs.length;
  const dlOf = docs.map((d) => d.titleTokens.length * 3 + d.blocks.reduce((s, b) => s + b.tokens.length, 0));
  const avgdl = dlOf.reduce((s, v) => s + v, 0) / N;

  // per term: list of {docIndex, tf}; tf counts title tokens three times
  const tfByTerm = new Map<string, Array<{ docIndex: number; tf: number }>>();
  for (let i = 0; i < N; i += 1) {
    const counts = new Map<string, number>();
    for (const b of docs[i].blocks) for (const t of b.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of docs[i].titleTokens) counts.set(t, (counts.get(t) ?? 0) + 3);
    for (const [t, tf] of counts) {
      const list = tfByTerm.get(t) ?? [];
      list.push({ docIndex: i, tf });
      tfByTerm.set(t, list);
    }
  }

  const termScore = new Map<string, Float64Array>(); // exact score per doc
  for (const [term, entries] of tfByTerm) {
    const n_t = entries.length;
    const idf = Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5));
    const scores = new Float64Array(N);
    for (const e of entries) {
      scores[e.docIndex] = idf * (e.tf * 2.2) / (e.tf + 1.2 * (1 - 0.75 + 0.75 * dlOf[e.docIndex] / avgdl));
    }
    termScore.set(term, scores);
  }

  const totals = new Float64Array(N);
  const matchCands: Array<Set<string>> = docs.map(() => new Set<string>());

  for (const term of queryTerms) {
    const exact = termScore.get(term) ?? new Float64Array(N);
    const typoTerms: Array<{ cand: string; scores: Float64Array }> = [];
    if (term.length >= 5) {
      for (const [cand, scores] of termScore) {
        if (Math.abs(cand.length - term.length) > 1) continue;
        if (levenshtein(cand, term) === 1) typoTerms.push({ cand, scores });
      }
    }
    for (let i = 0; i < N; i += 1) {
      let s = exact[i];
      let typoBest = 0;
      for (const t of typoTerms) {
        if (t.scores[i] > typoBest) {
          typoBest = t.scores[i];
          matchCands[i].add(t.cand);
        }
      }
      if (s > 0) matchCands[i].add(term);
      totals[i] += Math.max(s, 0.5 * typoBest);
    }
  }

  const results: Array<{ docIndex: number; total: number }> = [];
  for (let i = 0; i < N; i += 1) {
    if (totals[i] > 0) {
      const age = wholeDaysBetween(docs[i].updatedDate, today);
      results.push({ docIndex: i, total: totals[i] * (1 + 0.2 * Math.pow(2, -age / 14)) });
    }
  }
  results.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const at = docs[a.docIndex].title.toLowerCase();
    const bt = docs[b.docIndex].title.toLowerCase();
    if (at !== bt) return at < bt ? -1 : 1;
    return docs[a.docIndex].objectId < docs[b.docIndex].objectId ? -1 : 1;
  });

  return results.slice(0, 20).map((r) => ({
    object_id: docs[r.docIndex].objectId,
    title: docs[r.docIndex].title,
    score: Math.round(r.total * 10000) / 10000,
    snippet: makeSnippet(docs[r.docIndex], matchCands[r.docIndex]),
  }));
}

/** The snippet: from the title when a candidate term matches a title token,
 * otherwise from the first own text block with a match. */
function makeSnippet(doc: SearchDoc, cands: Set<string>): Snippet[] {
  const titleHit = doc.titleTokens.some((t) => cands.has(t));
  if (titleHit) return buildSnippet(doc.title, cands);
  for (const block of doc.blocks) {
    if (block.tokens.some((t) => cands.has(t))) return buildSnippet(block.plain, cands);
  }
  return [{ text: doc.title, match: false }];
}

/** Build the highlighted snippet: the whole text at 80 characters or fewer;
 * otherwise 80 characters starting 20 characters before the first matched
 * token, kept within the text. Matched segments are the matched tokens. */
function buildSnippet(text: string, cands: Set<string>): Snippet[] {
  const runs: Array<{ start: number; end: number; token: string }> = [];
  const re = /[\p{L}\p{Nd}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    runs.push({ start: m.index, end: m.index + m[0].length, token: tokens(m[0])[0] ?? "" });
  }
  const firstMatch = runs.find((r) => cands.has(r.token));
  let windowStart = 0;
  let windowEnd = text.length;
  if (text.length > 80 && firstMatch !== undefined) {
    windowStart = Math.max(0, Math.min(firstMatch.start - 20, text.length - 80));
    windowEnd = windowStart + 80;
  }
  const inRuns = runs.filter((r) => r.start >= windowStart && r.end <= windowEnd);
  const raw: Snippet[] = [];
  let pos = windowStart;
  for (const r of inRuns) {
    if (r.start > pos) raw.push({ text: text.slice(pos, r.start), match: false });
    raw.push({ text: text.slice(r.start, r.end), match: cands.has(r.token) });
    pos = r.end;
  }
  if (pos < windowEnd) raw.push({ text: text.slice(pos, windowEnd), match: false });
  // merge adjacent segments with the same flag
  const out: Snippet[] = [];
  for (const seg of raw) {
    const last = out[out.length - 1];
    if (last !== undefined && last.match === seg.match) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Command score for the palette.

/**
 * Fuzzy command score. Each query character, ignoring case and spaces, is
 * matched to the earliest unused command character after the previous match;
 * a command that cannot match every character is excluded. Returns null for
 * excluded commands.
 */
export function commandScore(command: string, query: string): number | null {
  const c = command.toLowerCase();
  const qChars = query.toLowerCase().split("").filter((ch) => ch !== " ");
  const used = new Set<number>();
  let prev = -1;
  let score = 0;
  for (const qc of qChars) {
    let found = -1;
    for (let j = prev + 1; j < c.length; j += 1) {
      if (c[j] === qc && !used.has(j)) {
        found = j;
        break;
      }
    }
    if (found === -1) return null;
    used.add(found);
    score += 1;
    if (found === 0 || c[found - 1] === " ") score += 2;
    if (prev !== -1 && found === prev + 1) score += 1;
    prev = found;
  }
  return score;
}
