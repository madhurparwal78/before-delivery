export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((event: Event) => void)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith("on")) {
      const eventName = key.slice(2).toLowerCase();
      node.addEventListener(eventName, value as (event: Event) => void);
    } else if (key === "dataset") {
      continue;
    } else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") {
      node.append(document.createTextNode(child));
    } else {
      node.append(child);
    }
  }
  return node;
}

export function fragment(...children: (Node | string | null | undefined)[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") frag.append(document.createTextNode(child));
    else frag.append(child);
  }
  return frag;
}

export function svg(pathData: string, viewBox = "0 0 24 24", size = 24): SVGSVGElement {
  const svgNs = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(svgNs, "svg");
  node.setAttribute("viewBox", viewBox);
  node.setAttribute("width", String(size));
  node.setAttribute("height", String(size));
  node.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  node.append(path);
  return node;
}

export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; code: string; message: string; fields?: Record<string, string> };

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) {
    return { ok: true, data: null as T, status: 204 };
  }
  if (contentType.includes("application/json")) {
    const body = await response.json();
    if (!response.ok) {
      const error = body?.error ?? {};
      return {
        ok: false,
        status: response.status,
        code: String(error.code ?? "unknown"),
        message: String(error.message ?? ""),
        fields: error.fields,
      };
    }
    return { ok: true, data: body as T, status: response.status };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, code: "unknown", message: "" };
  }
  const text = await response.text();
  return { ok: true, data: text as unknown as T, status: response.status };
}

export const STATUS_REGION = () => document.getElementById("announcements") ?? null;
