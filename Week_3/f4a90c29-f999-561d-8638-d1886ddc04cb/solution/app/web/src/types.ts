export type Zone = "America/New_York" | "Europe/London" | "Pacific/Auckland";
export type AccessLevel = "full" | "guest" | "details" | "busy";
export type ReplyStatus = "yes" | "no" | "maybe" | "invited";

export interface Me {
  id: string;
  name: string;
  email: string;
  zone: Zone;
  city: string;
  role: "office_manager" | "member" | "guest";
  week_start: "monday" | "sunday" | "saturday";
  hide_weekends: boolean;
  custom_days: number;
  second_zone: Zone | null;
}

export interface CalendarInfo {
  id: string;
  name: string;
  owner_id: string | null;
  colour: string;
  level: string;
  default_reminders: number[];
}

export interface PersonInfo {
  id: string;
  name: string;
  zone: Zone;
  city: string;
}

export interface ClockEntry {
  city: string;
  time: string;
  date: string;
  inside_hours: boolean;
}

export interface Switches {
  modify_event: boolean;
  invite_others: boolean;
  see_guest_list: boolean;
}

export interface GuestRow {
  person_id: string;
  name: string;
  answer: ReplyStatus;
  message: string | null;
}

export interface ReplyCounts {
  yes: number;
  no: number;
  maybe: number;
  invited: number;
}

export interface Proposal {
  id: string;
  occurrence_id: string;
  proposer: { id: string; name: string };
  start_local: string;
  end_local: string;
  note: string;
  status: "proposed" | "accepted" | "declined";
}

export interface ZoneWarning {
  rule_id: string;
  city: string;
  effective_date: string;
  new_offset: string;
  saved_time: string;
  shown_time: string;
  note: string;
}

export interface ShareLink {
  token: string;
  url: string;
}

/** An event or an occurrence as the API publishes it; fields beyond the caller's access are absent. */
export interface Item {
  id?: string;
  occurrence_id?: string;
  event_id?: string;
  calendar_id: string;
  series_id?: string;
  organiser?: { id: string; name: string } | null;
  title: string;
  location?: string;
  notes?: string;
  kind?: string;
  colour?: string;
  reminders?: number[];
  all_day: boolean;
  start_local: string;
  end_local: string;
  zone: Zone;
  visibility?: string;
  rrule?: string | null;
  decline_mode?: string | null;
  decline_message?: string | null;
  switches?: Switches;
  guests?: GuestRow[];
  rsvp?: ReplyCounts;
  my_reply?: { answer: ReplyStatus; message: string | null };
  my_proposals?: Proposal[];
  proposals?: Proposal[];
  zone_warnings?: ZoneWarning[];
  share_link?: ShareLink | null;
  version?: number;
  access: AccessLevel;
  adjusted?: boolean;
  clocks: ClockEntry[];
  start_utc: string | null;
  end_utc: string | null;
}

export interface Reminder {
  id: string;
  occurrence_id: string;
  title: string;
  text: string;
}

export interface Print {
  id: string;
  week_start: string;
  status: "pending" | "rendered" | "stored" | "failed";
  waiting_on: "document_service" | "file_storage" | null;
}

export interface Hours {
  open: string;
  close: string;
  days: number[];
}

export interface LiveMessage {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}
