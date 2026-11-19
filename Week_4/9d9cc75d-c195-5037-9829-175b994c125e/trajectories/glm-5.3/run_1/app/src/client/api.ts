/** The browser app: shared API client with the pending counter. */

export interface ApiResult<T> {
  status: number;
  json: T | null;
  text: string;
  headers: Headers;
}

let pending = 0;
const pendingEl = (): HTMLElement | null => document.body;

function setPending(delta: number): void {
  pending = Math.max(0, pending + delta);
  document.body.dataset.pending = String(pending);
}

export async function api<T>(method: string, path: string, body?: unknown, opts?: { raw?: string; contentType?: string }): Promise<ApiResult<T>> {
  setPending(1);
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined || opts?.raw !== undefined) {
      headers["content-type"] = opts?.contentType ?? "application/json";
    }
    const res = await fetch(path, {
      method,
      headers,
      body: opts?.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: "same-origin",
    });
    const text = await res.text();
    let json: T | null = null;
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  } finally {
    setPending(-1);
  }
}

export function getCookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const node = t.content.firstElementChild;
  if (!node) throw new Error("empty template");
  return node as HTMLElement;
}
