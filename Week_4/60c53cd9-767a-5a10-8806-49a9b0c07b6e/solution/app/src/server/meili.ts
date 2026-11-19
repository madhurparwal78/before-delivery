/** A small Meilisearch REST client. Every call is bounded so an unreachable search service fails at once. */
import { monotonicMs } from "./clock.js";
import type { Config } from "./config.js";

export class SearchUnavailable extends Error {}

interface MeiliTask {
  readonly uid: number;
  readonly status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
}

interface MeiliSearchResponse {
  readonly hits: Record<string, unknown>[];
  readonly facetDistribution?: Record<string, Record<string, number>>;
  readonly facetStats?: Record<string, { min: number; max: number }>;
}

export class SearchClient {
  constructor(private readonly config: Config["meili"]) {}

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = 5_000): Promise<{ status: number; json: T }> {
    let response: Response;
    try {
      response = await fetch(this.config.url + path, {
        method,
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SearchUnavailable("search unreachable");
    }
    const text = await response.text();
    let json: unknown = {};
    try {
      json = text === "" ? {} : JSON.parse(text);
    } catch {
      throw new SearchUnavailable("search answered garbage");
    }
    return { status: response.status, json: json as T };
  }

  async search(body: Record<string, unknown>): Promise<MeiliSearchResponse> {
    const { status, json } = await this.request<MeiliSearchResponse>(
      "POST",
      `/indexes/${encodeURIComponent(this.config.index)}/search`,
      body,
      900,
    );
    if (status !== 200) throw new SearchUnavailable(`search answered ${status}`);
    return json;
  }

  async tasks(uids: number[]): Promise<MeiliTask[]> {
    const { status, json } = await this.request<{ results: MeiliTask[] }>("GET", `/tasks?uids=${uids.join(",")}&limit=${uids.length}`);
    if (status !== 200) throw new SearchUnavailable(`tasks answered ${status}`);
    return json.results;
  }

  private async enqueue(method: string, path: string, body: unknown): Promise<number> {
    const { status, json } = await this.request<{ taskUid: number }>(method, path, body);
    if (status >= 300) throw new SearchUnavailable(`search answered ${status}`);
    return json.taskUid;
  }

  /** Waits for a task to finish and returns whether it succeeded. */
  async waitFor(uid: number, timeoutMs = 30_000): Promise<boolean> {
    const deadline = monotonicMs() + timeoutMs;
    while (monotonicMs() < deadline) {
      const [task] = await this.tasks([uid]);
      if (task?.status === "succeeded") return true;
      if (task?.status === "failed" || task?.status === "canceled") return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new SearchUnavailable("task timed out");
  }

  async ensureIndex(): Promise<void> {
    // Creation fails harmlessly when the index (or a racing instance's copy) already exists.
    const created = await this.request<{ taskUid?: number }>("POST", "/indexes", { uid: this.config.index, primaryKey: "code" });
    if (created.status < 300 && created.json.taskUid !== undefined) await this.waitFor(created.json.taskUid);
    const settings = await this.enqueue("PATCH", `/indexes/${encodeURIComponent(this.config.index)}/settings`, {
      searchableAttributes: ["code", "facing", "viewTag", "band"],
      filterableAttributes: ["code", "bedrooms", "band", "facing", "viewTag", "status", "price", "floor", "stack"],
      sortableAttributes: ["price", "floor", "stack"],
      typoTolerance: { enabled: false },
      pagination: { maxTotalHits: 1000 },
      faceting: { maxValuesPerFacet: 100 },
    });
    if (!(await this.waitFor(settings))) throw new SearchUnavailable("settings task failed");
  }

  putDocuments(documents: Record<string, unknown>[]): Promise<number> {
    return this.enqueue("POST", `/indexes/${encodeURIComponent(this.config.index)}/documents?primaryKey=code`, documents);
  }

  deleteDocuments(codes: string[]): Promise<number> {
    return this.enqueue("POST", `/indexes/${encodeURIComponent(this.config.index)}/documents/delete-batch`, codes);
  }
}
