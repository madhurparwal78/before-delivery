import type { Step } from "../shared/operations/types";
import { settings } from "./config";
import { pool, query } from "./db";
import { outage } from "./outage";

/** Meilisearch cannot be reached, or answered with a server failure. */
export class SearchUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_MS = 5000;
const TASK_WAIT_MS = 10000;

const { url, apiKey, index } = settings.meilisearch;

interface Answer {
  status: number;
  body: Record<string, unknown> | null;
}

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  if (outage.meilisearch) throw new SearchUnavailable("search outage");
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SearchUnavailable(String(error));
  }
  if (response.status >= 500) throw new SearchUnavailable(`search answered ${response.status}`);
  const text = await response.text();
  if (!response.ok && response.status !== 404) throw new Error(`search refused ${path}: ${response.status} ${text}`);
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function waitForTask(taskUid: unknown): Promise<void> {
  const deadline = Date.now() + TASK_WAIT_MS;
  while (Date.now() < deadline) {
    const task = (await call("GET", `/tasks/${String(taskUid)}`)).body;
    if (task?.status === "succeeded") return;
    if (task?.status === "failed" || task?.status === "canceled") throw new Error(`search task ${String(taskUid)} ${String(task.status)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new SearchUnavailable("search task did not finish");
}

const SETTINGS = {
  searchableAttributes: ["name", "tags", "operations", "argumentValues", "note"],
  filterableAttributes: ["ownerUserId", "teamId"],
  rankingRules: ["words", "typo", "proximity", "attribute", "exactness", "updatedAt:desc"],
};

let ready = false;

/** Creates the index and applies its settings; the retry loop calls it until it succeeds. */
async function prepareIndex(): Promise<void> {
  if ((await call("GET", `/indexes/${index}`)).status === 404) {
    const created = await call("POST", "/indexes", { uid: index, primaryKey: "id" });
    await waitForTask(created.body?.taskUid);
  }
  const applied = await call("PATCH", `/indexes/${index}/settings`, SETTINGS);
  await waitForTask(applied.body?.taskUid);
  ready = true;
}

interface IndexRow {
  id: string;
  owner_user_id: string | null;
  team_id: string | null;
  latest_version: number;
  name: string;
  note: string;
  tags: string[];
  steps: Step[];
  updated_at: Date;
}

function argumentValues(steps: readonly Step[]): string[] {
  return steps.flatMap((step) =>
    Object.values(step.args).filter((value) => typeof value !== "boolean").map(String).filter((value) => value !== ""),
  );
}

/** Puts the newest version of each recipe into the index; `wait` holds until Meilisearch has applied it. */
export async function indexRecipes(ids: string[], wait = false): Promise<void> {
  if (ids.length === 0) return;
  const rows = await query<IndexRow>(
    pool,
    `SELECT r.id, r.owner_user_id, r.team_id, r.latest_version, v.name, v.note, v.tags, v.steps, v.created_at AS updated_at
     FROM recipes r JOIN recipe_versions v ON v.recipe_id = r.id AND v.n = r.latest_version WHERE r.id = ANY($1)`,
    [ids],
  );
  if (rows.length === 0) return;
  if (!ready) await prepareIndex();
  const documents = rows.map((row) => ({
    id: row.id,
    name: row.name,
    note: row.note,
    tags: row.tags,
    operations: [...new Set(row.steps.map((step) => step.op))],
    argumentValues: argumentValues(row.steps),
    ownerUserId: row.owner_user_id,
    teamId: row.team_id,
    latestVersion: row.latest_version,
    updatedAt: Math.floor(row.updated_at.getTime() / 1000),
  }));
  const added = await call("POST", `/indexes/${index}/documents?primaryKey=id`, documents);
  if (wait) await waitForTask(added.body?.taskUid);
  for (const row of rows) {
    await pool.query("UPDATE recipes SET indexed_version = $2 WHERE id = $1 AND indexed_version < $2", [row.id, row.latest_version]);
  }
}

/** Index one recipe without holding the request; a failure is retried by the loop. */
export function indexSoon(id: string): void {
  indexRecipes([id]).catch((error: unknown) => console.error("indexing failed, will retry:", error instanceof Error ? error.message : error));
}

export async function searchRecipeIds(userId: string, teamIds: string[], q: string): Promise<string[]> {
  if (!ready) await prepareIndex();
  const filter = [`ownerUserId = ${JSON.stringify(userId)}`, ...(teamIds.length ? [`teamId IN ${JSON.stringify(teamIds)}`] : [])].join(" OR ");
  const answer = await call("POST", `/indexes/${index}/search`, { q, filter, limit: 1000, attributesToRetrieve: ["id"] });
  return ((answer.body?.hits ?? []) as { id: string }[]).map((hit) => hit.id);
}

async function retryPending(): Promise<void> {
  if (!ready) await prepareIndex();
  const rows = await query<{ id: string }>(pool, "SELECT id FROM recipes WHERE indexed_version <> latest_version LIMIT 200");
  await indexRecipes(rows.map((row) => row.id));
}

/** Applies the index settings and re-sends recipes the index has not caught up with, every 5 seconds. */
export function startIndexer(): void {
  const tick = (): void => {
    retryPending().catch((error: unknown) => console.error("search not ready:", error instanceof Error ? error.message : error));
  };
  tick();
  setInterval(tick, RETRY_MS).unref();
}
