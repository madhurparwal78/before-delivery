// API shapes shared by the server (which builds them) and the client (which renders them).

export type Role = "principal_librarian" | "assistant_librarian" | "section_principal" | "player";
export type ProgrammeStatus = "draft" | "in_preparation" | "published" | "in_performance" | "closed";
export type RentalStatus = "requested" | "received" | "in_use" | "returned" | "checked_in";
export type ScanKind = "marked_part" | "bowing_master";
export type SectionKey = "violin_1" | "violin_2" | "viola" | "cello" | "bass";

export const SECTION_KEYS: readonly SectionKey[] = ["violin_1", "violin_2", "viola", "cello", "bass"];
export const SECTION_NAMES: Record<SectionKey, string> = {
  violin_1: "Violin I",
  violin_2: "Violin II",
  viola: "Viola",
  cello: "Cello",
  bass: "Bass",
};

export const PROGRAMME_STATUS_LABELS: Record<ProgrammeStatus, string> = {
  draft: "Draft",
  in_preparation: "In preparation",
  published: "Published",
  in_performance: "In performance",
  closed: "Closed",
};

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  requested: "Requested",
  received: "Received",
  in_use: "In use",
  returned: "Returned",
  checked_in: "Checked in",
};

export interface Chair {
  key: string;
  section: string;
  number: number | null;
  label: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair: Chair | null;
}

export interface Copies {
  needed: number;
  on_hand: number;
  shortfall: number;
}

export type StringCount = Record<SectionKey, number>;

export interface PublishBlocker {
  error: "illegal_transition" | "first_rehearsal_passed" | "no_works" | "copies_short";
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
  string_count: StringCount;
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

export interface BarSegment {
  from_bar: number;
  to_bar: number;
  bar_ms: number;
}

interface RehearsalLetter {
  letter: string;
  bar: number;
  cut: boolean;
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
  kind: ScanKind;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  filed_at: string;
  uploaded_by: { id: string; name: string };
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
  bar_map: BarSegment[];
  rehearsal_letters: RehearsalLetter[];
  cuts: Cut[];
  parts: Part[];
}

export interface CatalogueWork {
  id: string;
  title: string;
  composer: string;
  bars: number;
  running_time_seconds: number;
  parts: { name: string; chair_key: string; bars_from: number; bars_to: number }[];
}

export interface Notice {
  player_id: string;
  name: string;
  email: string;
  chair_label: string;
  status: "sent" | "queued";
  sent_at: string | null;
}

export interface FolderEntry {
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
  marked_scan: { id: string; file_name: string; content_type: string; size_bytes: number } | null;
}

export interface Folder {
  programme: { id: string; number: string; title: string; status: ProgrammeStatus; first_rehearsal: string };
  chair: Chair;
  scans_available: boolean;
  pages: FolderPage[];
}

interface SlipLine {
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

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  lines?: { part_id: string; part_name: string; checked_in: number }[];
  missing?: { part_id: string; part_name: string; missing: number }[];
  shortfall?: number;
}

/** `M:SS` for a whole number of seconds. */
export function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
