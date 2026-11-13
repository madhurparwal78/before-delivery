import type { SearchConfig } from './config.js';

export class SearchUnavailableError extends Error {}

export const SEARCH_INDEX = 'published_challenges';

const REQUEST_TIMEOUT_MS = 5000;
const TASK_POLL_INTERVAL_MS = 150;
const TASK_TIMEOUT_MS = 4000;

export interface ChallengeDocument {
  digest: string;
  ruleset: string;
  title: string;
  description: string;
  difficulty: string;
  creatorName: string;
}

export interface SearchQuery {
  text: string;
  difficulty: string | null;
  ruleset: string | null;
}

interface TaskReference {
  taskUid: number;
}

export class SearchIndex {
  constructor(private readonly config: SearchConfig) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.url), {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SearchUnavailableError((error as Error).message);
    }
    if (response.status >= 500 || response.status === 0) {
      throw new SearchUnavailableError(`provider status ${response.status}`);
    }
    if (!response.ok && response.status !== 404) {
      throw new SearchUnavailableError(`provider status ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async initialize(): Promise<void> {
    await this.request('POST', '/indexes', { uid: SEARCH_INDEX, primaryKey: 'digest' });
    const task = await this.request<TaskReference>('PATCH', `/indexes/${SEARCH_INDEX}/settings`, {
      searchableAttributes: ['title', 'description', 'creatorName'],
      filterableAttributes: ['difficulty', 'ruleset'],
      sortableAttributes: ['title', 'digest'],
      typoTolerance: { enabled: false },
    });
    await this.awaitTask(task.taskUid);
  }

  async awaitTask(taskUid: number): Promise<void> {
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    for (;;) {
      const task = await this.request<{ status: string }>('GET', `/tasks/${taskUid}`);
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new SearchUnavailableError(`index task ${task.status}`);
      }
      if (Date.now() >= deadline) throw new SearchUnavailableError('index task still pending');
      await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS));
    }
  }

  async upsert(document: ChallengeDocument): Promise<void> {
    const task = await this.request<TaskReference>('PUT', `/indexes/${SEARCH_INDEX}/documents`, [document]);
    await this.awaitTask(task.taskUid);
  }

  async remove(digest: string): Promise<void> {
    const task = await this.request<TaskReference>(
      'DELETE',
      `/indexes/${SEARCH_INDEX}/documents/${digest}`,
    );
    await this.awaitTask(task.taskUid);
  }

  async listDigests(): Promise<string[]> {
    const page = await this.request<{ results: { digest: string }[] }>(
      'GET',
      `/indexes/${SEARCH_INDEX}/documents?limit=10000&fields=digest`,
    );
    return (page.results ?? []).map((row) => row.digest);
  }

  /** Searches the provider index with typed equality filters only. */
  async search(query: SearchQuery): Promise<string[]> {
    const filters: string[] = [];
    if (query.difficulty !== null) filters.push(`difficulty = "${query.difficulty}"`);
    if (query.ruleset !== null) filters.push(`ruleset = "${query.ruleset}"`);
    const result = await this.request<{ hits: { digest: string }[] }>(
      'POST',
      `/indexes/${SEARCH_INDEX}/search`,
      {
        q: query.text,
        limit: 1000,
        matchingStrategy: 'all',
        attributesToRetrieve: ['digest'],
        ...(filters.length === 0 ? {} : { filter: filters }),
      },
    );
    return (result.hits ?? []).map((hit) => hit.digest);
  }
}
