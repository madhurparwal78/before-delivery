// Shared helpers: boot data, API calls, formatting and the screen-reader status region.

interface Registration {
  id: string;
  role: string;
  status: string;
  paddle: number | null;
  spending_limit: number | null;
}

interface Me {
  name: string;
  roles: string[];
  registration: Registration | null;
}

interface Boot {
  status: number;
  page: string;
  me: Me | null;
}

export interface Offer {
  id: string;
  lot_id: string;
  lot_number: number;
  title: string;
  kind: string;
  amount: number;
  expires_at: string;
  status: string;
}

export interface Lot {
  id: string;
  sale_id: string | null;
  lot_number: number | null;
  title: string;
  category: string;
  description: string;
  condition: string;
  portrait: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
  opening_bid: number | null;
  price: number | null;
  asking?: number | null;
  bid_count: number;
  leader_paddle?: number | null;
  reserve_met: boolean;
  status?: string;
  closes_at: string | null;
  remaining_seconds: number;
  server_now: string;
  my_max?: number | null;
  i_lead?: boolean;
  watching?: boolean;
  reserve?: number | null;
  state?: string;
  hammer?: number | null;
  second_chance_open?: boolean;
  offer?: Offer | null;
  consignor_name?: string;
  /** performance.now() when the server sent this lot; the countdown runs from here. */
  at: number;
}

export interface HistoryRow {
  paddle?: number | null;
  price_after: number;
  accepted_at: string;
  bid_id?: string;
  bidder_name?: string;
  max_amount?: number;
}

export interface Notice {
  id: string;
  kind: string;
  text: string;
  lot_id: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  title: string;
  ends_at: string;
  state: string;
  first_lot_number: number;
}

export const boot: Boot = JSON.parse(document.getElementById("boot")?.textContent ?? '{"status":200,"page":"app","me":null}');

export function hasRole(role: string): boolean {
  return boot.me?.roles.includes(role) ?? false;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const UNEXPECTED = "Something went wrong in the saleroom. Try again.";

interface CallOptions {
  method?: string;
  body?: unknown;
  key?: string;
  timeoutMs?: number;
}

/** api calls the JSON API; failures throw an ApiError (status 0 when no response arrived). */
export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  const controller = new AbortController();
  const timer = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "no_response", UNEXPECTED, {}, {});
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(data.error ?? "error"),
      String(data.message ?? UNEXPECTED),
      (data.fields as Record<string, string>) ?? {},
      data,
    );
  }
  return data as T;
}

export function errorText(e: unknown): string {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 ? e.message : UNEXPECTED;
}

/** stamp marks a lot with the moment it arrived, for the countdown. */
export function stamp(lot: Omit<Lot, "at"> | Lot): Lot {
  const raw = lot as Lot;
  // A consignor sees their own lots in the consignor projection, which carries the full state instead of the public status.
  const status = raw.status ?? (raw.state === "open" || raw.state === "extended" ? raw.state : raw.reserve_met ? "closed_sold" : "closed_unsold");
  return { ...raw, status, at: performance.now() };
}

export function commas(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function euros(n: number | null | undefined): string {
  return "€" + commas(n ?? 0);
}

/** amount turns the API's "1628.13" into "€1,628.13". */
export function amount(decimal: string): string {
  const [whole = "0", cents = "00"] = decimal.split(".");
  return `€${commas(Number(whole))}.${cents}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const amsterdam = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

function amsterdamParts(ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of amsterdam.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** rotterdam renders a server time as "12 Nov 2026, 20:14:30" in Rotterdam local time. */
export function rotterdam(iso: string): string {
  const p = amsterdamParts(Date.parse(iso));
  return `${p.day} ${MONTHS[(p.month ?? 1) - 1]} ${p.year}, ${two(p.hour ?? 0)}:${two(p.minute ?? 0)}:${two(p.second ?? 0)}`;
}

/** rotterdamToIso reads "YYYY-MM-DD HH:MM" as Rotterdam local time; null when it is not a real date and time. */
export function rotterdamToIso(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) return null;
  const offset = (utc: number): number => {
    const p = amsterdamParts(utc);
    return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0) - utc;
  };
  const guess = probe.getTime();
  const settled = guess - offset(guess - offset(guess));
  return new Date(settled).toISOString();
}

/** timeLeft is "<d>d <hh>:<mm>:<ss>", "<hh>:<mm>:<ss>" or "<m>:<ss>". */
export function timeLeft(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (days >= 1) return `${days}d ${two(hours)}:${two(minutes)}:${two(seconds)}`;
  if (hours >= 1) return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  return `${minutes}:${two(seconds)}`;
}

/** secondsLeft counts down from the server's remaining seconds using time elapsed on this page. */
export function secondsLeft(lot: Lot): number {
  return Math.max(0, lot.remaining_seconds - Math.floor((performance.now() - lot.at) / 1000));
}

export function isRunning(lot: Pick<Lot, "status">): boolean {
  return lot.status === "open" || lot.status === "extended";
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** announce adds one sentence to the polite "Saleroom updates" region. */
export function announce(text: string): void {
  const region = document.getElementById("saleroom-updates");
  if (!region || !text) return;
  const line = document.createElement("p");
  line.textContent = text;
  region.appendChild(line);
  while (region.childElementCount > 12) region.firstElementChild?.remove();
}

export const STATE_LABELS: Record<string, string> = {
  intake: "Intake",
  estimated: "Estimated",
  placed: "In sale",
  open: "Open",
  extended: "Extended",
  closed_sold: "Sold",
  closed_unsold: "Unsold",
  second_chance_offered: "Second chance offered",
  sold_by_offer: "Sold by offer",
  offer_lapsed: "Offer lapsed",
  invoiced: "Invoiced",
  paid: "Paid",
  defaulted: "Defaulted",
  underbidder_offered: "Offered to underbidder",
};

export function go(path: string): void {
  window.location.assign(path);
}
