// Same-origin JSON requests. Every answer comes back with its status; a lost connection is `status: 0`.

interface Answer<T> {
  status: number;
  body: T;
  headers: Headers;
}

interface ApiError {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  [key: string]: unknown;
}

export async function request<T = ApiError>(
  path: string,
  init: { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): Promise<Answer<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }
  let response: Response;
  try {
    response = await fetch(path, { method: init.method ?? "GET", headers, body, credentials: "same-origin" });
  } catch {
    return { status: 0, body: {} as T, headers: new Headers() };
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

/** The operator's time zone, written into the page by the server. */
export function operatorZone(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="earshot-time-zone"]')?.content || "UTC";
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
