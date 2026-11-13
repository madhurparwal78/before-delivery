// The one place the signed-in person, their calendars, settings and the
// address live, with the status region every async result is announced in.

import type { Calendar, EventRecord, FirmSettings, Notice, Person, ZoneRule } from "./api";
import { api } from "./api";
import { today } from "./time";

export type View = "day" | "week" | "month" | "custom" | "schedule";

export type Address = {
  path: string;
  view: View | null;
  date: string | null;
  calendars: string[] | null;
  event: string | null;
  focus: string | null;
  q: string;
  occurrence: string | null;
  token: string;
};

export type AppState = {
  me: Person | null;
  people: Person[];
  calendars: Calendar[];
  settings: FirmSettings | null;
  zoneRules: ZoneRule[];
  notices: Notice[];
  occurrences: EventRecord[];
  windowFrom: string;
  windowTo: string;
  connected: boolean;
  lastSeq: number;
  announcedDecisions: Set<string>;
};

export const state: AppState = {
  me: null,
  people: [],
  calendars: [],
  settings: null,
  zoneRules: [],
  notices: [],
  occurrences: [],
  windowFrom: "",
  windowTo: "",
  connected: true,
  lastSeq: 0,
  announcedDecisions: new Set(),
};

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function changed(): void {
  for (const listener of listeners) listener();
}

let statusNode: HTMLElement | null = null;

/** announce writes one published sentence into status "Wren status". */
export function announce(text: string): void {
  if (!statusNode) statusNode = document.getElementById("status-region");
  if (!statusNode) return;
  statusNode.textContent = "";
  window.setTimeout(() => {
    if (statusNode) statusNode.textContent = text;
  }, 20);
}

/** announceOnce says a decision exactly once on this screen, replays included. */
export function announceOnce(decisionID: string, text: string): void {
  if (!decisionID) {
    announce(text);
    return;
  }
  if (state.announcedDecisions.has(decisionID)) return;
  state.announcedDecisions.add(decisionID);
  announce(text);
}

export function canEditCalendar(id: string): boolean {
  const calendar = state.calendars.find((item) => item.id === id);
  if (!calendar || calendar.id === "cal-holidays") return false;
  return calendar.level === "owner" || calendar.level === "edit" || calendar.level === "manage";
}

export function editableCalendars(): Calendar[] {
  return state.calendars.filter((calendar) => canEditCalendar(calendar.id));
}

export function manageableCalendars(): Calendar[] {
  return state.calendars.filter(
    (calendar) =>
      calendar.id !== "cal-holidays" &&
      (state.me?.role === "office_manager" || calendar.level === "owner" || calendar.level === "manage"),
  );
}

export function defaultCalendars(): string[] {
  return state.calendars.filter((calendar) => calendar.id !== "cal-holidays").map((calendar) => calendar.id);
}

export function viewerZone(): string {
  return state.me?.zone ?? "Europe/London";
}

export function todayHere(): string {
  return today(viewerZone());
}

/** load reads everything a signed-in screen needs. */
export async function loadAccount(): Promise<void> {
  state.me = await api.me();
  const [calendars, notices] = await Promise.all([api.calendars(), api.notices()]);
  state.calendars = calendars.calendars;
  state.notices = notices.notices;
  if (state.me.role !== "guest") {
    try {
      const [people, settings, rules] = await Promise.all([api.people(), api.settings(), api.zoneRules()]);
      state.people = people.people;
      state.settings = settings;
      state.zoneRules = rules.rules;
    } catch {
      // A person without those screens simply has none of that to read.
    }
  }
}

export async function refreshNotices(): Promise<void> {
  state.notices = (await api.notices()).notices;
  changed();
}
