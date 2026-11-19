import { api, ApiError } from "./api";
import { byId, clear, h } from "./dom";
import { DEFAULT_BINDINGS } from "./format";
import type { Player, ServiceStatus, Settings } from "./types";

type Listener = (data?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

export function on(topic: string, fn: Listener): () => void {
  const set = listeners.get(topic) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(topic, set);
  return () => set.delete(fn);
}

export function emit(topic: string, data?: unknown): void {
  for (const fn of listeners.get(topic) ?? []) fn(data);
}

export const NOTICE_KEY = "hf.notice";
const SETTINGS_KEY = "hf.settings";

export const app = {
  session: null as Player | null,
  settings: loadLocalSettings(),
  studioZone: "UTC",
  status: null as ServiceStatus | null,
};

function defaultSettings(): Settings {
  return { bindings: { ...DEFAULT_BINDINGS }, master_volume: 80, effects_volume: 80, reduce_effects: false, screen_shake: true, camera_bob: true };
}

function loadLocalSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
  return defaultSettings();
}

const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Reduced effects: the system asks for reduced motion or the player turned Reduce effects on. */
export function isReduced(): boolean {
  return systemReduced.matches || app.settings.reduce_effects;
}

export function applyComfort(): void {
  document.documentElement.classList.toggle("reduced", isReduced());
  emit("comfort");
}

systemReduced.addEventListener("change", applyComfort);

/** Replaces the notices line with the brief's exact copy. */
export function notify(text: string): void {
  const region = byId("notices");
  region.textContent = text;
  region.classList.toggle("has-text", text !== "");
}

function setSettings(next: Settings): void {
  app.settings = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  applyComfort();
}

/** Saves settings locally and, when signed in, to the server. */
export async function saveSettings(next: Settings, announce = true): Promise<void> {
  setSettings(next);
  if (!app.session) {
    if (announce) notify("Settings saved.");
    return;
  }
  try {
    await api<Settings>("PUT", "/api/me/settings", next);
    if (announce) notify("Settings saved.");
  } catch (error) {
    if (error instanceof ApiError && error.status >= 500) notify("Something went wrong on the server. Try again.");
  }
}

/** After sign-in the server's settings are the truth, except a stored Calm choice. */
export async function syncSettingsAfterSignIn(): Promise<void> {
  try {
    const stored = await api<Settings>("GET", "/api/me/settings");
    const calm = localStorage.getItem(NOTICE_KEY) === "calm";
    setSettings({ ...stored, reduce_effects: stored.reduce_effects || calm });
    if (calm && !stored.reduce_effects) await api<Settings>("PUT", "/api/me/settings", app.settings);
  } catch {
    applyComfort();
  }
}

const BANNER_LINES: [keyof ServiceStatus["services"], string][] = [
  ["valkey", "Rooms offline — the room registry is reconnecting. Nights and sign-ups still work."],
  ["mail", "Mail delayed — emails are queued and send when mail is back."],
  ["postgres", "Storage offline — sign-ups, prices, settings and history are unavailable."],
];

function renderBanner(status: ServiceStatus): void {
  const banner = byId("service-banner");
  clear(banner);
  for (const [service, copy] of BANNER_LINES) if (status.services[service] === "down") banner.append(h("p", {}, copy));
  banner.classList.toggle("has-text", banner.childElementCount > 0);
  byId("app").style.setProperty("--top-inset", banner.childElementCount > 0 ? `${banner.offsetHeight}px` : "0px");
}

export async function refreshStatus(): Promise<void> {
  try {
    app.status = await api<ServiceStatus>("GET", "/api/status");
  } catch {
    return;
  }
  byId("stamp").textContent = `build ${app.status.build} · ${app.status.tick_hz} Hz`;
  renderBanner(app.status);
  emit("status", app.status);
}

const SIGNED_KEY = "hf.signed";

/** Remembers that this browser holds a session cookie, so a first visit makes no pointless /api/me request. */
export function rememberSession(): void {
  localStorage.setItem(SIGNED_KEY, "1");
}

export async function loadSession(): Promise<void> {
  if (localStorage.getItem(SIGNED_KEY) !== null) {
    try {
      const me = await api<{ player: Player }>("GET", "/api/me");
      app.session = me.player;
      await syncSettingsAfterSignIn();
    } catch {
      app.session = null;
      localStorage.removeItem(SIGNED_KEY);
    }
  }
  try {
    app.studioZone = (await api<{ zone: string }>("GET", "/api/studio")).zone;
  } catch {
    return;
  }
}

export function isFounder(): boolean {
  return app.session?.role === "founder";
}
