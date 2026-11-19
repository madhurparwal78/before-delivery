// Shared client utilities: fetch, announcements, focus, dialog behaviour, refresh.

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    lastValue?: string;
    lastAt?: string;
    busyUntil?: string;
  };
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.error?.message ?? `Request failed`);
  }

  get code(): string {
    return this.body?.error?.code ?? "network";
  }

  get fields(): Record<string, string> {
    return this.body?.error?.fields ?? {};
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

/** Announce exactly once per call, in the page's language, by replacing the region text. */
let announceCounter = 0;
export function announce(message: string): void {
  const region = document.getElementById("announcements");
  if (!region) return;
  announceCounter += 1;
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
    region.dataset.count = String(announceCounter);
  });
}

export function focusHeading(): void {
  const h = document.querySelector("main h1") as HTMLElement | null;
  h?.setAttribute("tabindex", "-1");
  h?.focus({ preventScroll: true });
  h?.scrollIntoView({ block: "start" });
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("data-") || key.startsWith("aria-") || key === "role") node.setAttribute(key, value);
    else if (key in node) (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** Escape-preventing text helper for templates. */
export function text(s: string): Text {
  return document.createTextNode(s);
}

export function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  return root.querySelector(sel) as T;
}

/** A running button: `Working…` while its request is open, then its own name again. */
export async function withWorking<T>(button: HTMLElement, working: string, fn: () => Promise<T>): Promise<T> {
  const original = button.textContent ?? "";
  const wasDisabled = button.getAttribute("aria-disabled");
  button.textContent = working;
  button.setAttribute("aria-disabled", "true");
  try {
    return await fn();
  } finally {
    button.textContent = original;
    if (wasDisabled === null) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", wasDisabled);
  }
}

export function formatQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s.length > 0 ? `?${s}` : "";
}
