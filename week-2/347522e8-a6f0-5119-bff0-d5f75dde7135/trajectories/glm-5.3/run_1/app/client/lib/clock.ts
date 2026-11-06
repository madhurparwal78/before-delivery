// Shared kitchen-clock helpers for the browser. Every value that depends on
// the clock or the calendar is computed from the server's data; the device's
// own clock and zone are never used (DP-54).

import { hoursDisplay, minutesToHHMM } from "../../shared/hourPrice.js";

export type ServerClock = {
  date: string;
  serverNowMs: number;
  minutesNow: number;
  zone: string;
};

export const parseServerNow = (date: string, isoNow: string): ServerClock => {
  // The server reports a date plus a UTC instant; the local minutes are
  // derived by an exact arithmetic offset so no local parsing is involved.
  const nowMs = Date.parse(isoNow);
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  const minutesNow = Math.floor((nowMs - midnightUtc) / 60000);
  return { date, serverNowMs: nowMs, minutesNow, zone: "" };
};

export const hhmm = minutesToHHMM;

export const hhmmToMinutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m % 15 !== 0) return null;
  if (h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
};

export const hours = hoursDisplay;

export const weekdayName = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T00:00:00Z`));

export const monthName = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(new Date(`${date}T00:00:00Z`));

export const dayOfMonth = (date: string): string => String(Number(date.slice(8, 10)));

export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

export const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
};

export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const countdownText = (msLeft: number): string => {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

export const minutesLeftText = (msLeft: number): string => `${Math.max(1, Math.ceil(msLeft / 60000))} min left`;
