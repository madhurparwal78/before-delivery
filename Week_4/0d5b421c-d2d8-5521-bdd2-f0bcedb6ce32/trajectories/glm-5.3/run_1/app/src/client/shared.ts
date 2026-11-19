/** Shared client-side helpers. The browser talks only to the app's own origin. */

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export class ApiFailure {
  constructor(readonly status: number, readonly body: ApiErrorBody | null) {}
  get code(): string | null { return this.body?.error.code ?? null; }
  get fields(): Record<string, string> { return this.body?.error.fields ?? {}; }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, body as ApiErrorBody | null);
  }
  return body as T;
}

/** Format seconds as M:SS. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Format integer cents as euros with two decimals and a dot. */
export function euro(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `<Ddd> <D> <Mon>` of an instant in Lisbon. */
export function lisbonDayStamp(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short",
  }).format(instant);
}

/** Lisbon HH:MM of an instant. */
export function lisbonTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
}

/** Today's date in Lisbon as YYYY-MM-DD. */
export function lisbonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** The guest's own time zone name, or null when it equals Lisbon. */
export function localTimeZone(): string | null {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  return tz === "Europe/Lisbon" ? null : tz;
}

/** `<local HH:MM> your time` suffix parts for a slot instant. */
export function localTimeParts(instant: Date, tz: string): { time: string; dayDiffers: boolean } {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant);
  const get = (t: string): string => local.find((p) => p.type === t)?.value ?? "";
  const lisbon = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", day: "numeric", month: "short",
  }).format(instant);
  const localDay = `${get("day")} ${get("month")}`;
  const dayDiffers = localDay.trim() !== lisbon.trim();
  return { time: `${get("hour").padStart(2, "0")}:${get("minute")}`, dayDiffers };
}

export interface StatusResponse {
  server_now: string;
  holds: "ok" | "paused";
  deposits: "ok" | "paused";
}

/** The server clock offset: device now minus server now. */
export class ServerClock {
  private offsetMs = 0;
  private known = false;

  sync(serverNow: string): void {
    this.offsetMs = new Date(serverNow).getTime() - Date.now();
    this.known = true;
  }

  get synced(): boolean { return this.known; }

  /** The server's now, estimated on the device clock. */
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
}

/** Status polling with outage banners: on load and every 30 seconds. */
export function watchStatus(onChange: (s: StatusResponse) => void): void {
  const tick = async () => {
    try {
      const s = await apiJson<StatusResponse>("/api/status");
      onChange(s);
    } catch { /* keep last state */ }
  };
  void tick();
  setInterval(tick, 30_000);
}

const HOLD_BANNER = "Table holds are paused. Please try again in a few minutes.";
const DEPOSIT_BANNER = "Deposits are paused. Bookings that need a deposit can't be confirmed right now.";
const LIVE_BANNER = "Live updates are paused. The plan refreshes every 30 seconds.";

export function renderBanners(
  slot: HTMLElement, s: { holds: "ok" | "paused"; deposits: "ok" | "paused" },
  isHost: boolean,
): void {
  const banners: string[] = [];
  if (s.holds === "paused") banners.push(HOLD_BANNER);
  if (s.deposits === "paused") banners.push(DEPOSIT_BANNER);
  if (isHost && s.holds === "paused") banners.push(LIVE_BANNER);
  const html = banners.map((b) => `<div class="banner" role="alert">${escapeHtml(b)}</div>`).join("");
  if (slot.innerHTML !== html) slot.innerHTML = html;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Manage/offer "dead link" line. */
export const DEAD_LINK = "This booking link no longer works.";

export interface FloorResponse {
  rooms: { room_id: string; name: string; seats: number; tables: { table_id: string; min_seats: number; max_seats: number }[] }[];
  joinable_pairs: { pair_id: string; tables: string[]; min_seats: number; max_seats: number }[];
}

/** Focus trap for dialogs: Tab and Shift+Tab stay inside, Escape closes when not pending. */
export function trapFocus(
  overlay: HTMLElement, onEscape: () => void, initially: HTMLElement,
): () => void {
  const selectable = (): HTMLElement[] =>
    Array.from(overlay.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    )).filter((el) => el.offsetParent !== null || el === document.activeElement);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key === "Tab") {
      const items = selectable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !overlay.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !overlay.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  overlay.addEventListener("keydown", onKeyDown);
  initially.focus();

  return () => {
    overlay.removeEventListener("keydown", onKeyDown);
  };
}

/** Random idempotency key. */
export function idemKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Open an SSE stream with reconnection, replaying from the last id. */
export function openEvents(
  path: string, onEvent: (data: Record<string, unknown>) => void, onDown?: () => void,
): () => void {
  let stopped = false;
  let es: EventSource | null = null;

  const connect = () => {
    if (stopped) return;
    es = new EventSource(path);
    es.onmessage = (ev) => {
      const raw = ev.data;
      if (typeof raw !== "string" || raw === "") return;
      try {
        onEvent(JSON.parse(raw) as Record<string, unknown>);
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      es?.close();
      if (onDown) onDown();
      // Reconnect within two seconds, replaying from the last id via Last-Event-ID.
      setTimeout(connect, 1500);
    };
  };
  connect();

  return () => {
    stopped = true;
    es?.close();
  };
}
