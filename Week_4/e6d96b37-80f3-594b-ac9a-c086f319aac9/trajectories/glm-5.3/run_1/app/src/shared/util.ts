export function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", new Uint8Array(bytes)).then((buf) => {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

export function randomToken(prefix: string, bytes = 24): Promise<string> {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let s = "";
  for (const b of arr) {
    s += b.toString(16).padStart(2, "0");
  }
  return Promise.resolve(`${prefix}${s}`);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function commandIdValid(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 64;
}

export function expectedVersionValid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function referenceValid(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{1,80}$/.test(v);
}

export function namespaceValid(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 64 && /^[a-z0-9-]+$/.test(v);
}

export function userPerceivedLength(s: string): number {
  return [...s].length;
}

export const SPECIMEN_STATUSES = [
  "intake",
  "pending_catalogue",
  "attributed",
  "quarantined",
  "shelved",
  "reserved",
  "outbound",
  "transferred",
  "missing",
] as const;

export const OFFER_STATUSES = [
  "draft",
  "sent",
  "countered",
  "accepted",
  "dispatched",
  "received",
  "disputed",
  "transferred",
  "returned",
  "expired",
] as const;

export const TRAY_CELLS = ["A1", "A2", "B1", "B2"] as const;
export type TrayCellKey = (typeof TRAY_CELLS)[number];
export const TRAY_CELL_MM = 60;
