import type { Author, RecipeSummary, Version, VersionHeader } from "../shared/api";
import type { Step } from "../shared/operations/types";
import { asRecord } from "../shared/records";
import { parseSteps } from "../shared/operations/validate";
import { compareVersions } from "./compare";
import { limits } from "./config";
import { pool, query, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, notFound, searchUnavailable, validationFailed } from "./errors";
import { Context, defineRoute, reply } from "./http";
import type { Route } from "./http";
import { announceVersionSaved } from "./live";
import { indexSoon, searchRecipeIds, SearchUnavailable } from "./search";
import { newId } from "./session";

export interface RecipeContent {
  name: string;
  note: string;
  tags: string[];
  steps: Step[];
}

const TAG_PATTERN = /^[a-z0-9-]{1,30}$/;

interface SummaryRow {
  id: string;
  owner_user_id: string | null;
  team_id: string | null;
  latest_version: number;
  last_used_at: Date;
  name: string;
  tags: string[];
  updated_at: Date;
  team_name: string | null;
  owner_name: string | null;
}

const SUMMARY_SELECT = `
  SELECT r.id, r.owner_user_id, r.team_id, r.latest_version, r.last_used_at, v.name, v.tags,
         v.created_at AS updated_at, t.name AS team_name, u.display_name AS owner_name
  FROM recipes r
  JOIN recipe_versions v ON v.recipe_id = r.id AND v.n = r.latest_version
  LEFT JOIN teams t ON t.id = r.team_id
  LEFT JOIN users u ON u.id = r.owner_user_id`;

/** The recipes a person can see: their own and those of every team they belong to. */
const VISIBLE_TO_FIRST = "(r.owner_user_id = $1 OR r.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))";

function toSummary(row: SummaryRow): RecipeSummary {
  return {
    id: row.id,
    name: row.name,
    owner: row.team_id
      ? { type: "team", id: row.team_id, name: row.team_name as string }
      : { type: "user", id: row.owner_user_id as string, name: row.owner_name as string },
    latestVersion: row.latest_version,
    tags: row.tags,
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
  };
}

export async function visibleRecipe(db: Db, userId: string, recipeId: string): Promise<RecipeSummary | null> {
  const row = await queryOne<SummaryRow>(db, `${SUMMARY_SELECT} WHERE ${VISIBLE_TO_FIRST} AND r.id = $2`, [userId, recipeId]);
  return row ? toSummary(row) : null;
}

async function visibleRecipes(db: Db, userId: string, ids?: string[]): Promise<RecipeSummary[]> {
  const rows = await query<SummaryRow>(
    db,
    `${SUMMARY_SELECT} WHERE ${VISIBLE_TO_FIRST} ${ids ? "AND r.id = ANY($2)" : ""} ORDER BY r.last_used_at DESC, r.id`,
    ids ? [userId, ids] : [userId],
  );
  return rows.map(toSummary);
}

interface VersionRow {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: Step[];
  created_at: Date;
  author_id: string;
  author_name: string;
}

const VERSION_SELECT = `
  SELECT v.n, v.name, v.note, v.tags, v.steps, v.created_at, v.author_id, a.display_name AS author_name
  FROM recipe_versions v JOIN users a ON a.id = v.author_id`;

function toHeader(row: VersionRow): VersionHeader {
  const author: Author = { id: row.author_id, displayName: row.author_name };
  return { n: row.n, name: row.name, note: row.note, tags: row.tags, author, createdAt: row.created_at.toISOString() };
}

function toVersion(row: VersionRow): Version {
  return { ...toHeader(row), steps: row.steps };
}

export async function versionOf(db: Db, recipeId: string, n: number): Promise<Version | null> {
  if (!Number.isInteger(n)) return null;
  const row = await queryOne<VersionRow>(db, `${VERSION_SELECT} WHERE v.recipe_id = $1 AND v.n = $2`, [recipeId, n]);
  return row ? toVersion(row) : null;
}

/**
 * The version conflict check. A save names the version it started from; only one save from each base can claim
 * the next number, and every other one is told who saved it first.
 */
