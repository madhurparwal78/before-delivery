/** The browser-side session and API client. */

export interface Me {
  id: string;
  name: string;
  avatar: number;
  chosen: boolean;
  email: string | null;
  linked: boolean;
  rating: number;
  rd: number;
  tier: string;
  rankedGames: number;
  chalk: number;
  equipped: { striker: string; board: string; coins: string };
}

export interface AppConfig {
  verdictBannerMs: number;
  shotTimerSeconds: number;
  reconnectSeconds: number;
  rematchSeconds: number;
  roomExpirySeconds: number;
  bandWidenSeconds: number;
  modelVersion: string;
}

export class Api {
  private meCache: Me | null = null;

  async me(): Promise<Me> {
    if (this.meCache !== null) return this.meCache;
    const res = await fetch("/api/me", { headers: { accept: "application/json" } });
    const body = (await res.json()) as Me | { error?: string };
    if (typeof body !== "object" || body === null || (body as { error?: string }).error !== undefined) {
      throw new Error((body as { error?: string }).error ?? "ME_UNAVAILABLE");
    }
    this.meCache = body as Me;
    return this.meCache;
  }

  invalidate(): void {
    this.meCache = null;
  }

  async config(): Promise<AppConfig> {
    const res = await fetch("/api/config");
    return (await res.json()) as AppConfig;
  }

  async health(): Promise<"ok" | "unavailable"> {
    try {
      const res = await fetch("/api/health");
      const body = (await res.json()) as { status: string };
      return body.status === "ok" ? "ok" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
}

export const api = new Api();

export async function jsonFetch<T>(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, body };
}

/** Renders the database outage banner at the top of the page. */
export function mountOutageBanner(): void {
  const holder = document.createElement("status");
  holder.id = "outage-banner";
  holder.setAttribute("role", "status");
  holder.textContent = "Online play is unavailable right now. Pass and play still works.";
  holder.style.display = "none";
  document.body.prepend(holder);
  const check = async () => {
    const status = await api.health();
    holder.style.display = status === "ok" ? "none" : "block";
  };
  void check();
  setInterval(() => void check(), 10000);
}

/** A page-level confirmation strip. */
export function pageStatus(text: string, ms = 5000): void {
  let el = document.getElementById("page-status");
  if (el === null) {
    el = document.createElement("status");
    el.id = "page-status";
    el.setAttribute("role", "status");
    document.body.prepend(el);
  }
  el.textContent = text;
  el.style.display = "block";
  window.setTimeout(() => {
    if (el !== null && el.textContent === text) el.style.display = "none";
  }, ms);
}

export function loadingEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "loading";
  for (let i = 0; i < 4; i++) {
    const pocket = document.createElement("div");
    pocket.className = "pocket";
    el.appendChild(pocket);
  }
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

/** The named navigation used by every page. */
export function navBar(me: Me | null, chalk: number | null): HTMLElement {
  const bar = el("nav", { class: "top-bar" });
  if (me !== null) {
    bar.appendChild(el("a", { href: `/profile/${encodeURIComponent(me.name)}` }, `${me.name} profile`));
  }
  bar.appendChild(el("span", { class: "chip", id: "chalk-balance" }, chalk === null ? "" : `${chalk} chalk`));
  bar.appendChild(el("a", { href: "/shop" }, "Shop"));
  bar.appendChild(el("a", { href: "/leaderboard" }, "Leaderboard"));
  return bar;
}

/** Focuses the page's h1, for keyboard flows. */
export function focusHeading(): void {
  const h1 = document.querySelector("h1");
  if (h1 instanceof HTMLElement) {
    h1.setAttribute("tabindex", "-1");
    h1.focus();
  }
}

/** Renders one of the 24 avatars as a drawn face. */
export function avatarSvg(n: number, size = 44): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 44 44");
  svg.setAttribute("aria-hidden", "true");
  const hue = (n * 47) % 360;
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", "44");
  bg.setAttribute("height", "44");
  bg.setAttribute("fill", `hsl(${hue} 70% 82%)`);
  svg.appendChild(bg);
  const face = document.createElementNS(ns, "circle");
  face.setAttribute("cx", "22");
  face.setAttribute("cy", "18");
  face.setAttribute("r", "8");
  face.setAttribute("fill", `hsl(${hue} 55% 40%)`);
  svg.appendChild(face);
  const body = document.createElementNS(ns, "path");
  body.setAttribute("d", "M6 42 C6 30 16 26 22 26 C28 26 38 30 38 42 Z");
  body.setAttribute("fill", `hsl(${hue} 55% 40%)`);
  svg.appendChild(body);
  return svg;
}

/** The minutes:seconds countdown used by every timer, rounded up. */
export function clockText(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Elapsed time in whole seconds, rounded down. */
export function elapsedText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
