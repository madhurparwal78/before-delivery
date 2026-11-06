// Client state: the session, per-screen state and the drafts kept on the
// device, all in one place.

export type Json = Record<string, unknown>;

export class ClientStore {
  private drafts = new Map<string, Json>();

  draftOf(key: string): Json {
    const held = this.drafts.get(key);
    if (held !== undefined) return held;
    const fresh: Json = {};
    this.drafts.set(key, fresh);
    return fresh;
  }

  setDraft(key: string, patch: Json): void {
    const held = this.drafts.get(key) ?? {};
    this.drafts.set(key, { ...held, ...patch });
  }

  clearDraft(key: string): void {
    this.drafts.delete(key);
  }
}

// The API client: same-origin fetches with the session cookie, plus the
// published error shape.
export class Api {
  async get(path: string): Promise<Json> {
    return await this.call("GET", path, undefined);
  }

  async post(path: string, body: Json | undefined): Promise<Json> {
    return await this.call("POST", path, body ?? {});
  }

  async patch(path: string, body: Json): Promise<Json> {
    return await this.call("PATCH", path, body);
  }

  async delete(path: string): Promise<Json> {
    return await this.call("DELETE", path, undefined);
  }

  async call(method: string, path: string, body: Json | undefined): Promise<Json> {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return {};
    const text = await response.text();
    const parsed = text.length === 0 ? {} : JSON.parse(text) as Json;
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string; fields?: Json } }).error;
      throw new ApiError(response.status, error?.code ?? "error", error?.message ?? "", error?.fields ?? {});
    }
    return parsed as Json;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Json,
  ) {
    super(message);
  }
}
