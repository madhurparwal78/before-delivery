// Count-up figures, announcements, and API fetch helpers for the client.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean | null> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector(selector) as T | null;
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function coarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

// ---------- announcements ----------

type RegionKind = "single" | "last5";

const regions = new Map<string, { node: HTMLElement; kind: RegionKind }>();

/** Creates the status region once; it stays in the page and the accessibility tree. */
export function ensureStatusRegion(name: string, kind: RegionKind = "single"): HTMLElement {
  let region = document.querySelector(`[data-region="${name}"]`);
  if (!region) {
    const node = el("div", {
      role: "status",
      "aria-live": "polite",
      class: "status-region",
      "data-region": name,
      "aria-label": name
    });
    if (kind === "last5") node.setAttribute("aria-live", "assertive");
    document.body.append(node);
    region = node;
  }
  if (!regions.has(name)) regions.set(name, { node: region as HTMLElement, kind });
  return region as HTMLElement;
}

/** Announce one message in a region, keeping only the latest (or the last five, oldest first). */
export function announce(region: string, message: string): void {
  const entry = regions.get(region) ?? { node: ensureStatusRegion(region), kind: "single" as RegionKind };
  const holder = entry.node;
  holder.textContent = "";
  const line = el("p", { class: "msg" }, message);
  if (entry.kind === "last5") {
    const previous = Array.from(holder.dataset.lines ? JSON.parse(holder.dataset.lines) as string[] : []);
    const next = [...previous, message].slice(-5);
    holder.dataset.lines = JSON.stringify(next);
    holder.textContent = "";
    for (const m of next) holder.append(el("p", { class: "msg" }, m));
  } else {
    holder.dataset.lines = JSON.stringify([message]);
    holder.append(line);
  }
}

/** Clear a region for a new photo (Photo status shows only the current photo's messages). */
export function clearRegion(region: string): void {
  const entry = regions.get(region);
  if (entry) {
    entry.node.textContent = "";
    delete entry.node.dataset.lines;
  }
}

// ---------- count-up figures ----------

interface FigureState { from: number; to: number; startedAt: number; format: (n: number) => string }

const activeFigures = new Map<HTMLElement, FigureState>();

/** Attach a count-up figure to an element with data-figure. */
export function setFigure(node: HTMLElement, to: number, format: (n: number) => string, animate = true): void {
  const prev = activeFigures.get(node);
  const from = prev ? prev.to : 0;
  const firstPaint = !prev && !node.dataset.firstPaintDone;
  node.dataset.firstPaintDone = "1";
  if (!animate || reducedMotion() || firstPaint || from === to) {
    activeFigures.set(node, { from: to, to, startedAt: performance.now(), format });
    node.textContent = format(to);
    return;
  }
  activeFigures.set(node, { from, to, startedAt: performance.now(), format });
  requestAnimationFrame(tickFigures);
}

function tickFigures(): void {
  const now = performance.now();
  let anyActive = false;
  for (const [node, state] of activeFigures) {
    if (state.to === state.from) continue;
    const t = Math.min(1, (now - state.startedAt) / 600);
    if (t >= 1) {
      node.textContent = state.format(state.to);
      state.from = state.to;
    } else {
      const eased = Math.floor(state.from + (state.to - state.from) * t);
      node.textContent = state.format(eased);
      anyActive = true;
    }
  }
  if (anyActive) requestAnimationFrame(tickFigures);
}

export function framesText(n: number): string { return n === 1 ? "1 frame" : `${n} frames`; }
export function stampsText(n: number): string { return n === 1 ? "1 stamp" : `${n} stamps`; }
export function likesText(n: number): string { return n === 1 ? "1 like" : `${n} likes`; }
export function pagesText(n: number): string { return `${n} of 4 pages`; }

// ---------- API ----------

export interface ApiFail { status: number; error: string; message: string }

export class ApiCallError extends Error implements ApiFail {
  readonly error: string;
  constructor(readonly status: number, error: string, message: string) {
    super(message);
    this.error = error;
  }
  get code(): string {
    return this.error;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...opts.headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const fail = parsed as { error: string; message: string } | null;
    throw new ApiCallError(res.status, fail?.error ?? "unknown", fail?.message ?? "Something went wrong.");
  }
  return parsed as T;
}

export function param(p: string): string | null {
  return new URLSearchParams(location.search).get(p);
}

export function setParams(params: Record<string, string>): string {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
