export type Unit = 'mm' | 'in';
export type Paper = 'a4' | 'letter';
export type ReferenceState = 'stored' | 'trashed';
/** A reference also exists as a purged tombstone, which the API never returns. */
export type PersistedReferenceState = ReferenceState | 'purged';
export type SwatchSource = 'computed' | 'eyedropper';
export type SheetState = 'queued' | 'rendering' | 'ready' | 'failed';
export type ServiceState = 'up' | 'down';

export interface SizeTenths {
  width: number;
  height: number;
  depth: number;
}

export interface SizeText {
  mm: string;
  in: string;
}

export interface PhotoFacts {
  original_url: string;
  display_url: string;
  content_type: 'image/jpeg' | 'image/png';
  bytes: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ReferenceJson {
  id: string;
  state: ReferenceState;
  version: number;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string | null;
  colour_family: string;
  source_url: string | null;
  source_note: string | null;
  notes: string | null;
  size_tenths_mm: SizeTenths;
  size_text: SizeText;
  swatch: string;
  swatch_source: SwatchSource;
  captured_at: string;
  trashed_at: string | null;
  purge_at: string | null;
  photo: PhotoFacts;
}

export interface LibraryJson {
  zone: string;
  today_starts_at: string;
  saved_today: ReferenceJson[];
  earlier: ReferenceJson[];
}

export interface SearchJson {
  source: 'index' | 'fallback';
  results: ReferenceJson[];
}

export interface TrashItemJson {
  id: string;
  title: string;
  maker: string | null;
  trashed_at: string;
  purge_at: string;
  seconds_left: number;
}

export interface TrashJson {
  server_now: string;
  items: TrashItemJson[];
}

export interface ReelStopJson {
  position: number;
  reference: ReferenceJson;
}

export interface ReelJson {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stops: ReelStopJson[];
}

export interface ReelSummaryJson {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stop_count: number;
  playable_count: number;
}

export interface ReelListJson {
  reels: ReelSummaryJson[];
}

export interface SheetStopJson {
  position: number;
  reference_id: string;
  title: string;
  maker: string | null;
  year: number | null;
  size_text: string;
  swatch: string;
}

export interface SheetJson {
  id: string;
  reel_id: string;
  state: SheetState;
  paper: Paper;
  unit: Unit;
  requested_at: string;
  ready_at: string | null;
  pdf_url: string | null;
  pdf_bytes: number | null;
  pdf_sha256: string | null;
  stops: SheetStopJson[];
}

export interface SheetListJson {
  sheets: SheetJson[];
}

export interface DailyPullJson {
  pull_day: string;
  zone: string;
  state: 'picked' | 'empty' | 'removed';
  reference: ReferenceJson | null;
  next_pull_at: string;
  today_starts_at: string;
  server_now: string;
}

export interface PendingZoneJson {
  zone: string;
  effective_from: string;
  effective_date: string;
}

export interface SettingsJson {
  home_zone: string;
  pending_zone: PendingZoneJson | null;
  history: Array<{ zone: string; effective_from: string }>;
  unit: Unit;
  server_now: string;
}

export interface StatusJson {
  server_now: string;
  services: {
    search: ServiceState;
    storage: ServiceState;
    printing: ServiceState;
  };
}

export interface ApiErrorJson {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
