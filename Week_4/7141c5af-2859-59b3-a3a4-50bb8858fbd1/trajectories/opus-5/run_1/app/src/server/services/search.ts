/**
 * Meilisearch. One index holds every searchable entry of every desk, filtered
 * by desk on each query. The key never leaves this process.
 */
import type { Config } from '../config.ts';

export type EntryKind = 'material' | 'client' | 'piece';

export interface SearchEntry {
  id: string;
  deskId: string;
  kind: EntryKind;
  refId: string;
  label: string;
  href: string;
}

export interface SearchHit {
  kind: EntryKind;
  id: string;
  label: string;
  href: string;
}

export class SearchUnavailable extends Error {
  constructor(cause?: unknown) {
    super('search unavailable');
    this.name = 'SearchUnavailable';
    this.cause = cause;
  }
}

export function entryId(deskId: string, kind: EntryKind, refId: string): string {
  return `${deskId}-${kind}-${refId}`;
}

export function materialEntry(deskId: string, code: string, name: string): SearchEntry {
  return {
    id: entryId(deskId, 'material', code),
    deskId,
    kind: 'material',
    refId: code,
    label: `${name} ${code}`,
    href: `/library?material=${code}`,
  };
}

export function clientEntry(deskId: string, id: string, name: string): SearchEntry {
  return {
    id: entryId(deskId, 'client', id),
    deskId,
    kind: 'client',
    refId: id,
    label: name,
    href: `/clients/${id}`,
  };
}

export function pieceEntry(deskId: string, id: string, title: string): SearchEntry {
  return {
    id: entryId(deskId, 'piece', id),
    deskId,
    kind: 'piece',
    refId: id,
    label: title,
    href: `/pieces/${id}`,
  };
}

interface TaskAnswer {
  taskUid: number;
}

interface TaskStatus {
  status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error?: { code?: string } | null;
}

export class Search {
  private readonly indexName: string;
  private readonly headers: Record<string, string>;
  private settingsReady = false;

  constructor(private readonly config: Config) {
    this.indexName = `${config.search.indexPrefix}_entries`;
    this.headers = { 'content-type': 'application/json' };
    if (config.search.apiKey) this.headers.authorization = `Bearer ${config.search.apiKey}`;
  }

  get index(): string {
    return this.indexName;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.config.search.url}${path}`, {
        ...init,
        headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(5000),
      });
    } catch (cause) {
      throw new SearchUnavailable(cause);
    }
  }

  /**
   * Makes the index and its searchable and filterable fields. Several copies
   * may start together, so an index another copy has just made is not a
   * failure: the engine reports that conflict on the task, not the response.
   */
  async ensureIndex(): Promise<void> {
    if (this.settingsReady) return;

    const present = await this.call(`/indexes/${this.indexName}`);
    await present.arrayBuffer().catch(() => undefined);
    if (present.status === 404) {
      const made = await this.call('/indexes', {
        method: 'POST',
        body: JSON.stringify({ uid: this.indexName, primaryKey: 'id' }),
      });
      if (made.ok) {
        await this.waitFor(((await made.json()) as TaskAnswer).taskUid, ['index_already_exists']);
      } else if (made.status !== 409) {
        throw new SearchUnavailable(`index ${made.status}`);
      }
    } else if (!present.ok) {
      throw new SearchUnavailable(`index ${present.status}`);
    }

    const settings = await this.call(`/indexes/${this.indexName}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ searchableAttributes: ['label'], filterableAttributes: ['deskId'] }),
    });
    if (!settings.ok) throw new SearchUnavailable(`settings ${settings.status}`);
    await this.waitFor(((await settings.json()) as TaskAnswer).taskUid);
    this.settingsReady = true;
  }

  /**
   * Waits for the engine to finish the task, so a write counts as confirmed
   * only then. A failure whose code is in `allowedFailures` is accepted.
   */
  private async waitFor(taskUid: number, allowedFailures: readonly string[] = []): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const res = await this.call(`/tasks/${taskUid}`);
      if (!res.ok) throw new SearchUnavailable(`task ${res.status}`);
      const task = (await res.json()) as TaskStatus;
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') {
        const code = task.error?.code ?? '';
        if (allowedFailures.includes(code)) return;
        throw new SearchUnavailable(`task ${task.status} ${code}`);
      }
      if (Date.now() > deadline) throw new SearchUnavailable('task timed out');
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /** Writes the entries and returns only once the engine has confirmed. */
  async put(entries: readonly SearchEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureIndex();
    const res = await this.call(`/indexes/${this.indexName}/documents`, {
      method: 'PUT',
      body: JSON.stringify(entries),
    });
    if (!res.ok) throw new SearchUnavailable(`documents ${res.status}`);
    await this.waitFor(((await res.json()) as TaskAnswer).taskUid);
  }

  /** Deletes the entries and returns only once the engine has confirmed. */
  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureIndex();
    const res = await this.call(`/indexes/${this.indexName}/documents/delete-batch`, {
      method: 'POST',
      body: JSON.stringify(ids),
    });
    if (!res.ok) throw new SearchUnavailable(`delete ${res.status}`);
    await this.waitFor(((await res.json()) as TaskAnswer).taskUid);
  }

  /** Answers from the engine alone, held to one desk. */
  async query(deskId: string, text: string, limit = 20): Promise<SearchHit[]> {
    await this.ensureIndex();
    const res = await this.call(`/indexes/${this.indexName}/search`, {
      method: 'POST',
      body: JSON.stringify({
        q: text,
        limit,
        filter: `deskId = "${deskId}"`,
        attributesToRetrieve: ['kind', 'refId', 'label', 'href'],
      }),
    });
    if (!res.ok) throw new SearchUnavailable(`search ${res.status}`);
    const body = (await res.json()) as { hits: { kind: EntryKind; refId: string; label: string; href: string }[] };
    return body.hits.map((h) => ({ kind: h.kind, id: h.refId, label: h.label, href: h.href }));
  }

  async reachable(): Promise<boolean> {
    try {
      await this.ensureIndex();
      return true;
    } catch {
      return false;
    }
  }
}