async function claimNextVersion(db: Db, recipeId: string, baseVersion: number): Promise<number> {
  const claimed = await queryOne<{ latest_version: number }>(
    db,
    "UPDATE recipes SET latest_version = latest_version + 1, last_used_at = now() WHERE id = $1 AND latest_version = $2 RETURNING latest_version",
    [recipeId, baseVersion],
  );
  if (claimed) return claimed.latest_version;
  const newest = await queryOne<{ n: number; author_name: string }>(
    db,
    `SELECT v.n, a.display_name AS author_name FROM recipes r
     JOIN recipe_versions v ON v.recipe_id = r.id AND v.n = r.latest_version JOIN users a ON a.id = v.author_id
     WHERE r.id = $1`,
    [recipeId],
  );
  const winner = newest as { n: number; author_name: string };
  throw new ApiError(409, "version_conflict", `Version ${winner.n} was saved by ${winner.author_name} while you were editing.`, {
    latestVersion: winner.n,
    authorName: winner.author_name,
  });
}

/** Writes version `n` and drops the versions beyond the newest `versionsKept`. */
async function insertVersion(db: Db, recipeId: string, n: number, content: RecipeContent, authorId: string): Promise<void> {
  await db.query(
    "INSERT INTO recipe_versions (recipe_id, n, name, note, tags, steps, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [recipeId, n, content.name, content.note, JSON.stringify(content.tags), JSON.stringify(content.steps), authorId],
  );
  await db.query("DELETE FROM recipe_versions WHERE recipe_id = $1 AND n <= $2", [recipeId, n - limits.versionsKept]);
}

export type RecipeOwner = { type: "user" | "team"; id: string };

/** Creates a recipe at version 1. */
export async function createRecipe(db: Db, owner: RecipeOwner, content: RecipeContent, authorId: string): Promise<string> {
  const id = newId("r");
  await db.query(
    "INSERT INTO recipes (id, owner_user_id, team_id, latest_version) VALUES ($1, $2, $3, 1)",
    [id, owner.type === "user" ? owner.id : null, owner.type === "team" ? owner.id : null],
  );
  await insertVersion(db, id, 1, content, authorId);
  return id;
}

/** Saves the next version after `baseVersion`. */
export async function saveNextVersion(db: Db, recipeId: string, baseVersion: number, content: RecipeContent, authorId: string): Promise<number> {
  const n = await claimNextVersion(db, recipeId, baseVersion);
  await insertVersion(db, recipeId, n, content, authorId);
  return n;
}

