// Shared client core: IST and app-time discipline, money display, the status region
// (order and repeats), the live stream with recovery, and identity polling.
// The browser's clock is never trusted: every time and label arrives from the server.

export interface Catalogue {
  models: { id: string; name: string; cc: number }[];
  finishes: { id: string; name: string; paint: { r: number; g: number; b: number } }[];
  hubs: { id: string; name: string }[];
  chapters: { id: string; name: string; parts: { id: string; name: string }[] }[];
}

export interface Quote {
  stepEffectiveFrom: string;
  exFactoryPaise: number;
  gstPercent: number;
  gstPaise: number;
  exShowroomPaise: number;
  roadTaxPercent: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
}

export interface LockJson {
  id: string;
  state: string;
  hub: string;
  model: string;
  finish: string;
  ref: string;
  issuedAt: string;
  expiresAt: string | null;
  expiresLabel: string | null;
  hoursLeft: number;
  exShowroomPaise: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
  stepEffectiveFrom: string;
  deliveryDate: string | null;
  sheetReady: boolean;
  waitingFor: string | null;
  waitPosition: number | null;
}

export interface RideJson {
  id: string;
  state: string;
  hub: string;
  model: string;
  startsAt: string;
  label: string;
  dayLabel: string;
  cutOffAt: string;
  movedFrom: string | null;
}

export interface LiveReading {
  seq: number;
  hub: string;
  model: string;
  finish: string;
  serverNow: string;
  stale: boolean;
  staleReason: string | null;
  stockAsOf: string;
  stockAsOfLabel: string;
  unitsLeft: number;
  finishes: { finish: string; unitsLeft: number }[];
  quote: Quote;
  nextSlot: { startsAt: string; label: string } | null;
  lockPreview: { expiresAt: string; expiresLabel: string } | null;
  lock: LockJson | null;
  hoursLeft: number;
}

// ---------- money ----------

