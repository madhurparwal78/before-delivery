// state.ts — the client state shared by every screen, kept in one place.

import { api, Person, Calendar, Occurrence, ZoneRule } from "./api";

export type View = "day" | "week" | "month" | "custom" | "schedule";

export interface LiveMessage {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

export class State {
  me: Person | null = null;
  calendars: Calendar[] = [];
  people: { id: string; name: string; zone: string; city: string }[] = [];
  zoneRules: ZoneRule[] = [];
  serverNow: string = "";
  occurrenceCache: Map<string, Occurrence> = new Map();
  lastSeq = 0;
  socket: WebSocket | null = null;
  reconnecting = false;
  listeners: Set<() => void> = new Set();
  liveHandlers: ((m: LiveMessage) => void)[] = [];
  unreadNotices = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  async refreshNow(): Promise<void> {
    try {
      const { data } = await api.time();
      this.serverNow = data.now_utc;
    } catch {
      /* the now line stays where it was */
    }
  }

  async load(): Promise<void> {
    const [me, cals] = await Promise.all([api.me(), api.calendars()]);
    this.me = me.data;
    this.calendars = cals.data.calendars;
    try {
      const rules = await api.zoneRules();
      this.zoneRules = rules.data.rules;
    } catch {
      this.zoneRules = [];
    }
    this.emit();
  }

  async loadPeople(): Promise<void> {
    const { data } = await api.people();
    this.people = data.people;
  }

  // one WebSocket per page, sending nothing before it opens
  openLive(): void {
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/api/live?after=${this.lastSeq}`;
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.onopen = () => {
        this.reconnecting = false;
        this.emit();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as LiveMessage;
          this.lastSeq = Math.max(this.lastSeq, msg.seq);
          for (const h of this.liveHandlers) h(msg);
          this.emit();
        } catch {
          /* ignore anything unparsable */
        }
      };
      ws.onclose = () => {
        this.reconnecting = true;
        this.emit();
        setTimeout(connect, 4000);
      };
      ws.onerror = () => {
        ws.close();
      };
    };
    connect();
  }
}

export const state = new State();

// Date and time helpers, all in the viewer's zone.

export function zoneOf(): string {
  return state.me?.zone ?? "Europe/London";
}

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function fmtLong(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtHM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// parseLocal reads "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" into a date and
// minutes-from-midnight in the given zone's terms (the server resolves zones;
// the client only needs wall parts).
export function splitLocal(s: string): { date: string; minutes: number } {
  const [d, t] = s.includes("T") ? s.split("T") : s.split(" ");
  if (!t) return { date: d, minutes: 0 };
  const [h, m] = t.split(":").map(Number);
  return { date: d, minutes: (h ?? 0) * 60 + (m ?? 0) };
}

export function joinLocal(date: string, minutes: number): string {
  return `${date}T${fmtHM(minutes)}`;
}

export function utcToLocalParts(utc: string): { date: string; minutes: number } {
  const d = new Date(utc);
  return { date: fmtDate(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

export function localNow(): Date {
  const now = state.serverNow ? new Date(state.serverNow) : new Date();
  return now;
}

export function weekStartFor(person: Person | null, date: Date): Date {
  const start = person?.week_start ?? "monday";
    const dow = date.getDay();
  const target = start === "monday" ? 1 : start === "sunday" ? 0 : 6;
  const diff = (dow - target + 7) % 7;
  const d = new Date(date);
  d.setDate(d.getDate() - diff);
  return d;
}

export function viewDays(view: View, date: Date, hideWeekends: boolean, customDays: number): Date[] {
  const out: Date[] = [];
  if (view === "day") return [date];
  if (view === "week" || view === "custom") {
    const count = view === "week" ? 7 : customDays;
    const start = view === "week" ? weekStartFor(state.me, date) : date;
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (hideWeekends && (d.getDay() === 0 || d.getDay() === 6)) continue;
      out.push(d);
    }
    return out;
  }
  return out;
}
