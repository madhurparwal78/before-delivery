import { config } from './config.js';

// Minimal typed Meilisearch client over fetch.
export interface MeiliSearchHit {
  [key: string]: unknown;
}

export interface MeiliFacets {
  [facet: string]: { [value: string]: number };
}

export interface MeiliSearchResponse {
  hits: MeiliSearchHit[];
  total: number;
  facetDistribution?: MeiliFacets;
  estimatedTotalHits?: number;
}

function headers(): Record<string, string> {
  const key = config().meilisearchApiKey;
  const base: Record<string, string> = { 'content-type': 'application/json' };
  if (key) base.authorization = `Bearer ${key}`;
  return base;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${config().meilisearchUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string>) },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`meilisearch ${response.status}: ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export interface TaskStatus {
  taskUid: number;
  status: string;
  error?: { message?: string; code?: string };
}

export const meili = {
  async health(): Promise<boolean> {
    try {
      const result = await request<{ status: string }>('/health');
      return result.status === 'available';
    } catch {
      return false;
    }
  },

  async createIndex(uid: string, primaryKey: string): Promise<void> {
    await request<TaskStatus>(`/indexes`, {
      method: 'POST',
      body: JSON.stringify({ uid, primaryKey }),
    }).catch(async (err: Error) => {
      if (!/index_already_exists/i.test(err.message)) throw err;
    });
  },

  async setSettings(
    uid: string,
    settings: Record<string, unknown>,
  ): Promise<TaskStatus> {
    return request<TaskStatus>(`/indexes/${uid}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  },

  async addDocuments(uid: string, documents: Record<string, unknown>[]): Promise<TaskStatus> {
    return request<TaskStatus>(`/indexes/${uid}/documents?primaryKey=id`, {
      method: 'POST',
      body: JSON.stringify(documents),
    });
  },

  async updateDocuments(uid: string, documents: Record<string, unknown>[]): Promise<TaskStatus> {
    return request<TaskStatus>(`/indexes/${uid}/documents?primaryKey=id`, {
      method: 'PUT',
      body: JSON.stringify(documents),
    });
  },

  async deleteDocument(uid: string, id: string): Promise<TaskStatus> {
    return request<TaskStatus>(`/indexes/${uid}/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async deleteAllDocuments(uid: string): Promise<TaskStatus> {
    return request<TaskStatus>(`/indexes/${uid}/documents`, { method: 'DELETE' });
  },

  async search(
    uid: string,
    body: Record<string, unknown>,
  ): Promise<MeiliSearchResponse> {
    return request<MeiliSearchResponse>(`/indexes/${uid}/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async waitForTask(task: TaskStatus): Promise<void> {
    const start = Date.now();
    for (;;) {
      const result = await request<{ status: string; error?: unknown }>(`/tasks/${task.taskUid}`);
      if (result.status === 'succeeded') return;
      if (result.status === 'failed') throw new Error(`meili task failed: ${JSON.stringify(result.error)}`);
      if (Date.now() - start > 10000) throw new Error('meili task timeout');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },
};
