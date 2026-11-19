import type { Tx } from "./db.js";
import { nextSequence, pad } from "./db.js";
import { settings } from "./config.js";
import { now } from "./clock.js";
import type { Env } from "./env.js";
import { fail, notFound, validation } from "./errors.js";
import { localDateKey } from "../shared/tz.js";

interface Audience {
  roles: string[];
  departments: string[];
}

const ARTICLE_STATES: ReadonlyArray<ArticleRow["state"]> = ["draft", "in_review", "published", "retired"];

interface ArticleRow {
  number: string;
  version: number;
  title: string;
  body: string;
  keywords: string[];
  state: "draft" | "in_review" | "published" | "retired";
  valid_until: string | null;
  audience: Audience;
  author: string;
  published_at: string | null;
}

interface ArticleSummary {
  number: string;
  title: string;
  score: number;
  valid_until: string | null;
}

const STOP = new Set(["the", "and", "for", "with", "not", "from", "this", "that", "are", "was", "has", "have", "you", "your", "can", "cannot"]);

function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOP.has(t)));
}

function rowOf(r: Record<string, unknown>): ArticleRow {
  return {
    number: r.number as string,
    version: r.version as number,
    title: r.title as string,
    body: r.body as string,
    keywords: r.keywords as string[],
    state: r.state as ArticleRow["state"],
    valid_until: (r.valid_until as string | null) ?? null,
    audience: r.audience as Audience,
    author: r.author as string,
    published_at: (r.published_at as string | null) ?? null,
  };
}

function inAudience(env: Env, audience: Audience): boolean {
  if (audience.roles.length === 0 && audience.departments.length === 0) return true;
  return audience.roles.some((r) => env.user.roles.includes(r as never)) || audience.departments.includes(env.user.department);
}

async function votesFor(tx: Tx, number: string, version: number): Promise<{ yes: number; no: number }> {
  const rows = await tx.query("SELECT helpful, count(*)::int AS n FROM article_votes WHERE number = $1 AND version = $2 GROUP BY helpful", [number, version]);
  const stored = (await tx.query("SELECT helpful_yes, helpful_no FROM articles WHERE number = $1 AND version = $2", [number, version]))[0];
  const count = (flag: boolean): number => (rows.find((r) => r.helpful === flag)?.n as number | undefined) ?? 0;
  return { yes: Number(stored?.helpful_yes ?? 0) + count(true), no: Number(stored?.helpful_no ?? 0) + count(false) };
}

/** Published, in-audience, unexpired articles ranked by the published formula. */
export async function rank(env: Env, text: string, limit?: number): Promise<ArticleSummary[]> {
  const query = tokens(text);
  const today = localDateKey(now(), settings.BUSINESS_TIME_ZONE);
  const rows = (await env.tx.query("SELECT * FROM articles WHERE state = 'published'")).map(rowOf);
  const scored: Array<ArticleSummary & { at: string }> = [];
  for (const article of rows) {
    if (!inAudience(env, article.audience) || (article.valid_until !== null && article.valid_until < today)) continue;
    const titleTokens = tokens(article.title);
    const keywordTokens = tokens(article.keywords.join(" "));
    const bodyTokens = tokens(article.body);
    let T = 0;
    let K = 0;
    let B = 0;
    for (const t of query) {
      if (titleTokens.has(t)) T++;
      if (keywordTokens.has(t)) K++;
      if (bodyTokens.has(t)) B++;
    }
    if (T + K + B < 1) continue;
    const votes = await votesFor(env.tx, article.number, article.version);
    scored.push({ number: article.number, title: article.title, score: 5 * T + 2 * K + B + Math.min(Math.max(votes.yes - votes.no, 0), 5), valid_until: article.valid_until, at: article.published_at ?? "" });
  }
  scored.sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.number < b.number ? -1 : 1));
  return scored.slice(0, limit ?? scored.length).map(({ at, ...rest }) => (void at, rest));
}

async function latest(tx: Tx, number: string): Promise<ArticleRow | null> {
  const rows = await tx.query("SELECT * FROM articles WHERE number = $1 ORDER BY version DESC", [number]);
  const published = rows.map(rowOf).find((r) => r.state === "published");
  return published ?? (rows[0] ? rowOf(rows[0]) : null);
}

export async function articleJson(env: Env, number: string): Promise<Record<string, unknown>> {
  const article = await latest(env.tx, number);
  const privileged = env.user.roles.includes("operator") || env.user.roles.includes("technician");
  if (!article || (!privileged && (article.state !== "published" || !inAudience(env, article.audience)))) return notFound();
  const votes = await votesFor(env.tx, number, article.version);
  return {
    number: article.number,
    version: article.version,
    title: article.title,
    body: article.body,
    keywords: article.keywords,
    state: article.state,
    valid_until: article.valid_until,
    helpful_yes: votes.yes,
    helpful_no: votes.no,
    audience: article.audience,
  };
}

interface ArticleInput {
  title?: string;
  body?: string;
  keywords?: string[];
  valid_until?: string | null;
  audience?: Audience;
}

