import type { Config } from "./config.js";
import { contentUnavailable } from "./errors.js";

/**
 * The PocketBase store behind the content desk. Every call authenticates as
 * the admin from the environment; nothing is cached, so the public site and
 * the public content API read live on the next load after any change.
 */
export class PocketBase {
  private token: string | null = null;
  private tokenAt = 0;

  constructor(private cfg: Config) {}

  private async auth(): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < 60 * 60 * 1000) return this.token;
    const res = await fetch(`${this.cfg.pocketbaseUrl}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: this.cfg.pocketbaseAdminEmail, password: this.cfg.pocketbaseAdminPassword }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || !res.ok) throw contentUnavailable();
    const data = (await res.json().catch(() => null)) as { token?: string } | null;
    if (!data?.token) throw contentUnavailable();
    this.token = data.token;
    this.tokenAt = Date.now();
    return this.token;
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const token = await this.auth();
    const res = await fetch(`${this.cfg.pocketbaseUrl}/api/${path}`, {
      method,
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      throw contentUnavailable();
    });
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: res.status, data };
  }

  async list(collection: string): Promise<Record<string, unknown>[]> {
    const { status, data } = await this.call("GET", `collections/${collection}/records?perPage=200`);
    if (status >= 500) throw contentUnavailable();
    const payload = data as { items?: Record<string, unknown>[] } | null;
    return payload?.items ?? [];
  }

  async create(collection: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { status, data } = await this.call("POST", `collections/${collection}/records`, record);
    if (status >= 500) throw contentUnavailable();
    if (status !== 200 && status !== 201) throw contentUnavailable();
    return data as Record<string, unknown>;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { status, data } = await this.call("PATCH", `collections/${collection}/records/${id}`, patch);
    if (status >= 500) throw contentUnavailable();
    if (status !== 200) throw contentUnavailable();
    return data as Record<string, unknown>;
  }

  async remove(collection: string, id: string): Promise<void> {
    const { status } = await this.call("DELETE", `collections/${collection}/records/${id}`);
    if (status >= 500) throw contentUnavailable();
    if (status !== 204 && status !== 200) throw contentUnavailable();
  }

  async ensureCollection(name: string, fields: { name: string; type: string }[]): Promise<void> {
    const existing = await this.call("GET", `collections/${name}`).catch(() => null);
    if (existing && existing.status === 200) return;
    const schema = fields.map((f) => ({ name: f.name, type: f.type, required: false }));
    const res = await this.call("POST", "collections", { name, type: "base", schema });
    if (res.status >= 500 || (res.status !== 200 && res.status !== 201)) {
      // Created concurrently by another process.
      const check = await this.call("GET", `collections/${name}`).catch(() => null);
      if (!check || check.status !== 200) throw contentUnavailable();
    }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.auth();
      return true;
    } catch {
      return false;
    }
  }
}

export const COLLECTIONS = {
  sessions: "agenda_sessions",
  hospitality: "hospitality_events",
  hotels: "hotels",
  faq: "faq_entries",
} as const;

export const COLLECTION_FIELDS: Record<string, { name: string; type: string }[]> = {
  [COLLECTIONS.sessions]: [
    { name: "number", type: "number" },
    { name: "day", type: "number" },
    { name: "title", type: "text" },
    { name: "format", type: "text" },
    { name: "minutes", type: "number" },
    { name: "outcomes", type: "text" },
  ],
  [COLLECTIONS.hospitality]: [
    { name: "title", type: "text" },
    { name: "day", type: "number" },
    { name: "starts_at", type: "text" },
    { name: "venue", type: "text" },
    { name: "tier", type: "text" },
    { name: "description", type: "text" },
  ],
  [COLLECTIONS.hotels]: [
    { name: "name", type: "text" },
    { name: "distance", type: "text" },
    { name: "rate", type: "text" },
    { name: "map_url", type: "text" },
  ],
  [COLLECTIONS.faq]: [
    { name: "question", type: "text" },
    { name: "answer", type: "text" },
    { name: "sort", type: "number" },
  ],
};
