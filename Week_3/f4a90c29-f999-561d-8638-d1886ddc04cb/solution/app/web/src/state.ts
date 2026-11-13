import { get } from "./api";
import { Store } from "./store";
import type { CalendarInfo, Hours, Me, PersonInfo, Print, Reminder, Zone } from "./types";

/** undefined while unknown, null when signed out. */
export const me$ = new Store<Me | null | undefined>(undefined);
export const calendars$ = new Store<CalendarInfo[]>([]);
export const people$ = new Store<PersonInfo[]>([]);
export const hours$ = new Store<Record<Zone, Hours> | null>(null);
export const dataVersion$ = new Store(0);
export const reminders$ = new Store<Reminder[]>([]);
export const prints$ = new Store<Print[]>([]);
export const draft$ = new Store<{ loaded: boolean; draft: Record<string, unknown> | null }>({ loaded: false, draft: null });
export const connection$ = new Store({ reconnecting: false });

let pending = false;
/** Tells every data view to read again; many calls in one turn make one read. */
export function bump(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    dataVersion$.set((n) => n + 1);
  });
}

export async function loadMe(): Promise<void> {
  try {
    me$.set(await get<Me>("/api/me"));
  } catch {
    me$.set(null);
  }
}

export async function loadBase(): Promise<void> {
  const me = me$.get();
  if (!me) return;
  const [calendars] = await Promise.all([get<{ calendars: CalendarInfo[] }>("/api/calendars")]);
  calendars$.set(calendars.calendars);
  if (me.role !== "guest") {
    const [people, settings] = await Promise.all([
      get<{ people: PersonInfo[] }>("/api/people"),
      get<{ office_hours: Record<Zone, Hours> }>("/api/settings"),
    ]);
    people$.set(people.people);
    hours$.set(settings.office_hours);
  }
}

export async function loadDraft(): Promise<void> {
  const body = await get<{ draft: Record<string, unknown> | null }>("/api/draft");
  draft$.set({ loaded: true, draft: body.draft });
}