async function isTeamMember(db: Db, teamId: string, userId: string): Promise<boolean> {
  return (await queryOne(db, "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, userId])) !== null;
}

/** The owner a person names for a new recipe: themselves, or a team they belong to; anything else does not exist for them. */
export async function resolveOwner(db: Db, userId: string, raw: unknown): Promise<RecipeOwner> {
  const owner = asRecord(raw);
  if (owner.type === "user" && owner.id === userId) return { type: "user", id: userId };
  if (owner.type === "team" && typeof owner.id === "string" && (await isTeamMember(db, owner.id, userId))) {
    return { type: "team", id: owner.id };
  }
  throw notFound();
}

/** Validates a recipe's name, note, tags and steps; every problem is reported under its field. */
function parseContent(raw: Record<string, unknown>): { content: RecipeContent; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 80) fields.name = "Name needs 1 to 80 characters.";
  const note = raw.note === undefined ? "" : raw.note;
  if (typeof note !== "string" || note.length > 200) fields.note = "Note needs at most 200 characters.";
  const tags = raw.tags === undefined ? [] : raw.tags;
  if (!Array.isArray(tags) || tags.length > 10 || !tags.every((tag) => typeof tag === "string" && TAG_PATTERN.test(tag))) {
    fields.tags = "Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most.";
  }
  const parsed = parseSteps(raw.steps);
  if ("problems" in parsed) for (const problem of parsed.problems) fields[problem.path] = problem.message;
  return {
    content: {
      name,
      note: typeof note === "string" ? note : "",
      tags: Array.isArray(tags) ? (tags as string[]) : [],
      steps: "steps" in parsed ? parsed.steps : [],
    },
    fields,
  };
}

export function contentOf(raw: unknown): RecipeContent {
  const { content, fields } = parseContent(asRecord(raw));
  if (Object.keys(fields).length) throw validationFailed(fields);
  return content;
}

function wholeNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

/** After a commit: tell every workbench that can see the recipe, and update the search index. */
export function publish(ctx: Context, recipeId: string, n: number, content: RecipeContent, teamId: string | null): void {
  const author = ctx.me();
  ctx.afterCommit(() => {
    indexSoon(recipeId);
    announceVersionSaved({
      type: "version_saved", recipeId, version: n, name: content.name, authorId: author.id, authorName: author.displayName, teamId,
    });
  });
}

async function recipeOfPath(ctx: Context): Promise<RecipeSummary> {
  const recipe = await visibleRecipe(pool, ctx.me().id, ctx.params.id as string);
  if (!recipe) throw notFound();
  return recipe;
}

/** A recipe a save is aimed at, with the version number the save has claimed. */
interface SaveTarget {
  recipe: RecipeSummary;
  next: number;
}

/** Claims the next version number for a save inside the request's transaction; a base that is not a number claims nothing. */
async function claim(ctx: Context, recipe: RecipeSummary, baseVersion: number | null): Promise<SaveTarget> {
  return { recipe, next: baseVersion === null ? 0 : await claimNextVersion(await ctx.transaction(), recipe.id, baseVersion) };
}

const teamOf = (recipe: RecipeSummary): string | null => (recipe.owner.type === "team" ? recipe.owner.id : null);

interface SavedBody {
  baseVersion: number;
  content: RecipeContent;
}

const createRoute = defineRoute<undefined, RecipeContent, RecipeOwner>({
  method: "POST", path: "/api/recipes", access: "session", body: "json",
  check: (ctx, _, body) => resolveOwner(pool, ctx.me().id, asRecord(body).owner),
  validate: (body) => contentOf(body),
  run: async (ctx, owner, content) => {
    const db = await ctx.transaction();
    const id = await createRecipe(db, owner, content, ctx.me().id);
    publish(ctx, id, 1, content, owner.type === "team" ? owner.id : null);
    return reply(201, await recipeAndVersion(db, ctx.me().id, id, 1));
  },
});

async function recipeAndVersion(db: Db, userId: string, recipeId: string, n: number): Promise<{ recipe: RecipeSummary; version: Version }> {
  return { recipe: (await visibleRecipe(db, userId, recipeId)) as RecipeSummary, version: (await versionOf(db, recipeId, n)) as Version };
}

/** The recipes a search finds, in the order Meilisearch ranks them, among those the person can see. */
async function searchVisible(userId: string, q: string): Promise<RecipeSummary[]> {
  if (q.trim() === "") return visibleRecipes(pool, userId);
  const teams = await query<{ team_id: string }>(pool, "SELECT team_id FROM team_members WHERE user_id = $1", [userId]);
  try {
    const ids = await searchRecipeIds(userId, teams.map((team) => team.team_id), q);
    const found = new Map((await visibleRecipes(pool, userId, ids)).map((recipe) => [recipe.id, recipe]));
    return ids.flatMap((id) => found.get(id) ?? []);
  } catch (error) {
    throw error instanceof SearchUnavailable ? searchUnavailable() : error;
  }
}

export const recipeRoutes: Route[] = [
  defineRoute({
    method: "GET", path: "/api/recipes", access: "session",
    run: async (ctx) => reply(200, { recipes: await visibleRecipes(pool, ctx.me().id) }),
  }),
  createRoute,
  defineRoute({
    method: "GET", path: "/api/search", access: "session",
    run: async (ctx) => {
      const results = await searchVisible(ctx.me().id, ctx.url.searchParams.get("q") ?? "");
      return reply(200, { results, total: results.length });
    },
  }),
  defineRoute<RecipeSummary>({
    method: "GET", path: "/api/recipes/:id", access: "session", resolve: recipeOfPath,
    run: async (_, recipe) => {
      const rows = await query<VersionRow>(pool, `${VERSION_SELECT} WHERE v.recipe_id = $1 ORDER BY v.n DESC`, [recipe.id]);
      return reply(200, { recipe, versions: rows.map(toHeader) });
    },
  }),
  defineRoute<RecipeSummary>({
    method: "GET", path: "/api/recipes/:id/versions/:n", access: "session", resolve: recipeOfPath,
    run: async (ctx, recipe) => {
      const version = await versionOf(pool, recipe.id, Number(ctx.params.n));
      if (!version) throw notFound();
      return reply(200, { version });
    },
  }),
  defineRoute<RecipeSummary, SavedBody, SaveTarget>({
    method: "POST", path: "/api/recipes/:id/versions", access: "session", body: "json", resolve: recipeOfPath,
    check: async (ctx, recipe, body) => claim(ctx, recipe, wholeNumber(asRecord(body).baseVersion)),
    validate: (body) => {
      const { content, fields } = parseContent(asRecord(body));
      const base = wholeNumber(asRecord(body).baseVersion);
      if (base === null) fields.baseVersion = "baseVersion must be a whole number.";
      if (Object.keys(fields).length) throw validationFailed(fields);
      return { baseVersion: base as number, content };
    },
    run: async (ctx, target, body) => {
      const db = await ctx.transaction();
      await insertVersion(db, target.recipe.id, target.next, body.content, ctx.me().id);
      publish(ctx, target.recipe.id, target.next, body.content, teamOf(target.recipe));
      return reply(201, await recipeAndVersion(db, ctx.me().id, target.recipe.id, target.next));
    },
  }),
  defineRoute<RecipeSummary, { version: number }, SaveTarget>({
    method: "POST", path: "/api/recipes/:id/restore", access: "session", body: "json", resolve: recipeOfPath,
    check: async (ctx, recipe, body) => {
      const wanted = wholeNumber(asRecord(body).version);
      if (wanted !== null && !(await versionOf(pool, recipe.id, wanted))) throw notFound();
      return claim(ctx, recipe, wholeNumber(asRecord(body).baseVersion));
    },
    validate: (body) => {
      const version = wholeNumber(asRecord(body).version);
      if (version === null) throw validationFailed({ version: "version must be a whole number." });
      if (wholeNumber(asRecord(body).baseVersion) === null) throw validationFailed({ baseVersion: "baseVersion must be a whole number." });
      return { version };
    },
    run: async (ctx, target, body) => {
      const db = await ctx.transaction();
      const restored = (await versionOf(db, target.recipe.id, body.version)) as Version;
      const content: RecipeContent = { name: restored.name, note: `Restored from version ${body.version}`, tags: restored.tags, steps: restored.steps };
      await insertVersion(db, target.recipe.id, target.next, content, ctx.me().id);
      publish(ctx, target.recipe.id, target.next, content, teamOf(target.recipe));
      return reply(201, await recipeAndVersion(db, ctx.me().id, target.recipe.id, target.next));
    },
  }),
  defineRoute<RecipeSummary>({
    method: "GET", path: "/api/recipes/:id/compare", access: "session", resolve: recipeOfPath,
    run: async (ctx, recipe) => {
      const from = Number(ctx.url.searchParams.get("from"));
      const to = Number(ctx.url.searchParams.get("to"));
      const [older, newer] = await Promise.all([versionOf(pool, recipe.id, from), versionOf(pool, recipe.id, to)]);
      if (!older || !newer) throw notFound();
      return reply(200, { changes: compareVersions(older, newer) });
    },
  }),
  defineRoute<RecipeSummary>({
    method: "POST", path: "/api/recipes/:id/opened", access: "session", resolve: recipeOfPath,
    run: async (_, recipe) => {
      await pool.query("UPDATE recipes SET last_used_at = now() WHERE id = $1", [recipe.id]);
      return reply(204);
    },
  }),
];
