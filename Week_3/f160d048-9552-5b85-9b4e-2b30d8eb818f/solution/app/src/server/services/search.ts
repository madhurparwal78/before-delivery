import { config } from "../config";

export class SearchUnavailable extends Error {}

export type IndexName = "jobs" | "companies";
export type Document = Record<string, string | number | boolean | null>;
type SearchParams = {
  q: string;
  filter?: string[][];
  facets?: string[];
  page?: number;
  hitsPerPage?: number;
  limit?: number;
  sort?: string[];
};
type SearchResult = {
  hits: Document[];
  totalHits: number;
  facetDistribution: Record<string, Record<string, number>>;
};

const REQUEST_MS = 5000;
const TASK_WAIT_MS = 15000;

async function call(method: string, path: string, body?: unknown, timeoutMs = REQUEST_MS): Promise<Response> {
  try {
    return await fetch(`${config.search.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.search.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SearchUnavailable("search is unreachable");
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new SearchUnavailable(`search answered ${response.status}`);
  return (await response.json()) as T;
}

async function waitForTask(response: Response): Promise<void> {
  const { taskUid } = await json<{ taskUid: number }>(response);
  const deadline = Date.now() + TASK_WAIT_MS;
  while (Date.now() < deadline) {
    const task = await json<{ status: string }>(await call("GET", `/tasks/${taskUid}`));
    if (task.status === "succeeded") return;
    if (task.status === "failed" || task.status === "canceled") throw new SearchUnavailable("search task failed");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new SearchUnavailable("search task timed out");
}

const SETTINGS: Record<IndexName, Record<string, unknown>> = {
  jobs: {
    searchableAttributes: ["title", "company_name", "city_name", "role_family_name"],
    filterableAttributes: ["city", "role_family", "remote", "pay_band", "company_id"],
    sortableAttributes: ["listed_at"],
    pagination: { maxTotalHits: 100000 },
  },
  companies: {
    searchableAttributes: ["name", "city_name"],
    filterableAttributes: ["city", "verified"],
    pagination: { maxTotalHits: 100000 },
  },
};

export async function prepareIndexes(): Promise<void> {
  for (const name of Object.keys(SETTINGS) as IndexName[]) {
    const existing = await call("GET", `/indexes/${name}`);
    if (existing.status === 404) await waitForTask(await call("POST", "/indexes", { uid: name, primaryKey: "id" }));
    else await json(existing);
    await waitForTask(await call("PATCH", `/indexes/${name}/settings`, SETTINGS[name]));
  }
}

export async function putDocuments(index: IndexName, documents: Document[]): Promise<void> {
  if (documents.length === 0) return;
  await waitForTask(await call("POST", `/indexes/${index}/documents?primaryKey=id`, documents, TASK_WAIT_MS));
}

export async function removeDocuments(index: IndexName, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await waitForTask(await call("POST", `/indexes/${index}/documents/delete-batch`, ids));
}

export async function documentIds(index: IndexName): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await json<{ results: { id: string }[] }>(
      await call("GET", `/indexes/${index}/documents?fields=id&limit=1000&offset=${offset}`),
    );
    ids.push(...page.results.map((entry) => entry.id));
    if (page.results.length < 1000) return ids;
  }
}

export async function search(index: IndexName, params: SearchParams): Promise<SearchResult> {
  const result = await json<{
    hits: Document[]; totalHits?: number; estimatedTotalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  }>(await call("POST", `/indexes/${index}/search`, params));
  return {
    hits: result.hits,
    totalHits: result.totalHits ?? result.estimatedTotalHits ?? result.hits.length,
    facetDistribution: result.facetDistribution ?? {},
  };
}

export async function searchReachable(): Promise<boolean> {
  try {
    return (await call("GET", "/health", undefined, 1500)).ok;
  } catch {
    return false;
  }
}

export function filterClause(field: string, values: readonly string[]): string[] {
  return values.map((value) => `${field} = ${JSON.stringify(value)}`);
}