function checked(input: ArticleInput): Required<ArticleInput> {
  const errors: Record<string, string> = {};
  if (typeof input.title !== "string" || input.title.trim() === "") errors.title = "Title is required.";
  if (typeof input.body !== "string" || input.body.trim() === "") errors.body = "Body is required.";
  if (Object.keys(errors).length > 0) fail(422, "validation", `${Object.keys(errors).length} problems to fix before saving.`, errors);
  return {
    title: input.title!,
    body: input.body!,
    keywords: input.keywords ?? [],
    valid_until: input.valid_until ?? null,
    audience: input.audience ?? { roles: [], departments: [] },
  };
}

export async function createArticle(env: Env, input: ArticleInput): Promise<Record<string, unknown>> {
  const a = checked(input);
  const number = `ART-${pad(await nextSequence(env.tx, "article"))}`;
  await env.tx.query("INSERT INTO articles (number, version, title, body, keywords, state, valid_until, audience, author) VALUES ($1, 1, $2, $3, $4, 'draft', $5, $6, $7)", [number, a.title, a.body, a.keywords, a.valid_until, JSON.stringify(a.audience), env.user.username]);
  return articleJson(env, number);
}

export async function updateArticle(env: Env, number: string, input: ArticleInput): Promise<Record<string, unknown>> {
  const current = await latest(env.tx, number);
  if (!current) return notFound();
  const a = checked(input);
  if (current.state === "draft") {
    await env.tx.query("UPDATE articles SET title = $3, body = $4, keywords = $5, valid_until = $6, audience = $7 WHERE number = $1 AND version = $2", [number, current.version, a.title, a.body, a.keywords, a.valid_until, JSON.stringify(a.audience)]);
  } else {
    await env.tx.query("INSERT INTO articles (number, version, title, body, keywords, state, valid_until, audience, author) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)", [number, current.version + 1, a.title, a.body, a.keywords, a.valid_until, JSON.stringify(a.audience), env.user.username]);
  }
  return articleJson(env, number);
}

const STEP: Record<"submit" | "approve" | "retire", { from: ArticleRow["state"]; to: ArticleRow["state"] }> = {
  submit: { from: "draft", to: "in_review" },
  approve: { from: "in_review", to: "published" },
  retire: { from: "published", to: "retired" },
};

export async function moveArticle(env: Env, number: string, action: "submit" | "approve" | "retire"): Promise<Record<string, unknown>> {
  const rows = (await env.tx.query("SELECT * FROM articles WHERE number = $1 ORDER BY version DESC", [number])).map(rowOf);
  const step = STEP[action];
  const target = rows.find((r) => r.state === step.from);
  if (rows.length === 0) return notFound();
  if (!target) fail(422, "illegal_transition", `Cannot ${action} an article that is not ${step.from.replace("_", " ")}.`);
  if (action === "submit" && target.author !== env.user.username && !env.user.roles.includes("operator")) fail(403, "forbidden", "Your role cannot do this.");
  if (action === "approve") await env.tx.query("UPDATE articles SET state = 'retired' WHERE number = $1 AND state = 'published'", [number]);
  await env.tx.query("UPDATE articles SET state = $3, published_at = CASE WHEN $3 = 'published' THEN $4::timestamptz ELSE published_at END WHERE number = $1 AND version = $2", [number, target.version, step.to, new Date(now()).toISOString()]);
  return articleJson(env, number);
}

export async function voteArticle(env: Env, number: string, helpful: unknown): Promise<{ helpful_yes: number; helpful_no: number }> {
  if (typeof helpful !== "boolean") return validation("Say whether the article was helpful.", { helpful: "Send true or false." });
  const article = await latest(env.tx, number);
  if (!article || article.state !== "published" || !inAudience(env, article.audience)) return notFound();
  await env.tx.query("INSERT INTO article_votes (number, version, username, helpful) VALUES ($1, $2, $3, $4) ON CONFLICT (number, version, username) DO UPDATE SET helpful = EXCLUDED.helpful", [number, article.version, env.user.username, helpful]);
  const votes = await votesFor(env.tx, number, article.version);
  return { helpful_yes: votes.yes, helpful_no: votes.no };
}

/** An article created directly by the grading fixtures, in any state, with stored helpful totals. */
export async function createArticleFixture(env: Env, input: ArticleInput & { state?: ArticleRow["state"]; helpful_yes?: number; helpful_no?: number; author?: string | null; published_at?: string | null }): Promise<{ id: string; number: string }> {
  const a = checked(input);
  const number = `ART-${pad(await nextSequence(env.tx, "article"))}`;
  const state = input.state ?? "published";
  if (!ARTICLE_STATES.includes(state)) validation(`state must be one of ${ARTICLE_STATES.join(", ")}.`, { state: `Use ${ARTICLE_STATES.join(", ")}.` });
  const publishedAt = input.published_at ? new Date(input.published_at).toISOString() : state === "published" ? new Date(now()).toISOString() : null;
  await env.tx.query("INSERT INTO articles (number, version, title, body, keywords, state, valid_until, audience, author, published_at, helpful_yes, helpful_no) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
    number, a.title, a.body, a.keywords, state, a.valid_until, JSON.stringify(a.audience), input.author ?? "oona", publishedAt, input.helpful_yes ?? 0, input.helpful_no ?? 0,
  ]);
  return { id: number, number };
}
