// Domain names shared by the server and the client, and the copies the API returns.

export type Role =
  | "principal_librarian"
  | "assistant_librarian"
  | "section_principal"
  | "player";

export type ProgrammeStatus =
  | "draft"
  | "in_preparation"
  | "published"
  | "in_performance"
  | "closed";

export type RentalStatus =
  | "requested"
  | "received"
  | "in_use"
  | "returned"
  | "checked_in";

export const SECTION_KEYS = ["violin_1", "violin_2", "viola", "cello", "bass"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_NAMES: Record<SectionKey, string> = {
  violin_1: "Violin I",
  violin_2: "Violin II",
  viola: "Viola",
  cello: "Cello",
  bass: "Bass",
};

export const SECTION_ROSTER: Record<SectionKey, number> = {
  violin_1: 10,
  violin_2: 8,
  viola: 6,
  cello: 5,
  bass: 4,
};

/** The string chair keys of each section, in chair order. */
export const SECTION_CHAIR_KEYS: Record<SectionKey, string> = {
  violin_1: "vn1",
  violin_2: "vn2",
  viola: "va",
  cello: "vc",
  bass: "cb",
};

export interface CataloguePart {
  name: string;
  chair_key: string;
  bars_from: number;
  bars_to: number;
}

export interface CatalogueWork {
  id: string;
  title: string;
  composer: string;
  bars: number;
  running_time_seconds: number;
  parts: CataloguePart[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair: Chair | null;
}

export interface Chair {
  key: string;
  section: SectionKey | null;
  number: number | null;
  label: string;
}

export interface Copies {
  needed: number;
  on_hand: number;
  shortfall: number;
}

export interface PublishBlocker {
  error: string;
  message: string;
}

export interface ProgrammeSummary {
  id: string;
  number: string;
  title: string;
  status: ProgrammeStatus;
  first_rehearsal: string;
  performances: string[];
  final_performance_date: string;
  string_count: Record<SectionKey, number>;
  running_time_seconds: number;
  running_time: string;
  copies: Copies;
  parts_to_mark: number;
  seated_players: number;
  publish_blockers: PublishBlocker[];
}

export interface WorkSummary {
  id: string;
  programme_id: string;
  catalogue_work_id: string;
  title: string;
  composer: string;
  bars: number;
  running_time_seconds: number;
  running_time: string;
  copies: Copies;
  parts_to_mark: number;
}

export interface ProgrammeDetail extends ProgrammeSummary {
  works: WorkSummary[];
}

export interface BarSpan {
  from_bar: number;
  to_bar: number;
  bar_ms: number;
}

export interface RehearsalLetter {
  letter: string;
  bar: number;
  cut: boolean;
}

export interface Mark {
  cut_id: string;
  from_bar: number;
  to_bar: number;
  marked_by: { id: string; name: string; role: Role };
  marked_at: string;
}

export interface Scan {
  id: string;
  part_id: string;
  kind: "marked_part" | "bowing_master";
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  filed_at: string;
  uploaded_by: { id: string; name: string };
}

export interface Cut {
  id: string;
  work_id: string;
  from_bar: number;
  to_bar: number;
  saved_seconds: number;
  saved: string;
  parts_to_mark: number;
  created_at: string;
}

export interface Part {
  id: string;
  work_id: string;
  name: string;
  chair_key: string;
  bars_from: number;
  bars_to: number;
  copies: Copies;
  cuts_to_mark: string[];
  mark_cut: boolean;
  marks: Mark[];
  latest_marked_scan: Scan | null;
  latest_bowing_master: Scan | null;
}

export interface WorkDetail extends WorkSummary {
  full_running_time_seconds: number;
  bar_map: BarSpan[];
  rehearsal_letters: RehearsalLetter[];
  cuts: Cut[];
  parts: Part[];
}

export interface Notice {
  player_id: string;
  name: string;
  email: string;
  chair_label: string;
  status: "sent" | "queued";
  sent_at: string | null;
}

export interface FolderSummary {
  programme_id: string;
  number: string;
  title: string;
  status: ProgrammeStatus;
  first_rehearsal: string;
  chair_label: string;
  part_count: number;
}

export interface FolderPage {
  part_id: string;
  work_id: string;
  work_title: string;
  composer: string;
  part_name: string;
  bars_from: number;
  bars_to: number;
  cuts: { from_bar: number; to_bar: number }[];
  rehearsal_letters: { letter: string; bar: number }[];
  marked_scan: {
    id: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
  } | null;
}

export interface FolderDetail {
  programme: { id: string; number: string; title: string; status: ProgrammeStatus; first_rehearsal: string };
  chair: Chair;
  scans_available: boolean;
  pages: FolderPage[];
}

export interface SlipLine {
  part_id: string;
  part_name: string;
  copies: number;
  checked_in: number;
}

export interface RentalSet {
  id: string;
  work_id: string;
  work_title: string;
  programme_id: string;
  programme_number: string;
  publisher: string;
  status: RentalStatus;
  display_status: string;
  overdue: boolean;
  final_performance_date: string;
  due_date: string;
  due_at: string;
  slip: SlipLine[];
  copies_on_slip: number;
  copies_checked_in: number;
  copies_missing: number;
  reminder: { status: "none" | "queued" | "sent"; sent_at: string | null };
  returned_at: string | null;
  returned_late: boolean;
}

export interface ServiceStatus {
  storage: "up" | "down";
  mail: "up" | "down";
}

export function partLabel(workTitle: string, partName: string): string {
  return `${workTitle} — ${partName}`;
}

export function stringCountText(count: Record<SectionKey, number>): string {
  return SECTION_KEYS.map((key) => count[key]).join("-");
}

export function statusLabel(status: ProgrammeStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_preparation":
      return "In preparation";
    case "published":
      return "Published";
    case "in_performance":
      return "In performance";
    case "closed":
      return "Closed";
  }
}

export function rentalStatusLabel(status: RentalStatus): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "received":
      return "Received";
    case "in_use":
      return "In use";
    case "returned":
      return "Returned";
    case "checked_in":
      return "Checked in";
  }
}

/** The singular noun when a count is 1, otherwise the plural. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
