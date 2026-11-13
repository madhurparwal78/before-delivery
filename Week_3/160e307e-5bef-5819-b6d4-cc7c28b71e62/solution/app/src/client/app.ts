import { ApiFail, get } from "./api";
import { byId, setText } from "./dom";

/** Shared client state: the signed-in player, the server's configuration, the database outage flag. */

interface Me {
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

interface Config {
  verdictBannerMs: number;
  shotTimerSeconds: number;
  reconnectSeconds: number;
  rematchSeconds: number;
  roomExpirySeconds: number;
  bandWidenSeconds: number;
  modelVersion: string;
}

export const app: { me: Me | null; config: Config | null; outage: boolean; focusHeading: boolean } = {
  me: null,
  config: null,
  outage: false,
  focusHeading: false,
};

const OUTAGE_COPY = "Online play is unavailable right now. Pass and play still works.";
const CHECK_EVERY_MS = 10000;
const STATUS_CLEAR_MS = 4000;
let statusTimer: number | undefined;

export async function loadMe(): Promise<Me | null> {
  try {
    app.me = await get<Me>("/api/me");
  } catch (error) {
    if (!(error instanceof ApiFail)) throw error;
    app.me = null;
  }
  return app.me;
}

/** Page-level confirmations. A lasting condition stays; a passing one clears itself. */
export function pageStatus(text: string, lasting = false): void {
  const strip = byId("page-status");
  window.clearTimeout(statusTimer);
  setText(strip, text);
  if (text && !lasting) statusTimer = window.setTimeout(() => setText(strip, ""), STATUS_CLEAR_MS);
}

type OutageListener = (outage: boolean) => void;
const listeners = new Set<OutageListener>();

export function onOutage(listener: OutageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function checkHealth(): Promise<void> {
  let outage = true;
  try {
    outage = (await get<{ status: string }>("/api/health")).status !== "ok";
  } catch {
    outage = true;
  }
  if (outage === app.outage && byId("outage-banner").textContent === (outage ? OUTAGE_COPY : "")) return;
  app.outage = outage;
  setText(byId("outage-banner"), outage ? OUTAGE_COPY : "");
  document.body.classList.toggle("outage", outage);
  for (const listener of listeners) listener(outage);
}

export async function startHealthWatch(): Promise<void> {
  const banner = byId("outage-banner");
  new ResizeObserver(() => document.documentElement.style.setProperty("--chrome", `${banner.offsetHeight}px`)).observe(banner);
  await checkHealth();
  window.setInterval(() => void checkHealth(), CHECK_EVERY_MS);
}

export async function loadConfig(): Promise<void> {
  app.config = await get<Config>("/api/config");
}
