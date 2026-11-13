import { MeiliSearch } from 'meilisearch';

export interface PackDocument {
  id: string;
  skuName: string;
  drinkName: string;
  aliases: string[];
  noticeTitles: string[];
}

/**
 * Meilisearch holds a rebuildable index of pack names — never a price. The one
 * price decision reads Postgres when the search answers.
 */
export class SearchIndex {
  private client: MeiliSearch | null = null;
  private indexName = '';
  private lastContactOk = true;
  private behindSince: number | null = Date.now();
  private pendingChanges = new Set<string>();

  constructor(config: { meilisearchUrl: string; meilisearchApiKey: string }, private copyId: string) {
    if (config.meilisearchUrl && config.meilisearchApiKey) {
      try {
        this.client = new MeiliSearch({ host: config.meilisearchUrl, apiKey: config.meilisearchApiKey });
      } catch {
        this.client = null;
      }
    }
    this.indexName = `interval_${this.copyId}_packs`;
  }

  get reachable(): boolean {
    return this.lastContactOk;
  }

  get behind(): boolean {
    return this.pendingChanges.size > 0;
  }

  markChange(skuCode: string): void {
    this.pendingChanges.add(skuCode);
    if (this.behindSince === null) this.behindSince = Date.now();
  }

  async contactCheck(): Promise<boolean> {
    if (!this.client) {
      this.lastContactOk = false;
      return false;
    }
    try {
      await Promise.race([
        this.client.health(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      this.lastContactOk = true;
      return true;
    } catch {
      this.lastContactOk = false;
      return false;
    }
  }

  async ensureIndex(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.index(this.indexName).getRawInfo();
      return true;
    } catch {
      return false;
    }
  }

  async createIndex(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const task = await this.client.createIndex(this.indexName, { primaryKey: 'id' });
      const done = await this.client.tasks.waitForTask(task.taskUid, { timeout: 30000, interval: 200 });
      if (done.status !== 'succeeded') return false;
      const upd = await this.client.index(this.indexName).updateSearchableAttributes(['skuName', 'drinkName', 'aliases', 'noticeTitles']);
      const done2 = await this.client.tasks.waitForTask(upd.taskUid, { timeout: 30000, interval: 200 });
      return done2.status === 'succeeded';
    } catch {
      return false;
    }
  }

  async replaceAll(docs: PackDocument[]): Promise<boolean> {
    if (!this.client) return false;
    try {
      if (!(await this.ensureIndex())) await this.createIndex();
      const task = await this.client.index(this.indexName).deleteAllDocuments();
      const d1 = await this.client.tasks.waitForTask(task.taskUid, { timeout: 30000, interval: 200 });
      if (d1.status !== 'succeeded') return false;
      const task2 = await this.client.index(this.indexName).addDocuments(docs, { primaryKey: 'id' });
      const d2 = await this.client.tasks.waitForTask(task2.taskUid, { timeout: 30000, interval: 200 });
      if (d2.status !== 'succeeded') return false;
      this.pendingChanges.clear();
      this.behindSince = null;
      return true;
    } catch {
      return false;
    }
  }

  async upsert(doc: PackDocument): Promise<boolean> {
    if (!this.client) return false;
    try {
      if (!(await this.ensureIndex())) {
        const created = await this.createIndex();
        if (!created) return false;
      }
      const task = await this.client.index(this.indexName).addDocuments([doc], { primaryKey: 'id' });
      const done = await this.client.tasks.waitForTask(task.taskUid, { timeout: 15000, interval: 200 });
      if (done.status !== 'succeeded') return false;
      this.pendingChanges.delete(doc.id);
      if (this.pendingChanges.size === 0) this.behindSince = null;
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string): Promise<string[] | null> {
    if (!this.client) return null;
    try {
      const r = await Promise.race([
        this.client.index(this.indexName).search(query, { limit: 20, matchingStrategy: 'all' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!r) {
        this.lastContactOk = false;
        return null;
      }
      this.lastContactOk = true;
      return r.hits.map((h) => String((h as Record<string, unknown>).id));
    } catch {
      this.lastContactOk = false;
      return null;
    }
  }
}
