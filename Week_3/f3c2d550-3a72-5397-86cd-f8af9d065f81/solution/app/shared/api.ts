import type { SizeTenths, SizeUnit } from "./sizes.js";

export const COLOUR_FAMILIES = [
  "Black", "White", "Grey", "Silver", "Beige", "Brown", "Red",
  "Orange", "Yellow", "Green", "Blue", "Purple", "Pink",
] as const;
export type ColourFamily = (typeof COLOUR_FAMILIES)[number];

export type ReferenceState = "stored" | "trashed";
export type ServiceState = "up" | "down";
export type SheetState = "queued" | "rendering" | "ready" | "failed";
export type Paper = "a4" | "letter";

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface Photo {
  original_url: string;
  display_url: string;
  content_type: "image/jpeg" | "image/png";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
}

export interface Reference {
  id: string;
  state: ReferenceState;
  version: number;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string;
  colour_family: ColourFamily;
  source_url: string | null;
  source_note: string;
  notes: string;
  size_tenths_mm: SizeTenths;
  size_text: Record<SizeUnit, string>;
  swatch: string;
  swatch_source: "computed" | "eyedropper";
  captured_at: string;
  trashed_at: string | null;
  purge_at: string | null;
  photo: Photo;
}

export interface Library {
  zone: string;
  today_starts_at: string;
  saved_today: Reference[];
  earlier: Reference[];
}

export interface ReelSummary {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stop_count: number;
  playable_count: number;
}

export interface Reel {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stops: { position: number; reference: Reference }[];
}

export interface SheetStop {
  position: number;
  reference_id: string;
  title: string;
  maker: string | null;
  year: number | null;
  size_text: string;
  swatch: string;
}

export interface Sheet {
  id: string;
  reel_id: string;
  state: SheetState;
  paper: Paper;
  unit: SizeUnit;
  requested_at: string;
  ready_at: string | null;
  pdf_url: string | null;
  pdf_bytes: number | null;
  pdf_sha256: string | null;
  stops: SheetStop[];
}

export interface TrashItem {
  id: string;
  title: string;
  maker: string | null;
  trashed_at: string;
  purge_at: string;
  seconds_left: number;
}

export interface Trash {
  server_now: string;
  items: TrashItem[];
}

export interface SearchResult {
  source: "index" | "fallback";
  results: Reference[];
}

export interface DailyPull {
  pull_day: string;
  zone: string;
  state: "picked" | "empty" | "removed";
  reference: Reference | null;
  next_pull_at: string;
  today_starts_at: string;
  server_now: string;
}

export interface Settings {
  home_zone: string;
  pending_zone: { zone: string; effective_from: string; effective_date: string } | null;
  history: { zone: string; effective_from: string }[];
  unit: SizeUnit;
  server_now: string;
}

export interface Status {
  server_now: string;
  services: { search: ServiceState; storage: ServiceState; printing: ServiceState };
}
