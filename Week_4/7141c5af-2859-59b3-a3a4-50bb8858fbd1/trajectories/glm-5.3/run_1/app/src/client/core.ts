export type Json = Record<string, unknown>;

export class ApiFail extends Error {
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly fields: Record<string, string> | undefined;
  constructor(status: number, code: string, message: string, fields: Record<string, string> | undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
  }
}

let announcementsEl: HTMLElement | null = null;
export function announce(message: string): void {
  const el = announcementsEl ?? document.getElementById("announcements");
  announcementsEl = el;
  if (!el) return;
  // One message made twice in a row is announced twice: change the content each time.
  el.textContent = message;
  if (el.dataset.flip === "1") {
    el.dataset.flip = "0";
  } else {
    el.dataset.flip = "1";
  }
  el.append(document.createTextNode(""));
}

export async function api<T = Json>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { ...init, headers: { ...(init?.headers ?? {}) } };
  if (init?.json !== undefined) {
    (opts as RequestInit & { body?: unknown }).body = JSON.stringify(init.json);
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiFail(res.status, err?.code ?? "unknown", err?.message ?? "", err?.fields);
  }
  return data as T;
}

export const el = (html: string): HTMLElement => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export const els = (html: string): HTMLElement[] => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return [...t.content.children] as HTMLElement[];
};

export function qs<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector(sel) as T | null;
}
export const qsa = (sel: string, root: ParentNode = document): HTMLElement[] => [...root.querySelectorAll(sel)] as unknown as HTMLElement[];

export function focusHeading(): void {
  const h = document.getElementById("screen-heading") ?? document.getElementById("signin-heading") ?? document.getElementById("signup-heading");
  h?.focus();
}

export function setTitle(title: string): void {
  document.title = title;
}

export const motion = {
  get reduced(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },
  /** Apply a transform/opacity transition of exactly one of 160/320/640 ms. */
  animate(elm: HTMLElement, from: Partial<Record<string, string>>, to: Partial<Record<string, string>>, ms: 160 | 320 | 640, onEnd?: () => void): void {
    const record = to as Record<string, string>;
    if (motion.reduced) {
      for (const k of Object.keys(record)) (elm.style as unknown as Record<string, string>)[k] = record[k]!;
      onEnd?.();
      return;
    }
    const style = elm.style as unknown as Record<string, string>;
    elm.style.transition = "none";
    const fromRecord = from as Record<string, string>;
    for (const k of Object.keys(fromRecord)) style[k] = fromRecord[k]!;
    void elm.offsetWidth;
    elm.style.transition = `${Object.keys(record).map((k) => `${hyphen(k)} ${ms}ms`).join(", ")}`;
    for (const k of Object.keys(record)) style[k] = record[k]!;
    window.setTimeout(() => {
      elm.style.transition = "";
      onEnd?.();
    }, ms);
  },
  glide(elm: HTMLElement, to: { x?: number; y?: number; rotate?: number }, ms: 160 | 320 | 640 = 160, onEnd?: () => void): void {
    motion.animate(elm, {}, { transform: `translate(${to.x ?? 0}px, ${to.y ?? 0}px) rotate(${to.rotate ?? 0}deg)` }, ms, onEnd);
  },
};

const hyphen = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function fmtDate(date: string): string {
  // Mon 29 Mar 2027 on the Turin date; server decides, and this helper only formats dates the server sent as ISO dates.
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[at.getUTCDay()]} ${d} ${months[m! - 1]} ${y}`;
}
