/** The single home of the note search ranking and the command score. */

export const SEARCH_TEXT_MAX_CHARS = 200;

export function searchTokens(text: string): string[] {
  const normalised = text.normalize('NFKC').toLowerCase();
  return normalised.match(/[\p{L}\p{N}]+/gu) ?? [];
}

export type SearchDocument = {
  objectId: string;
  title: string;
  typeName: string;
  blockTexts: string[];
  updatedDate: string;
};

export type SearchResult = {
  object_id: string;
  title: string;
  type_name: string;
  score: number;
  snippet: { text: string; match: boolean }[];
};

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const TYPO_MIN_TERM_LENGTH = 5;
const TYPO_FACTOR = 0.5;
const RECENCY_WEIGHT = 0.2;
const RECENCY_HALF_LIFE_DAYS = 14;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  let previous = new Array<number>(n + 1);
  let current = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) previous[j] = j;
  for (let i = 1; i <= m; i += 1) {
    current[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[n];
}

function wholeDaysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

type Prepared = {
  document: SearchDocument;
  titleTokens: string[];
  bodyTokens: string[];
  counts: Map<string, { body: number; title: number }>;
  dl: number;
};

export function rankNotes(query: string, documents: SearchDocument[], today: string): SearchResult[] {
  const terms = Array.from(new Set(searchTokens(query)));
  if (terms.length === 0) return [];
  const prepared: Prepared[] = documents.map((document) => {
    const titleTokens = searchTokens(document.title);
    const bodyTokens = document.blockTexts.flatMap((text) => searchTokens(text));
    const counts = new Map<string, { body: number; title: number }>();
    for (const token of bodyTokens) {
      const entry = counts.get(token) ?? { body: 0, title: 0 };
      entry.body += 1;
      counts.set(token, entry);
    }
    for (const token of titleTokens) {
      const entry = counts.get(token) ?? { body: 0, title: 0 };
      entry.title += 1;
      counts.set(token, entry);
    }
    return {
      document,
      titleTokens,
      bodyTokens,
      counts,
      dl: bodyTokens.length + TITLE_WEIGHT * titleTokens.length,
    };
  });
  const total = prepared.length;
  const avgdl = total === 0 ? 0 : prepared.reduce((sum, item) => sum + item.dl, 0) / total;
  const documentFrequency = new Map<string, number>();
  for (const item of prepared) {
    for (const token of item.counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const idfOf = (term: string): number => {
    const nt = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (total - nt + 0.5) / (nt + 0.5));
  };
  const termScore = (item: Prepared, term: string): number => {
    const counts = item.counts.get(term);
    if (counts === undefined) return 0;
    const tf = counts.body + TITLE_WEIGHT * counts.title;
    if (tf === 0) return 0;
    const norm = avgdl === 0 ? 1 : 1 - B + B * (item.dl / avgdl);
    return idfOf(term) * ((tf * (K1 + 1)) / (tf + K1 * norm));
  };

  const results: { result: SearchResult; total: number }[] = [];
  for (const item of prepared) {
    let sum = 0;
    const matchedTokens = new Set<string>();
    for (const term of terms) {
      const exact = termScore(item, term);
      let best = exact;
      let bestToken = exact > 0 ? term : null;
      if (term.length >= TYPO_MIN_TERM_LENGTH) {
        let bestNear = 0;
        let nearToken: string | null = null;
        for (const indexTerm of item.counts.keys()) {
          if (indexTerm === term) continue;
          if (levenshtein(term, indexTerm) !== 1) continue;
          const score = termScore(item, indexTerm);
          if (score > bestNear) {
            bestNear = score;
            nearToken = indexTerm;
          }
        }
        if (TYPO_FACTOR * bestNear > best) {
          best = TYPO_FACTOR * bestNear;
          bestToken = nearToken;
        } else if (nearToken !== null && bestNear > 0) {
          matchedTokens.add(nearToken);
        }
      }
      if (best > 0) sum += best;
      if (bestToken !== null && best > 0) matchedTokens.add(bestToken);
    }
    if (sum <= 0) continue;
    const age = wholeDaysBetween(item.document.updatedDate, today);
    const totalScore = sum * (1 + RECENCY_WEIGHT * Math.pow(2, -age / RECENCY_HALF_LIFE_DAYS));
    results.push({
      total: totalScore,
      result: {
        object_id: item.document.objectId,
        title: item.document.title,
        type_name: item.document.typeName,
        score: Math.round(totalScore * 10_000) / 10_000,
        snippet: snippetFor(item, matchedTokens),
      },
    });
  }
  results.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    const titleCompare = a.result.title.toLowerCase().localeCompare(b.result.title.toLowerCase());
    if (titleCompare !== 0) return titleCompare;
    return a.result.object_id < b.result.object_id ? -1 : a.result.object_id > b.result.object_id ? 1 : 0;
  });
  return results.slice(0, 20).map((entry) => entry.result);
}

export const SNIPPET_LENGTH = 80;
const SNIPPET_LEAD = 20;

function snippetFor(item: Prepared, matchedTokens: Set<string>): { text: string; match: boolean }[] {
  const titleHit = item.titleTokens.some((token) => matchedTokens.has(token));
  let source = item.document.title;
  if (!titleHit) {
    const hit = item.document.blockTexts.find((text) =>
      searchTokens(text).some((token) => matchedTokens.has(token)),
    );
    source = hit ?? item.document.title;
  }
  return buildSnippet(source, matchedTokens);
}

export function buildSnippet(source: string, matchedTokens: Set<string>): { text: string; match: boolean }[] {
  const spans: { start: number; end: number; token: string }[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length, token: match[0].normalize('NFKC').toLowerCase() });
  }
  const first = spans.find((span) => matchedTokens.has(span.token));
  let text = source;
  let offset = 0;
  if (source.length > SNIPPET_LENGTH) {
    const anchor = first === undefined ? 0 : first.start;
    let start = Math.max(0, anchor - SNIPPET_LEAD);
    if (start + SNIPPET_LENGTH > source.length) start = Math.max(0, source.length - SNIPPET_LENGTH);
    text = source.slice(start, start + SNIPPET_LENGTH);
    offset = start;
  }
  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (!matchedTokens.has(span.token)) continue;
    const start = span.start - offset;
    const end = span.end - offset;
    if (start < 0 || end > text.length) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.filter((segment) => segment.text.length > 0);
}

/* ------------------------------------------------------------- commands */

export const COMMAND_LIST = [
  'Go to Today',
  'Open graph',
  'Open timeline',
  'Open queries',
  'Open settings',
  'Switch to Lamplight',
  'New type',
] as const;

export function commandList(theme: 'paper' | 'lamplight'): string[] {
  return COMMAND_LIST.map((command) =>
    command === 'Switch to Lamplight' && theme === 'lamplight' ? 'Switch to Paper' : command,
  );
}

export function commandScore(command: string, query: string): number | null {
  const needles = Array.from(query.toLowerCase().replace(/\s+/g, ''));
  if (needles.length === 0) return 0;
  const haystack = command.toLowerCase();
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) return null;
    score += 1;
    if (index === 0 || haystack.charAt(index - 1) === ' ') score += 2;
    if (index === previousIndex + 1) score += 1;
    previousIndex = index;
    cursor = index + 1;
  }
  return score;
}

export function rankCommands(commands: string[], query: string): string[] {
  const scored = commands.map((command, index) => ({ command, index, score: commandScore(command, query) }));
  return scored
    .filter((entry): entry is { command: string; index: number; score: number } => entry.score !== null)
    .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.command);
}

/** Block search and the query language's text conditions: a literal, case-insensitive test. */
export function literalMatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}
