import { isRecord } from "../../shared/guards";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
  get field(): string | undefined {
    return typeof this.body["field"] === "string" ? this.body["field"] : undefined;
  }
}

async function request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", ...init });
  } catch {
    throw new ApiFailure(0, "network", {});
  }
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => ({}));
  const record = isRecord(body) ? body : {};
  throw new ApiFailure(response.status, typeof record["error"] === "string" ? record["error"] : "error", record);
}

/** The server's JSON bodies follow `shared/types.ts`, which both sides compile against. */
async function json<T>(method: string, path: string, init?: RequestInit): Promise<T> {
  return (await request(method, path, init)).json();
}

const jsonBody = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const api = {
  get: <T>(path: string): Promise<T> => json<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => json<T>("POST", path, jsonBody(body)),
  put: <T>(path: string, body?: unknown): Promise<T> => json<T>("PUT", path, jsonBody(body)),
  patch: <T>(path: string, body: unknown): Promise<T> => json<T>("PATCH", path, jsonBody(body)),
  delete: <T>(path: string): Promise<T> => json<T>("DELETE", path),
  /** A delete the server answers with 204 and no body. */
  remove: async (path: string): Promise<void> => {
    await request("DELETE", path);
  },
  /** A multipart upload whose body is plain bytes, so a refused upload can be sent again unchanged. */
  upload: async <T>(path: string, fields: Record<string, string>, file: { name: string; type: string; data: ArrayBuffer } | null): Promise<T> => {
    const boundary = `----mothlight${crypto.randomUUID().replaceAll("-", "")}`;
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      const filename = file.name.replace(/["\\\r\n]/g, "_");
      parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`));
      parts.push(new Uint8Array(file.data));
      parts.push(encoder.encode("\r\n"));
    }
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    const body = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }
    return json<T>("POST", path, { headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
  },
};

export const GENERIC_ERROR = "Something went wrong. Try again.";
