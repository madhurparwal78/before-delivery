// Every call the browser makes, and the one error shape it reads back.

export type Clock = { city: string; time: string; date: string; inside_hours: boolean };

export type Guest = { person_id: string; name: string; answer: string; message: string };
export type RSVP = { yes: number; no: number; maybe: number; invited: number };
export type Switches = { modify_event: boolean; invite_others: boolean; see_guest_list: boolean };

export type Proposal = {
  id: string;
  occurrence_id: string;
  proposer: { id: string; name: string };
  start_local: string;
  end_local: string;
  note: string;
  status: string;
};

export type ZoneWarning = {
  rule_id: string;
  city: string;
  effective_date: string;
  new_offset: string;
  shift_minutes: number;
  saved_time: string;
  shown_time: string;
  note: string;
};

export type EventRecord = {
  id?: string;
  occurrence_id?: string;
  event_id?: string;
  calendar_id: string;
  series_id?: string;
  split_from?: string | null;
  organiser?: { id: string; name: string };
  title: string;
  location?: string;
  notes?: string;
  kind?: string;
  colour?: string;
  reminders?: number[];
  all_day: boolean;
  start_local: string;
  end_local: string;
  zone: string;
  visibility?: string;
  rrule?: string | null;
  decline_mode?: string | null;
  decline_message?: string;
  switches?: Switches;
  guests?: Guest[];
  rsvp?: RSVP;
  my_reply?: { answer: string; message: string };
  my_proposals?: Proposal[];
  proposals?: Proposal[];
  exceptions?: {
    occurrence_id: string;
    deleted: boolean;
    start_local: string | null;
    end_local: string | null;
    title: string | null;
    location: string | null;
    notes: string | null;
  }[];
  zone_warnings?: ZoneWarning[];
  share_link?: { token: string; url: string; expires_at: string } | null;
  version?: number;
  saved_at?: string;
  access: string;
  adjusted?: boolean;
  is_exception?: boolean;
  clocks: Clock[];
  start_utc: string | null;
  end_utc: string | null;
};

export type Person = {
  id: string;
  name: string;
  email?: string;
  zone: string;
  city: string;
  role?: string;
  week_start?: string;
  hide_weekends?: boolean;
  custom_days?: number;
  second_zone?: string | null;
};

export type Calendar = {
  id: string;
  name: string;
  owner_id: string | null;
  colour: string;
  level: string;
  default_reminders: number[];
};

export type OfficeHours = { open: string; close: string; days: number[] };
export type FirmSettings = { guest_defaults: Switches; office_hours: Record<string, OfficeHours> };

export type ZoneRule = {
  id: string;
  zone: string;
  city: string;
  effective_date: string;
  new_offset: string;
  note: string;
  recorded_by: string;
};

export type TrashItem = {
  id: string;
  kind: string;
  title: string;
  event_id: string;
  occurrence_id: string;
  trashed_at: string;
  purge_at: string;
  days_left: number;
};

export type Reminder = {
  id: string;
  occurrence_id: string;
  title: string;
  minutes: number;
  due_utc: string;
  status: string;
  fired_at: string | null;
};

export type Notice = { id: string; kind: string; text: string; created_at: string };

export type Print = {
  id: string;
  week_start: string;
  calendars: string[];
  status: string;
  waiting_on: string | null;
  object_key: string;
  size_bytes: number | null;
  created_at: string;
  stored_at: string | null;
};

export type SearchResult = {
  event_id: string;
  occurrence_id: string;
  title: string;
  start_local: string;
  zone: string;
  calendar_id: string;
};

export type Slot = { start_utc: string; end_utc: string; clocks: Clock[] };
export type BusyPerson = { person_id: string; name: string; blocks: { start_utc: string; end_utc: string }[] };

