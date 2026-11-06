// Shared client utilities: fetch wrapper with one error shape, time display in Central time.

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export class ApiCallError extends Error {
  code: string;
  fields: Record<string, string>;
  status: number;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? "Couldn't reach Teamseat.");
    this.status = status;
    this.code = body?.error?.code ?? "network";
    this.fields = body?.error?.fields ?? {};
  }
}

export async function api<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    credentials: "same-origin",
  };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiCallError(0, null);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new ApiCallError(res.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

// ── Central-time formatting (mirrors the shared server module) ───────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsCentral(date: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: p.hour === "24" ? 0 : Number(p.hour),
    minute: Number(p.minute),
    weekday: DAYS.indexOf(p.weekday),
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function parseInstant(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(input)) return null;
  const normalised = (input.length === 16 ? input + ":00" : input).replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalised);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Central local date+time (minutes after midnight) → instant. */
export function centralToInstant(dateISO: string, minutes: number): Date {
  const naive = Date.parse(`${dateISO}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00Z`);
  for (const off of [360, 300]) {
    const guess = new Date(naive + off * 60000);
    const p = partsCentral(guess);
    if (p.hour * 60 + p.minute === minutes && centralDateISO(guess) === dateISO) return guess;
  }
  return new Date(NaN);
}

export function centralDateISO(date: Date): string {
  const p = partsCentral(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function centralMinutesOfDay(date: Date): number {
  const p = partsCentral(date);
  return p.hour * 60 + p.minute;
}

export function formatDayShort(date: Date): string {
  const p = partsCentral(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

export function formatDayLong(date: Date): string {
  const p = partsCentral(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function formatTimeHM(date: Date): string {
  const p = partsCentral(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatRange(start: Date, end: Date): string {
  return `${formatDayShort(start)} ${formatTimeHM(start)}–${formatTimeHM(end)}`;
}

export function formatHMM(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function formatHoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} m`;
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100).toLocaleString("en-US")}.${pad(a % 100)}`;
}

export function todayCentralISO(): string {
  return centralDateISO(new Date());
}

/** Monday (Central) of the week containing `date`, as YYYY-MM-DD. */
export function centralWeekStartISO(date: Date): string {
  const p = partsCentral(date);
  const dayOffset = p.weekday === 0 ? 6 : p.weekday - 1;
  const naive = Date.parse(`${centralDateISO(date)}T00:00:00Z`) - dayOffset * 86_400_000;
  return new Date(naive).toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const naive = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(naive).toISOString().slice(0, 10);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.setAttribute("class", String(value));
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function svg(paths: string[], viewBox = "0 0 16 16"): SVGSVGElement {
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", viewBox);
  svgEl.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "currentColor");
    svgEl.append(p);
  }
  return svgEl;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
