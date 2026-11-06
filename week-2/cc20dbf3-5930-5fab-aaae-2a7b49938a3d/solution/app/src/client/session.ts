// Who is signed in, and the library settings every screen formats with.

import type { LibrarySettings, Role, User } from "../shared/api.js";
import { formatLocalTime, type LibraryCalendar } from "../shared/calendar.js";
import { get } from "./api.js";

let user: User | null = null;
let settings: LibrarySettings | null = null;

export function currentUser(): User | null {
  return user;
}

export function setUser(next: User | null): void {
  user = next;
}

export async function loadLibrary(): Promise<LibrarySettings> {
  settings ??= await get<LibrarySettings>("/api/library");
  return settings;
}

export function library(): LibrarySettings {
  if (!settings) throw new Error("library settings are not loaded");
  return settings;
}

export function calendar(): LibraryCalendar {
  const s = library();
  return { timeZone: s.time_zone, openDays: s.open_days, closedDates: s.closed_dates, closingTime: s.closing_time };
}

export const localTime = (iso: string): string => formatLocalTime(new Date(iso), library().time_zone);

export const isStaff = (role: Role | undefined): boolean => role === "volunteer" || role === "founder";

export function homePath(role: Role): string {
  return role === "member" ? "/catalogue" : "/counter";
}
