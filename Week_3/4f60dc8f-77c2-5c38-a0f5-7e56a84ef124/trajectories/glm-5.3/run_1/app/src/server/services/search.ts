import type { AppConfig } from '../config';

export interface SearchHit {
  id: string;
  kind: 'case_study' | 'service' | 'insight';
  title: string;
  summary: string;
  url: string;
}

export class Search {
  private readonly config: AppConfig;
  private reindexing = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.meilisearch.url}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.meilisearch.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async ensureIndex(): Promise<void> {
    const create = await fetch(`${this.config.meilisearch.url}/indexes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ uid: 'studio_content', primaryKey: 'id' }),
      signal: AbortSignal.timeout(5_000),
    });
    await this.waitForTask(create.ok ? ((await create.json() as { taskUid: number }).taskUid) : 0).catch(() => undefined);
    await fetch(`${this.config.meilisearch.url}/indexes/studio_content/settings`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ searchableAttributes: ['title', 'summary'] }),
      signal: AbortSignal.timeout(5_000),
    });
  }

  async waitForTask(taskUid: number): Promise<void> {
    if (taskUid === undefined) {
      return;
    }
    for (let i = 0; i < 20; i++) {
      const response = await fetch(`${this.config.meilisearch.url}/tasks/${taskUid}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return;
      }
      const task = await response.json() as { status: string };
      if (task.status === 'succeeded' || task.status === 'failed') {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async reindex(documents: SearchHit[]): Promise<void> {
    if (this.reindexing) {
      return;
    }
    this.reindexing = true;
    try {
      const deleteTask = await fetch(`${this.config.meilisearch.url}/indexes/studio_content/documents`, {
        method: 'DELETE',
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      if (deleteTask.ok) {
        await this.waitForTask((await deleteTask.json() as { taskUid: number }).taskUid);
      }
      if (documents.length > 0) {
        const add = await fetch(`${this.config.meilisearch.url}/indexes/studio_content/documents?primaryKey=id`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(documents),
          signal: AbortSignal.timeout(5_000),
        });
        if (add.ok) {
          await this.waitForTask((await add.json() as { taskUid: number }).taskUid);
        }
      }
    } finally {
      this.reindexing = false;
    }
  }

  async search(query: string): Promise<SearchHit[]> {
    const response = await fetch(`${this.config.meilisearch.url}/indexes/studio_content/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ q: query, limit: 20 }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      throw new Error('unreachable');
    }
    const result = await response.json() as { hits: SearchHit[] };
    return result.hits ?? [];
  }
}
