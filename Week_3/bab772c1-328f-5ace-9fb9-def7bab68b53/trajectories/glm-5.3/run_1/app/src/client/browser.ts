// Shared browser helpers: API calls, elements, announcements and the
// WHATWG form-urlencoded address handling.

export async function api<T>(
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: T }> {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null as unknown as T;
  if (raw !== "") {
    try {
      body = JSON.parse(raw) as T;
    } catch {
      body = null as unknown as T;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export function maybe<T extends HTMLElement>(id: string): T | null {
  return (document.getElementById(id) as T | null) ?? null;
}

export function text(node: HTMLElement, value: string): void {
  node.textContent = value;
}

export function hide(node: HTMLElement, hidden: boolean): void {
  node.hidden = hidden;
}

export function announce(node: HTMLElement, message: string): void {
  node.textContent = message;
}

export function fieldErrorFor(body: unknown): Record<string, string> {
  const errors = (body as { errors?: Record<string, string> } | null)?.errors;
  return errors ?? {};
}

export function requestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The address: every write replaces the current history entry, changing only
// its own parameter and keeping all others.
export function writeParam(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value === null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState(null, "", url);
}

export function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
