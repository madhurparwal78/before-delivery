/** Formats remaining milliseconds as a Fuse Clock numeral. */
export function formatFuse(ms: number): string {
  const whole = Math.max(0, ms);
  if (whole < 60_000) return (Math.floor(whole / 100) / 10).toFixed(1);
  const seconds = Math.floor(whole / 1000);
  if (whole < 3_600_000) return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  if (whole < 86_400_000) return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  const days = Math.floor(seconds / 86_400);
  return `${days}d ${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}`;
}

/** The counting-up Lap timer: m:ss.d */
export function formatLapRunning(ms: number): string {
  const whole = Math.max(0, ms);
  return `${Math.floor(whole / 60_000)}:${pad(Math.floor(whole / 1000) % 60)}.${Math.floor((whole % 1000) / 100)}`;
}

/** A finished lap: m:ss.mmm */
export function formatLap(ms: number): string {
  return `${Math.floor(ms / 60_000)}:${pad(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface Parts {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
  zone: string;
}

function partsIn(instant: string | Date, zone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(typeof instant === "string" ? new Date(instant) : instant)) out[part.type] = part.value;
  return { weekday: out.weekday, day: out.day, month: out.month, year: out.year, hour: out.hour, minute: out.minute, zone: out.timeZoneName };
}

export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** `Ddd D Mon` in a zone. */
export function dayMonth(instant: string, zone: string): string {
  const p = partsIn(instant, zone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** `HH:MM <abbr>` in a zone. */
export function clockAbbr(instant: string, zone: string): string {
  const p = partsIn(instant, zone);
  return `${p.hour}:${p.minute} ${p.zone}`;
}

/** `Ddd D Mon HH:MM <abbr>` in a zone. */
export function stamp(instant: string, zone: string): string {
  return `${dayMonth(instant, zone)} ${clockAbbr(instant, zone)}`;
}

export function zoneAbbr(instant: string, zone: string): string {
  return partsIn(instant, zone).zone;
}

/** `Ddd D Mon YYYY` for a studio date (YYYY-MM-DD). */
export function dateHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const p = partsIn(new Date(Date.UTC(y, m - 1, d, 12)), "UTC");
  return `${p.weekday} ${d} ${p.month} ${y}`;
}

export function studioDayYear(instant: string, zone: string): string {
  const p = partsIn(instant, zone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** A key's label from its keyboard `code`. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}

export const ACTIONS: { id: string; label: string }[] = [
  { id: "move_up", label: "Move up" },
  { id: "move_down", label: "Move down" },
  { id: "move_left", label: "Move left" },
  { id: "move_right", label: "Move right" },
  { id: "aim_left", label: "Aim left" },
  { id: "aim_right", label: "Aim right" },
  { id: "fire", label: "Fire" },
  { id: "reload", label: "Reload" },
  { id: "grenade", label: "Grenade" },
  { id: "revive", label: "Revive" },
  { id: "shop", label: "Shop" },
  { id: "timers", label: "Timers" },
];

export const DEFAULT_BINDINGS: Record<string, string> = {
  move_up: "KeyW", move_down: "KeyS", move_left: "KeyA", move_right: "KeyD", aim_left: "KeyQ", aim_right: "KeyE",
  fire: "Space", reload: "KeyR", grenade: "KeyG", revive: "KeyF", shop: "KeyB", timers: "KeyT",
};

