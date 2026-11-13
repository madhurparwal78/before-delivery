// api.ts — the app's one client for the JSON API.

export interface Person {
  id: string;
  name: string;
  email: string;
  zone: string;
  city: string;
  role: "office_manager" | "member" | "guest";
  week_start: "monday" | "sunday" | "saturday";
  hide_weekends: boolean;
  custom_days: number;
  second_zone: string | null;
}

export interface Calendar {
  id: string;
  name: string;
  owner_id: string | null;
  colour: string;
  level: string;
  default_reminders: number[];
}

export interface ClockEntry {
  city: string;
  time: string;
  date: string;
  inside_hours: boolean;
}

export interface Guest {
  person_id: string;
  name: string;
  answer: string;
  message?: string;
}

export interface ZoneWarning {
  rule_id: string;
  city: string;
  effective_date: string;
  new_offset: string;
  shift_minutes: number;
  saved_time: string;
  shown_time: string;
  note: string;
}

export interface Occurrence {
  occurrence_id: string;
  event_id: string;
  calendar_id: string;
  title: string;
  all_day: boolean;
  start_local: string;
  end_local: string;
  zone: string;
  access: string;
  clocks: ClockEntry[];
  start_utc: string | null;
  end_utc: string | null;
  is_exception?: boolean;
  location?: string;
  notes?: string;
  kind?: string;
  colour?: string;
  rrule?: string | null;
  organiser?: { id: string; name: string };
  adjusted?: boolean;
  zone_warnings?: ZoneWarning[];
  guests?: Guest[];
  rsvp?: { yes: number; no: number; maybe: number; invited: number };
  switches?: { modify_event: boolean; invite_others: boolean; see_guest_list: boolean };
  version?: number;
  reminders?: number[];
  my_reply?: { answer: string; message: string };
}

export interface EventDetail extends Occurrence {
  id: string;
  visibility?: string;
  exceptions?: unknown[];
  share_link?: { token: string; url: string; expires_at: string } | null;
  saved_at?: string;
  decline_mode?: string | null;
  decline_message?: string | null;
  series_id?: string | null;
  split_from?: string | null;
  proposals?: Proposal[];
  my_proposals?: Proposal[];
}

export interface Proposal {
  id: string;
  occurrence_id: string;
  proposer: { id: string; name: string };
  start_local: string;
  end_local: string;
  note: string;
  status: string;
}

export interface ZoneRule {
  id: string;
  zone: string;
  city: string;
  effective_date: string;
  new_offset: string;
  note: string;
  recorded_by: string;
}

export interface Notice {
  id: number;
  kind: string;
  text: string;
  created_at: string;
}

export interface Slot {
  start_utc: string;
  end_utc: string;
  clocks: ClockEntry[];
}

export interface BusyEntry {
  person_id: string;
  name: string;
  blocks: { start_utc: string; end_utc: string }[];
}

export interface TrashItem {
  id: string;
  kind: string;
  title: string;
  event_id: string;
  occurrence_id: string | null;
  trashed_at: string;
  purge_at: string;
  days_left: number;
}

export interface PrintJob {
  id: string;
  week_start: string;
  calendars: string[];
  status: string;
  waiting_on: string | null;
  object_key: string;
  size_bytes: number | null;
  created_at: string;
  stored_at: string | null;
}

export interface Reminder {
  id: number;
  occurrence_id: string;
  title: string;
  minutes: number;
  due_utc: string;
  status: string;
  fired_at: string | null;
}

export interface Share {
  person_id: string;
  name: string;
  level: string;
}

export interface Settings {
  guest_defaults: { modify_event: boolean; invite_others: boolean; see_guest_list: boolean };
  office_hours: Record<string, { open: string; close: string; days: number[] }>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  current: EventDetail | null;
  constructor(status: number, code: string, message: string, fields: Record<string, string>, current: EventDetail | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.current = current;
  }
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  const etag = res.headers.get("ETag");
  if (res.status === 204) return { data: undefined as T, etag };
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; fields?: Record<string, string>; current?: EventDetail };
    throw new ApiError(res.status, err.error ?? "error", err.message ?? "", err.fields ?? {}, err.current ?? null);
  }
  return { data: data as T, etag };
}

