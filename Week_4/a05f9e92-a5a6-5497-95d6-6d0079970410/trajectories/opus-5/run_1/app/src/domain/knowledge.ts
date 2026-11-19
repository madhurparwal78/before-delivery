/**
 * Knowledge search and suggestions: one tokeniser and one ranking formula for
 * both surfaces.
 */

export type ArticleState = 'draft' | 'in_review' | 'published' | 'retired';

export interface Article {
  readonly number: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly keywords: readonly string[];
  readonly state: ArticleState;
  readonly validUntil: string | null;
  readonly helpfulYes: number;
  readonly helpfulNo: number;
  readonly audienceRoles: readonly string[];
  readonly audienceDepartments: readonly string[];
  readonly publishedAt: number | null;
}

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'not',
  'from',
  'this',
  'that',
  'are',
  'was',
  'has',
  'have',
  'you',
  'your',
  'can',
  'cannot',
]);

/** Lowercase runs of letters and digits, at least 3 characters, less stop words. */
export function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const run of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (run.length >= 3 && !stopWords.has(run)) out.push(run);
  }
  return out;
}

export function distinctTokens(text: string): string[] {
  return [...new Set(tokensOf(text))];
}

export interface Scored {
  readonly article: Article;
  readonly score: number;
}

/** score = 5 x T + 2 x K + B + min(max(yes - no, 0), 5) */
export function scoreArticle(article: Article, queryTokens: readonly string[]): number | null {
  const titleTokens = new Set(tokensOf(article.title));
  const keywordTokens = new Set(article.keywords.flatMap((k) => tokensOf(k)));
  const bodyTokens = new Set(tokensOf(article.body));
  let t = 0;
  let k = 0;
  let b = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) t += 1;
    if (keywordTokens.has(token)) k += 1;
    if (bodyTokens.has(token)) b += 1;
  }
  if (t + k + b < 1) return null;
  const helpful = Math.min(Math.max(article.helpfulYes - article.helpfulNo, 0), 5);
  return 5 * t + 2 * k + b + helpful;
}

/** Ranked by score descending, then publish time descending, then number ascending. */
export function rankArticles(articles: readonly Article[], query: string): Scored[] {
  const tokens = distinctTokens(query);
  if (tokens.length === 0) return [];
  const scored: Scored[] = [];
  for (const article of articles) {
    const score = scoreArticle(article, tokens);
    if (score !== null) scored.push({ article, score });
  }
  return scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const at = a.article.publishedAt ?? 0;
    const bt = b.article.publishedAt ?? 0;
    if (at !== bt) return bt - at;
    return a.article.number < b.article.number ? -1 : 1;
  });
}

/** Audience includes everyone when both lists are empty. */
export function inAudience(
  article: Article,
  roles: readonly string[],
  department: string | null,
): boolean {
  if (article.audienceRoles.length === 0 && article.audienceDepartments.length === 0) return true;
  if (article.audienceRoles.some((role) => roles.includes(role))) return true;
  return department !== null && article.audienceDepartments.includes(department);
}

/** Expired when valid_until is before today's local date in the business zone. */
export function isExpired(article: Article, today: string): boolean {
  return article.validUntil !== null && article.validUntil < today;
}

export const articleTransitions: Readonly<Record<ArticleState, readonly ArticleState[]>> = {
  draft: ['in_review'],
  in_review: ['published'],
  published: ['retired'],
  retired: [],
};
