const DEVICE_KEY = "pensight.device";
const RECENT_KEY = "pensight.recentPens";

let device = "DEV-1";
let recent: string[] = [];

export function loadState(): void {
  const stored = window.localStorage.getItem(DEVICE_KEY);
  if (stored) device = stored;
  const chosen = new URL(window.location.href).searchParams.get("device");
  if (chosen) {
    device = chosen;
    window.localStorage.setItem(DEVICE_KEY, chosen);
  }
  const pens = window.localStorage.getItem(RECENT_KEY);
  if (pens) {
    try {
      const parsed = JSON.parse(pens) as unknown;
      if (Array.isArray(parsed)) recent = parsed.filter((id) => typeof id === "string");
    } catch {
      recent = [];
    }
  }
}

export function deviceId(): string {
  return device;
}

/// A browser that has never chosen is the Topside laptop.
export function useDevice(id: string): void {
  device = id;
  window.localStorage.setItem(DEVICE_KEY, id);
}

export function rememberOpenPen(penId: string): void {
  recent = [penId, ...recent.filter((id) => id !== penId)].slice(0, 8);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

/// The open pen is the pen most recently opened in this browser that still
/// exists, or Skarvholmen 01 when none does.
export function openPenId(existing: string[]): string {
  for (const id of recent) {
    if (existing.includes(id)) return id;
  }
  if (existing.includes("skv-01")) return "skv-01";
  return existing[0] ?? "skv-01";
}