export const api = {
  time: () => request<{ now_utc: string; zone: string }>("GET", "/api/time"),
  signIn: (email: string, passcode: string) => request<{ person: Person }>("POST", "/api/session", { email, passcode }),
  signOut: () => request<void>("DELETE", "/api/session"),
  me: () => request<Person>("GET", "/api/me"),
  patchMe: (fields: Record<string, unknown>) => request<Person>("PATCH", "/api/me", fields),
  draft: () => request<{ draft: Record<string, unknown> | null }>("GET", "/api/draft"),
  putDraft: (draft: Record<string, unknown>) => request<{ draft: Record<string, unknown> }>("PUT", "/api/draft", draft),
  deleteDraft: () => request<void>("DELETE", "/api/draft"),
  people: () => request<{ people: { id: string; name: string; zone: string; city: string }[] }>("GET", "/api/people"),
  calendars: () => request<{ calendars: Calendar[] }>("GET", "/api/calendars"),
  patchCalendar: (id: string, fields: Record<string, unknown>) => request<Calendar>("PATCH", `/api/calendars/${id}`, fields),
  occurrences: (from: string, to: string, calendars: string[]) =>
    request<{ occurrences: Occurrence[] }>("GET", `/api/occurrences?from=${from}&to=${to}${calendars.length ? `&calendars=${encodeURIComponent(calendars.join(","))}` : ""}`),
  createEvent: (fields: Record<string, unknown>) => request<EventDetail>("POST", "/api/events", fields),
  getEvent: (id: string, occurrenceId?: string) =>
    request<EventDetail>("GET", `/api/events/${id}${occurrenceId ? `?occurrence_id=${encodeURIComponent(occurrenceId)}` : ""}`),
  patchEvent: (id: string, fields: Record<string, unknown>, etag: string) =>
    request<{ event: EventDetail; split: { earlier_id: string; later_id: string } | null }>("PATCH", `/api/events/${id}`, fields, { "If-Match": etag }),
  deleteEvent: (id: string, scope: string, occurrenceId: string, etag: string) =>
    request<{ trash_id: string }>("DELETE", `/api/events/${id}?scope=${scope}&occurrence_id=${encodeURIComponent(occurrenceId)}`, undefined, { "If-Match": etag }),
  duplicate: (id: string) => request<EventDetail>("POST", `/api/events/${id}/duplicate`),
  moveToCalendar: (id: string, calendarId: string, etag: string) =>
    request<EventDetail>("POST", `/api/events/${id}/move`, { calendar_id: calendarId }, { "If-Match": etag }),
  conflicts: (id: string) => request<{ conflicts: { event_id: string; occurrence_id: string; title: string; start_local: string; zone: string; answer: string }[] }>("GET", `/api/events/${id}/conflicts`),
  addGuests: (id: string, personIds: string[]) => request<EventDetail>("POST", `/api/events/${id}/guests`, { person_ids: personIds }),
  removeGuest: (id: string, personId: string) => request<EventDetail>("DELETE", `/api/events/${id}/guests/${personId}`),
  reply: (id: string, scope: string, occurrenceId: string, answer: string) =>
    request<{ my_reply: { answer: string; message: string } }>("PUT", `/api/events/${id}/replies/me`, { scope, occurrence_id: occurrenceId, answer }),
  propose: (id: string, occurrenceId: string, startLocal: string, endLocal: string, note: string) =>
    request<Proposal>("POST", `/api/events/${id}/proposals`, { occurrence_id: occurrenceId, start_local: startLocal, end_local: endLocal, note }),
  decideProposal: (id: string, accept: boolean) =>
    request<{ proposal: Proposal; event: EventDetail }>("POST", `/api/proposals/${id}/${accept ? "accept" : "decline"}`),
  createShareLink: (id: string) => request<{ token: string; url: string; expires_at: string }>("POST", `/api/events/${id}/share-link`),
  deleteShareLink: (id: string) => request<void>("DELETE", `/api/events/${id}/share-link`),
  shares: (calendarId: string) => request<{ shares: Share[] }>("GET", `/api/shares?calendar_id=${encodeURIComponent(calendarId)}`),
  putShare: (calendarId: string, personId: string, level: string) =>
    request<Share>("PUT", `/api/calendars/${calendarId}/shares/${personId}`, { level }),
  deleteShare: (calendarId: string, personId: string) => request<void>("DELETE", `/api/calendars/${calendarId}/shares/${personId}`),
  settings: () => request<Settings>("GET", "/api/settings"),
  patchSettings: (fields: Record<string, unknown>) => request<Settings>("PATCH", "/api/settings", fields),
  zoneRules: () => request<{ rules: ZoneRule[] }>("GET", "/api/zone-rules"),
  recordRule: (fields: Record<string, unknown>) => request<ZoneRule>("POST", "/api/zone-rules", fields),
  zoneMove: (id: string, ruleId: string, etag: string) =>
    request<{ event: EventDetail; split: unknown }>("POST", `/api/events/${id}/zone-moves`, { rule_id: ruleId }, { "If-Match": etag }),
  trash: () => request<{ items: TrashItem[] }>("GET", "/api/trash"),
  restore: (id: string) => request<{ event: EventDetail }>("POST", `/api/trash/${id}/restore`),
  purge: (id: string) => request<void>("DELETE", `/api/trash/${id}`),
  search: (q: string) => request<{ results: { event_id: string; occurrence_id: string; title: string; start_local: string; zone: string; calendar_id: string }[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  findATime: (people: string[], minutes: number, from: string, to: string) =>
    request<{ slots: Slot[]; busy: BusyEntry[] }>("GET", `/api/find-a-time?people=${encodeURIComponent(people.join(","))}&minutes=${minutes}&from=${from}&to=${to}`),
  notices: () => request<{ notices: Notice[] }>("GET", "/api/notices"),
  reminders: (from: string, to: string) => request<{ reminders: Reminder[] }>("GET", `/api/reminders?from=${from}&to=${to}`),
  snooze: (id: number, minutes: number) => request<Reminder>("POST", `/api/reminders/${id}/snooze`, { minutes }),
  prints: () => request<{ prints: PrintJob[] }>("GET", "/api/prints"),
  createPrint: (weekStart: string, calendars: string[], idemKey: string) =>
    request<PrintJob>("POST", "/api/prints", { week_start: weekStart, calendars }, { "Idempotency-Key": idemKey }),
  getPrint: (id: string) => request<PrintJob>("GET", `/api/prints/${id}`),
  retryPrint: (id: string) => request<PrintJob>("POST", `/api/prints/${id}/retry`),
  exportCalendar: (id: string) => request<{ id: string; object_key: string; size_bytes: number; url: string }>("POST", `/api/calendars/${id}/exports`),
  importCalendar: (id: string, ics: string) =>
    request<{ id: string; created: number; updated: number; skipped: { uid: string; reason: string }[] }>("POST", `/api/calendars/${id}/imports`, ics),
};
