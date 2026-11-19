// Meilisearch HTTP client: settings, document upserts, deletes, task polling and
// the faceted search the finder runs.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface MeiliConfig {
  url: string;
  apiKey: string;
  index: string;
}

export interface MeiliHit {
  code: string;
  [key: string]: unknown;
}

export interface MeiliSearchResult {
  hits: MeiliHit[];
  total: number;
  facets: Record<string, Record<string, number>>;
  stats: { min: number; max: number } | null;
}

export class MeiliClient {
  constructor(private readonly config: MeiliConfig) {}

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const url = new URL(this.config.url + path);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
    };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send({ hostname: url.hostname, port: Number(url.port || 80), method, path: url.pathname + url.search, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: null });
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async isUp(): Promise<boolean> {
    try {
      const result = await this.request('GET', '/health');
      return result.status === 200;
    } catch {
      return false;
    }
  }

  async applySettings(settings: Record<string, unknown>): Promise<void> {
    await this.request('PATCH', `/indexes/${this.config.index}/settings`, settings);
  }

  async upsertDocuments(documents: Record<string, unknown>[]): Promise<number> {
    if (documents.length === 0) return -1;
    const result = await this.request('POST', `/indexes/${this.config.index}/documents?primaryKey=code`, documents);
    const body = result.body as { taskUid?: number } | null;
    return body?.taskUid ?? -1;
  }

  async deleteDocuments(codes: string[]): Promise<number> {
    const result = await this.request('POST', `/indexes/${this.config.index}/documents/delete-batch`, codes);
    const body = result.body as { taskUid?: number } | null;
    return body?.taskUid ?? -1;
  }

  async waitForTask(taskUid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.request('GET', `/tasks/${taskUid}`);
      const body = result.body as { status?: string } | null;
      if (body?.status === 'succeeded') return true;
      if (body?.status === 'failed') return false;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async search(params: {
    q: string;
    filter?: string;
    facets: string[];
    limit: number;
    offset?: number;
    sort?: string[];
  }): Promise<{
    hits: MeiliHit[];
    estimatedTotalHits: number;
    facetDistribution: Record<string, Record<string, number>>;
    facetStats: Record<string, { min: number; max: number }>;
  } | null> {
    const result = await this.request('POST', `/indexes/${this.config.index}/search`, params);
    if (result.status !== 200) return null;
    return result.body as {
      hits: MeiliHit[];
      estimatedTotalHits: number;
      facetDistribution: Record<string, Record<string, number>>;
      facetStats: Record<string, { min: number; max: number }>;
    };
  }
}
