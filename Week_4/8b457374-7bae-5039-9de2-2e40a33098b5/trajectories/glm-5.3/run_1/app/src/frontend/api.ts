// Frontend helpers: money formatting, keyboard helpers and the API wrapper.

export interface ApiErrorShape {
  error: string;
  fields?: Record<string, string>;
}

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const key = loadKey();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (key !== null) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  const response = await fetch(input, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body =
    contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body };
}

export function loadKey(): string | null {
  return window.localStorage.getItem("dotgain_key");
}

export function storeKey(key: string): void {
  window.localStorage.setItem("dotgain_key", key);
}

export function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  const poundsText = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-£" : "£"}${poundsText}.${rest.toString().padStart(2, "0")}`;
}

export function parsePoundsField(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cleaned = t.replace(/,/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  if (!/^\d+$/.test(whole)) return null;
  if (fraction !== "" && !/^\d{1,2}$/.test(fraction)) return null;
  const wholePence = Number(whole) * 100;
  const fractionPence = fraction === "" ? 0 : Number(fraction.padEnd(2, "0"));
  return wholePence + fractionPence;
}

/** Countdown format: <D> days <HH>:<MM>:<SS> or <HH>:<MM>:<SS>. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const hhmmss = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (days >= 1) {
    return `${days} ${days === 1 ? "day" : "days"} ${hhmmss}`;
  }
  return hhmmss;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** A server-anchored countdown: starts from secondsLeft and ticks by elapsed time. */
export class ServerCountdown {
  private readonly anchor: number;

  constructor(secondsLeft: number) {
    this.anchor = Date.now() + secondsLeft * 1000;
  }

  secondsLeft(): number {
    return Math.max(0, Math.floor((this.anchor - Date.now()) / 1000));
  }

  expired(): boolean {
    return this.secondsLeft() <= 0;
  }
}

export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AT", name: "Austria" },
  { code: "AU", name: "Australia" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "CH", name: "Switzerland" },
  { code: "DE", name: "Germany" },
  { code: "DK", name: "Denmark" },
  { code: "ES", name: "Spain" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "SE", name: "Sweden" },
  { code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },
];

export function countriesSorted(): ReadonlyArray<{ code: string; name: string }> {
  return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
}

export const ZONE_NAMES: Record<string, string> = {
  domestic: "Domestic",
  europe: "Europe",
  rest_of_world: "Rest of world",
};

export const STATE_WORDS: Record<string, string> = {
  authorising: "Holding",
  authorised: "Held",
  captured: "Charged",
  errored: "Needs fixing",
  voided: "Released",
  dropped: "Dropped",
};

/** Service notice copy, keyed by the status endpoint's names. */
export const SERVICE_BANNERS: Record<string, string> = {
  payments: "Payments are unavailable. New pledges and changes are paused; held cards are safe.",
  email: "Email is delayed. Notices are queued and will be sent when the mail service is back.",
  storage: "Media storage is unavailable. Uploads and statements are paused.",
  documents: "Statements are delayed. They will appear once they are rendered.",
};

export interface ServiceStatus {
  payments: "up" | "down";
  email: "up" | "down";
  storage: "up" | "down";
  documents: "up" | "down";
}

export async function fetchServiceStatus(): Promise<ServiceStatus | null> {
  try {
    const { body } = await apiFetch("/api/status");
    return body as ServiceStatus;
  } catch {
    return null;
  }
}

/** Renders the outage banners into the page's service notice region. */
export async function renderServiceBanners(): Promise<void> {
  const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Service notice"]');
  if (region === null) return;
  const status = await fetchServiceStatus();
  if (status === null) {
    region.innerHTML = "";
    return;
  }
  const banners: string[] = [];
  for (const [service, state] of Object.entries(status)) {
    if (state === "down") {
      banners.push(SERVICE_BANNERS[service] ?? "");
    }
  }
  region.innerHTML = banners.map((text) => `<div class="banner" role="note">${text}</div>`).join("");
}

/** The 30-second refresh for banners on every page. */
export function startBannerRefresh(): void {
  renderServiceBanners().catch(() => undefined);
  window.setInterval(() => {
    renderServiceBanners().catch(() => undefined);
  }, 15000);
}

/** Mounts the shared header into the page's header element. */
export function mountHeader(active: string): void {
  const element = document.querySelector<HTMLElement>("[data-header]");
  if (element !== null) {
    element.innerHTML = headerMarkup(active);
  }
}

/** The shared header markup. */
export function headerMarkup(active: string): string {
  const link = (href: string, label: string) =>
    `<a href="${href}"${active === label ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
    <a class="wordmark" href="/" aria-label="Dotgain">DOTGAIN</a>
    <nav class="site-nav" aria-label="Site">
      ${link("/campaigns", "Campaigns")}
      ${link("/pledges", "My pledges")}
      ${link("/studio", "Studio")}
    </nav>`;
}

/** The loading indicator markup for a status region. */
export function loadingMarkup(): string {
  return `
    <div class="loading" role="status" aria-label="Loading">
      <span class="dots">
        <span class="dot" style="--delay:0s"></span>
        <span class="dot" style="--delay:0.2s; width:20px; height:20px; margin:-10px; opacity:0.5"></span>
        <span class="dot" style="--delay:0.4s; width:28px; height:28px; margin:-14px; opacity:0.3"></span>
      </span>
      Loading
    </div>`;
}
