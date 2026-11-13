/** Browser API helpers. No rest rule, closure or expiry calculation lives here. */

export interface MeInfo {
  id: string;
  name: string;
  role: "owner_master" | "crew";
  vessel_id: string | null;
  server_now_utc: string;
  today_ship_date: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly fieldErrors: Record<string, string> | undefined,
    readonly bodyText: string
  ) {
    super(`API ${status}`);
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const shaped = body as { error?: string; errors?: Record<string, string> } | null;
    throw new ApiError(response.status, shaped?.error, shaped?.errors, text);
  }
  return body as T;
}

export async function getMe(): Promise<MeInfo | null> {
  try {
    return await apiJson<MeInfo>("/api/me");
  } catch {
    return null;
  }
}

export function parseQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function navigate(path: string): void {
  window.location.assign(path);
}

/** An element builder keeping pages terse. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | null> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (key === "class") node.className = value as string;
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value as string);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** `<rest>` formatted with one decimal place, as Feedback states requires. */
export function restText(hours: number): string {
  return hours.toFixed(1);
}