/** ApiError carries the one published error shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly current?: EventRecord,
    readonly winner?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed.error ?? "server_error",
      parsed.message ?? "Something went wrong. Try again shortly.",
      parsed.fields ?? {},
      parsed.current,
      typeof parsed.message === "string" ? parsed.message.replace(" saved this first.", "") : undefined,
    );
  }
  return parsed as T;
}

export const api = {
  time: () => request<{ now_utc: string; zone: string }>("GET", "/api/time"),
  signIn: (email: string, passcode: string) =>
    request<{ person: Person }>("POST", "/api/session", { email, passcode }),
  signOut: () => request<void>("DELETE", "/api/session"),
  me: () => request<Person>("GET", "/api/me"),
  patchMe: (body: Partial<Person>) => request<Person>("PATCH", "/api/me", body),
  people: () => request<{ people: Person[] }>("GET", "/api/people"),
  calendars: () => request<{ calendars: Calendar[] }>("GET", "/api/calendars"),
  patchCalendar: (id: string, minutes: number[]) =>
    request<Calendar>("PATCH", `/api/calendars/${id}`, { default_reminders: minutes }),
  draft: () => request<{ draft: Record<string, unknown> | null }>("GET", "/api/draft"),
  putDraft: (body: Record<string, unknown>) =>
    request<{ draft: Record<string, unknown> }>("PUT", "/api/draft", body),
  deleteDraft: () => request<void>("DELETE", "/api/draft"),
  occurrences: (from: string, to: string, calendars: string[]) =>
    request<{ occurrences: EventRecord[] }>(
      "GET",
      `/api/occurrences?from=${from}&to=${to}${calendars.length ? `&calendars=${calendars.join(",")}` : ""}`,
    ),
  createEvent: (body: Record<string, unknown>) => request<EventRecord>("POST", "/api/events", body),
  event: (id: string, occurrenceID?: string) =>
    request<EventRecord>("GET", `/api/events/${id}${occurrenceID ? `?occurrence_id=${occurrenceID}` : ""}`),
  patchEvent: (id: string, version: number, body: Record<string, unknown>) =>
    request<{ event: EventRecord; split: { earlier_id: string; later_id: string } | null }>(
      "PATCH",
      `/api/events/${id}`,
      body,
      { "If-Match": `"${version}"` },
    ),
  deleteEvent: (id: string, version: number, scope?: string, occurrenceID?: string) =>
    request<{ trash_id: string }>(
      "DELETE",
      `/api/events/${id}?scope=${scope ?? "all"}${occurrenceID ? `&occurrence_id=${occurrenceID}` : ""}`,
      undefined,
      { "If-Match": `"${version}"` },
    ),
  duplicate: (id: string) => request<EventRecord>("POST", `/api/events/${id}/duplicate`, {}),
  moveToCalendar: (id: string, version: number, calendarID: string) =>
    request<EventRecord>("POST", `/api/events/${id}/move`, { calendar_id: calendarID }, { "If-Match": `"${version}"` }),
  conflicts: (id: string) =>
    request<{
      conflicts: { event_id: string; occurrence_id: string; title: string; start_local: string; zone: string; answer: string }[];
    }>("GET", `/api/events/${id}/conflicts`),
  addGuests: (id: string, personIDs: string[]) =>
    request<EventRecord>("POST", `/api/events/${id}/guests`, { person_ids: personIDs }),
  removeGuest: (id: string, personID: string) =>
    request<EventRecord>("DELETE", `/api/events/${id}/guests/${personID}`),
  reply: (id: string, scope: "occurrence" | "series", answer: string, occurrenceID?: string) =>
    request<{ my_reply: { answer: string; message: string } }>("PUT", `/api/events/${id}/replies/me`, {
      scope,
      answer,
      occurrence_id: occurrenceID,
    }),
  propose: (id: string, body: Record<string, unknown>) =>
    request<{ proposal: Proposal }>("POST", `/api/events/${id}/proposals`, body),
  decideProposal: (id: string, decision: "accept" | "decline") =>
    request<{ proposal: Proposal; event: EventRecord }>("POST", `/api/proposals/${id}/${decision}`, {}),
  newShareLink: (id: string) =>
    request<{ token: string; url: string; expires_at: string }>("POST", `/api/events/${id}/share-link`, {}),
  deleteShareLink: (id: string) => request<void>("DELETE", `/api/events/${id}/share-link`),
  sharedEvent: (token: string) =>
    request<{
      title: string;
      location: string;
      organiser_name: string;
      all_day: boolean;
      start_local: string;
      end_local: string;
      zone: string;
      clocks: Clock[];
      guests: { name: string; answer: string }[];
    }>("GET", `/api/share/${token}`),
  shares: (calendarID: string) =>
    request<{ shares: { person_id: string; name: string; level: string }[] }>(
      "GET",
      `/api/shares?calendar_id=${calendarID}`,
    ),
  putShare: (calendarID: string, personID: string, level: string) =>
    request<unknown>("PUT", `/api/calendars/${calendarID}/shares/${personID}`, { level }),
  deleteShare: (calendarID: string, personID: string) =>
    request<void>("DELETE", `/api/calendars/${calendarID}/shares/${personID}`),
  settings: () => request<FirmSettings>("GET", "/api/settings"),
  patchSettings: (body: Partial<FirmSettings>) => request<FirmSettings>("PATCH", "/api/settings", body),
  zoneRules: () => request<{ rules: ZoneRule[] }>("GET", "/api/zone-rules"),
  recordZoneRule: (body: Record<string, unknown>) => request<ZoneRule>("POST", "/api/zone-rules", body),
  zoneMove: (id: string, version: number, ruleID: string) =>
    request<{ event: EventRecord; split: { earlier_id: string; later_id: string } | null }>(
      "POST",
      `/api/events/${id}/zone-moves`,
      { rule_id: ruleID },
      { "If-Match": `"${version}"` },
    ),
  trash: () => request<{ items: TrashItem[] }>("GET", "/api/trash"),
  restore: (id: string) => request<{ event: EventRecord }>("POST", `/api/trash/${id}/restore`, {}),
  deleteForGood: (id: string) => request<void>("DELETE", `/api/trash/${id}`),
  search: (q: string) => request<{ results: SearchResult[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  findATime: (people: string[], minutes: number, from: string, to: string) =>
    request<{ slots: Slot[]; busy: BusyPerson[] }>(
      "GET",
      `/api/find-a-time?people=${people.join(",")}&minutes=${minutes}&from=${from}&to=${to}`,
    ),
  notices: () => request<{ notices: Notice[] }>("GET", "/api/notices"),
  reminders: (from: string, to: string) =>
    request<{ reminders: Reminder[] }>("GET", `/api/reminders?from=${from}&to=${to}`),
  snooze: (id: string, minutes: number) => request<Reminder>("POST", `/api/reminders/${id}/snooze`, { minutes }),
  createPrint: (weekStart: string, key: string) =>
    request<Print>("POST", "/api/prints", { week_start: weekStart }, { "Idempotency-Key": key }),
  prints: () => request<{ prints: Print[] }>("GET", "/api/prints"),
  retryPrint: (id: string) => request<Print>("POST", `/api/prints/${id}/retry`, {}),
  exportCalendar: (id: string) =>
    request<{ id: string; object_key: string; size_bytes: number; url: string }>(
      "POST",
      `/api/calendars/${id}/exports`,
      {},
    ),
};