export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = groupIndian(String(rupees));
  const body = rem === 0 ? grouped : `${grouped}.${rem < 10 ? `0${rem}` : String(rem)}`;
  return `${neg ? "-" : ""}₹${body}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(-3);
  const groups: string[] = [];
  for (let i = head.length; i > 0; i -= 2) {
    groups.unshift(head.slice(Math.max(0, i - 2), i));
  }
  return [...groups, tail].join(",");
}

// ---------- api ----------

export interface ApiFail {
  status: number;
  code: string;
  message: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; fail: ApiFail }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const body = data as { error?: { code?: string; message?: string } } | null;
      return {
        ok: false,
        fail: { status: res.status, code: body?.error?.code ?? "unknown", message: body?.error?.message ?? "" },
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, fail: { status: 0, code: "network", message: "" } };
  }
}

export async function apiJson<T>(path: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; fail: ApiFail }> {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------- the status region ----------
// Strings falling due together are each shown in turn for at least 700 ms, in the
// order session, rider's lock result, hub staleness, price, then any others in the
// order they arrived. A transition whose string equals the current text empties the
// region first, so it is announced again.

type StatusPriority = "session" | "lock-result" | "hub-stale" | "price" | "other";

interface QueueItem {
  text: string;
  priority: StatusPriority;
  minUntil: number;
}

const PRIORITY_ORDER: StatusPriority[] = ["session", "lock-result", "hub-stale", "price", "other"];

class StatusRegion {
  private el: HTMLElement;
  private queue: QueueItem[] = [];
  private current: string | null = null;
  private currentUntil = 0;
  private timer: number | null = null;

  constructor() {
    const found = document.querySelector<HTMLElement>('#status[role="status"]');
    this.el = found ?? document.body;
  }

  announce(text: string, priority: StatusPriority = "other"): void {
    const now = performance.now();
    if (this.current === text) {
      // a transition whose string equals the current text empties the region first,
      // so it is announced again
      this.el.textContent = "";
      this.el.textContent = text;
      this.currentUntil = now + 700;
      return;
    }
    this.queue.push({ text, priority, minUntil: now + 700 });
    this.tick();
  }

  empty(): void {
    this.current = null;
    this.el.textContent = "";
  }

  private tick(): void {
    const now = performance.now();
    if (this.current !== null && now < this.currentUntil) {
      if (this.timer === null) {
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.tick();
        }, this.currentUntil - now);
      }
      return;
    }
    // choose by the published order
    let nextIdx = -1;
    for (const p of PRIORITY_ORDER) {
      const idx = this.queue.findIndex((q) => q.priority === p);
      if (idx >= 0) {
        nextIdx = idx;
        break;
      }
    }
    if (nextIdx < 0) {
      // the queue is empty: the last text stays until a newer transition replaces it
      return;
    }
    const item = this.queue.splice(nextIdx, 1)[0];
    this.el.textContent = item.text;
    this.current = item.text;
    this.currentUntil = item.minUntil;
    if (this.timer === null) {
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.tick();
      }, 700);
    }
  }
}

export const status = new StatusRegion();

// ---------- the live stream and readings ----------

export interface StreamEvents {
  onLive?: (reading: LiveReading) => void;
  onMine?: () => void;
  onSession?: (state: "ended" | "signed_out") => void;
}

export class LiveClient {
  private es: EventSource | null = null;
  private events: StreamEvents;
  private query: string;
  private pollTimer: number | null = null;
  private lastPing = 0;
  private silenceTimer: number | null = null;
  private closed = false;

  constructor(query: string, events: StreamEvents) {
    this.query = query;
    this.events = events;
    this.open();
  }

  setQuery(query: string): void {
    if (query === this.query) return;
    this.query = query;
    this.reopen();
  }

  private open(): void {
    if (this.closed) return;
    try {
      this.es?.close();
    } catch {
      /* already closed */
    }
    const es = new EventSource(`/api/live${this.query}`);
    this.es = es;
    this.lastPing = performance.now();
    es.addEventListener("live", (ev) => {
      try {
        const reading = JSON.parse((ev as MessageEvent).data) as LiveReading;
        this.events.onLive?.(reading);
      } catch {
        /* ignore a malformed hint body */
      }
    });
    es.addEventListener("mine", () => {
      this.events.onMine?.();
    });
    es.addEventListener("session", (ev) => {
      try {
        const body = JSON.parse((ev as MessageEvent).data) as { state?: string };
        if (body.state === "ended" || body.state === "signed_out") {
          this.events.onSession?.(body.state);
        }
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("ping", () => {
      this.lastPing = performance.now();
    });
    es.onerror = () => {
      // the page keeps re-opening the stream and keeps reading in the meantime
      this.recover();
    };
    // A stream silent for 35 seconds counts as ended, even with no connection error.
    this.armSilence();
  }

  private armSilence(): void {
    if (this.silenceTimer !== null) window.clearInterval(this.silenceTimer);
    this.silenceTimer = window.setInterval(() => {
      if (performance.now() - this.lastPing > 35000) {
        this.recover();
      }
    }, 5000);
  }

  private recover(): void {
    try {
      this.es?.close();
    } catch {
      /* ignore */
    }
    this.es = null;
    if (this.pollTimer === null) {
      this.pollTimer = window.setInterval(() => {
        void this.readNow();
      }, 5000);
      void this.readNow();
    }
    // re-open within 5 seconds
    window.setTimeout(() => {
      if (!this.closed) this.open();
    }, 5000);
  }

  private async readNow(): Promise<void> {
    const res = await api<LiveReading>(`/api/live/now${this.query}`);
    if (res.ok) this.events.onLive?.(res.data);
  }

  reopen(): void {
    this.open();
  }

  close(): void {
    this.closed = true;
    try {
      this.es?.close();
    } catch {
      /* ignore */
    }
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    if (this.silenceTimer !== null) window.clearInterval(this.silenceTimer);
  }
}

// ---------- identity across tabs ----------

export interface Me {
  user: { id: string; role: string; name: string; mobile: string; hub: string | null; licenceNumber: string | null; licenceValidUntil: string | null; remindersOn: boolean } | null;
  signedIn: boolean;
}

export async function readMe(): Promise<Me> {
  const res = await api<{ user: Me["user"] }>("/api/me");
  if (res.ok) return { user: res.data.user, signedIn: true };
  return { user: null, signedIn: false };
}

// Poll /api/me at least every 1.5 seconds so a sign-in or sign-out in one tab
// reaches every other tab within the published limit.
export function pollIdentity(onChange: (me: Me) => void): () => void {
  let last: Me | null = null;
  const timer = window.setInterval(async () => {
    const me = await readMe();
    if (last === null || me.signedIn !== last.signedIn || me.user?.id !== last.user?.id) {
      last = me;
      onChange(me);
    }
  }, 1500);
  onChange = onChange;
  void (async () => {
    last = await readMe();
    onChange(last);
  })();
  return () => window.clearInterval(timer);
}

// ---------- URL writing ----------

// The URL is rewritten without adding history entries, at most once every 200 ms.
let lastUrlWrite = 0;
let pendingUrl: string | null = null;
let urlTimer: number | null = null;

export function replaceUrl(path: string): void {
  const now = performance.now();
  if (now - lastUrlWrite >= 200) {
    lastUrlWrite = now;
    try {
      history.replaceState(null, "", path);
    } catch {
      /* ignore */
    }
    if (urlTimer !== null) {
      window.clearTimeout(urlTimer);
      urlTimer = null;
      pendingUrl = null;
    }
  } else {
    pendingUrl = path;
    if (urlTimer === null) {
      const wait = 200 - (now - lastUrlWrite);
      urlTimer = window.setTimeout(() => {
        urlTimer = null;
        if (pendingUrl !== null) {
          const p = pendingUrl;
          pendingUrl = null;
          lastUrlWrite = performance.now();
          try {
            history.replaceState(null, "", p);
          } catch {
            /* ignore */
          }
        }
      }, wait);
    }
  }
}

// ---------- small helpers ----------

export function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

export function maybe<T extends Element>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel) ?? null;
}

// IST hh:mm from a server ISO time; never from the device clock.
export function istHm(iso: string): string {
  // server times carry +05:30; the string already holds IST digits
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function istDateOf(iso: string): string {
  return iso.slice(0, 10);
}
