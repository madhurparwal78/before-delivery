import { config } from "./config.js";
import { SEARCH_LOCK, pool, query, transaction, type Queryable } from "./db.js";
import { isUp, setService } from "./services.js";

const REQUEST_TIMEOUT_MS = 6000;
const TASK_TIMEOUT_MS = 20_000;
const BATCH = 500;
const RESULT_LIMIT = 200;

const SEARCHABLE = ["title", "maker", "year", "materials", "finish", "colour_family", "notes"];
const FILTERABLE = ["colour_family", "materials", "finish", "maker", "year"];

export class SearchUnavailable extends Error {
  constructor(cause: unknown) {
    super("Search is unreachable.", { cause });
  }
}

interface Task {
  taskUid: number;
}

interface TaskStatus {
  status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  error?: { message: string };
}

interface IndexSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
}

async function meili(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(new URL(path, config.meilisearch.url), {
      method,
      headers: { authorization: `Bearer ${config.meilisearch.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SearchUnavailable(error);
  }
}

async function meiliJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await meili(method, path, body);
  if (!response.ok) throw new SearchUnavailable(new Error(`${method} ${path} answered ${response.status}`));
  return (await response.json()) as T;
}

const indexPath = (suffix = ""): string => `/indexes/${encodeURIComponent(config.meilisearch.index)}${suffix}`;

/** Waits for the Meilisearch task's own succeeded status. */
async function confirmTask(task: Task): Promise<void> {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    const status = await meiliJson<TaskStatus>("GET", `/tasks/${task.taskUid}`);
    if (status.status === "succeeded") return;
    if (status.status === "failed" || status.status === "canceled") {
      throw new SearchUnavailable(new Error(status.error?.message ?? "the search task did not succeed"));
    }
    if (Date.now() > deadline) throw new SearchUnavailable(new Error("the search task did not settle"));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function submit(method: string, path: string, body: unknown): Promise<void> {
  const response = await meili(method, path, body);
  if (!response.ok) throw new SearchUnavailable(new Error(`${method} ${path} answered ${response.status}`));
  await confirmTask((await response.json()) as Task);
}

interface Document {
  id: string;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string;
  colour_family: string;
  notes: string;
}

interface DocumentRow extends Document {
  state: string;
}

async function documentsFor(ids: readonly string[], client: Queryable): Promise<DocumentRow[]> {
  return query<DocumentRow>(
    "SELECT id, state, title, maker, year, materials, finish, colour_family, notes FROM deck_reference WHERE id = ANY($1)",
    [ids],
    client,
  );
}

const toDocument = ({ id, title, maker, year, materials, finish, colour_family, notes }: DocumentRow): Document => ({
  id, title, maker, year, materials, finish, colour_family, notes,
});

/** Records that a reference's document must be brought in line with its row; called inside the change's transaction. */
export async function recordSearchUpdate(client: Queryable, referenceId: string): Promise<void> {
  await query("INSERT INTO search_update (reference_id) VALUES ($1)", [referenceId], client);
}

/** Applies every recorded update, in the order recorded, and removes each once Meilisearch confirms it. */
async function applyRecordedUpdates(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [SEARCH_LOCK]);
    const recorded = await query<{ seq: number; reference_id: string }>(
      "SELECT seq, reference_id FROM search_update ORDER BY seq LIMIT $1",
      [BATCH],
      client,
    );
    if (recorded.length === 0) return;
    const ids = [...new Set(recorded.map((row) => row.reference_id))];
    const rows = await documentsFor(ids, client);
    const stored = rows.filter((row) => row.state === "stored");
    const gone = ids.filter((id) => !stored.some((row) => row.id === id));
    if (stored.length > 0) await submit("POST", indexPath("/documents"), stored.map(toDocument));
    if (gone.length > 0) await submit("POST", indexPath("/documents/delete-batch"), gone);
    await client.query("DELETE FROM search_update WHERE seq <= $1", [recorded[recorded.length - 1]?.seq ?? 0]);
  });
}

/**
 * Brings the index up to date before an action answers. Search being unreachable only
 * leaves the update recorded for catch-up; the action itself still succeeded.
 */
export async function confirmSearchWrites(): Promise<void> {
  if (!isUp("search")) return;
  try {
    await applyRecordedUpdates();
  } catch (error) {
    if (!(error instanceof SearchUnavailable)) throw error;
    setService("search", "down");
  }
}

/** Catch-up for updates recorded while search was away, run by the status check. */
export async function catchUp(): Promise<void> {
  let pending = 1;
  while (pending > 0) {
    await applyRecordedUpdates();
    const [row] = await query<{ pending: number }>("SELECT count(*) AS pending FROM search_update");
    pending = row?.pending ?? 0;
  }
}

async function settingsMatch(): Promise<boolean> {
  const settings = await meiliJson<IndexSettings>("GET", indexPath("/settings"));
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
  return same(settings.searchableAttributes, SEARCHABLE) && same([...settings.filterableAttributes].sort(), [...FILTERABLE].sort());
}

/**
 * Makes sure the index exists with its published settings. Returns true when it had to be
 * created or its settings had to be restored, in which case every document must be rewritten.
 */
export async function ensureIndex(): Promise<boolean> {
  const found = await meili("GET", indexPath());
  let rebuild = false;
  if (found.status === 404) {
    await submit("POST", "/indexes", { uid: config.meilisearch.index, primaryKey: "id" });
    rebuild = true;
  } else if (!found.ok) {
    throw new SearchUnavailable(new Error(`index check answered ${found.status}`));
  }
  if (rebuild || !(await settingsMatch())) {
    await submit("PATCH", indexPath("/settings"), { searchableAttributes: SEARCHABLE, filterableAttributes: FILTERABLE });
    rebuild = true;
  }
  return rebuild;
}

/** Writes every stored reference's document from Postgres. */
export async function rebuildIndex(): Promise<void> {
  const ids = await query<{ id: string }>("SELECT id FROM deck_reference WHERE state = 'stored' ORDER BY seq");
  for (let at = 0; at < ids.length; at += BATCH) {
    const rows = await documentsFor(ids.slice(at, at + BATCH).map((row) => row.id), pool);
    await submit("POST", indexPath("/documents"), rows.map(toDocument));
  }
}

export interface SearchFilters {
  colour_family?: string;
  material?: string;
  finish?: string;
}

function filterExpression(filters: SearchFilters): string | undefined {
  const clauses = [
    filters.colour_family ? `colour_family = ${JSON.stringify(filters.colour_family)}` : null,
    filters.material ? `materials = ${JSON.stringify(filters.material)}` : null,
    filters.finish ? `finish = ${JSON.stringify(filters.finish)}` : null,
  ].filter((clause): clause is string => clause !== null);
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

interface Matches {
  source: "index" | "fallback";
  ids: string[];
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (character) => `\\${character}`);

async function fallbackMatches(text: string, filters: SearchFilters): Promise<string[]> {
  const pattern = `%${escapeLike(text)}%`;
  const rows = await query<{ id: string }>(
    `SELECT id FROM deck_reference
     WHERE state = 'stored'
       AND ($1 = '' OR title ILIKE $2 OR maker ILIKE $2 OR notes ILIKE $2 OR finish ILIKE $2
            OR EXISTS (SELECT 1 FROM unnest(materials) AS material WHERE material ILIKE $2))
       AND ($3::text IS NULL OR colour_family = $3)
       AND ($4::text IS NULL OR $4 = ANY(materials))
       AND ($5::text IS NULL OR finish = $5)
     ORDER BY captured_at DESC, seq DESC`,
    [text, pattern, filters.colour_family ?? null, filters.material ?? null, filters.finish ?? null],
  );
  return rows.map((row) => row.id);
}

/** Ids matching a search: from the index while search is up, from the library's own records otherwise. */
export async function matchReferences(text: string, filters: SearchFilters): Promise<Matches> {
  if (isUp("search")) {
    try {
      const answer = await meiliJson<{ hits: { id: string }[] }>("POST", indexPath("/search"), {
        q: text,
        filter: filterExpression(filters),
        limit: RESULT_LIMIT,
        attributesToRetrieve: ["id"],
      });
      return { source: "index", ids: answer.hits.map((hit) => hit.id) };
    } catch (error) {
      if (!(error instanceof SearchUnavailable)) throw error;
      setService("search", "down");
    }
  }
  return { source: "fallback", ids: await fallbackMatches(text, filters) };
}
