// Shared types and pure rules used by server and browser.
// Each published rule lives in exactly one module: sizes here, swatch/photo/zone
// rules live in their own modules.

export const COLOUR_FAMILIES = [
  "Black", "White", "Grey", "Silver", "Beige", "Brown", "Red", "Orange", "Yellow",
  "Green", "Blue", "Purple", "Pink",
] as const;
export type ColourFamily = (typeof COLOUR_FAMILIES)[number];

export interface SizeTenths { width: number; height: number; depth: number }

export interface Swatch {
  swatch: string;
  swatch_source: "computed" | "eyedropper";
}

export interface Reference {
  id: string;
  state: "stored" | "trashed";
  version: number;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string | null;
  colour_family: ColourFamily;
  source_url: string | null;
  source_note: string | null;
  notes: string | null;
  size_tenths_mm: SizeTenths;
  size_text: { mm: string; in: string };
  swatch: string;
  swatch_source: "computed" | "eyedropper";
  captured_at: string;
  trashed_at: string | null;
  purge_at: string | null;
  photo: {
    original_url: string;
    display_url: string;
    content_type: "image/jpeg" | "image/png";
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  };
}

export interface ReelStop {
  position: number;
  reference: Reference;
}

export interface Reel {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stops: ReelStop[];
}

export interface ReelSummary {
  id: string;
  name: string;
  demo: boolean;
  version: number;
  stop_count: number;
  playable_count: number;
}

export interface SheetStopSnapshot {
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
  state: "queued" | "rendering" | "ready" | "failed";
  paper: "a4" | "letter";
  unit: "mm" | "in";
  requested_at: string;
  ready_at: string | null;
  pdf_url: string | null;
  pdf_bytes: number | null;
  pdf_sha256: string | null;
  stops: SheetStopSnapshot[];
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export type Unit = "mm" | "in";

export const FIELD_ORDER = [
  "photo", "swatch", "title", "maker", "year", "unit", "width", "height", "depth",
  "materials", "finish", "colour_family", "source_url", "source_note", "notes",
] as const;

// --- Size rule: stored once as whole tenths of a millimetre (Business rules). ---

function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

export function parseSizeInput(raw: string, unit: Unit): number | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === "mm") {
    if (!/^\d+(\.\d)?$/.test(text)) return null;
    const tenths = value * 10;
    return Number.isInteger(tenths) ? tenths : null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return roundHalfUp(value * 254);
}

export function sizeLine(tenths: number[], unit: Unit): string {
  const nums = unit === "mm"
    ? tenths.map((t) => (t / 10).toFixed(1))
    : tenths.map((t) => ((t / 254)).toFixed(1));
  return `${nums[0]} × ${nums[1]} × ${nums[2]} ${unit}`;
}

export function sizeText(tenths: SizeTenths): { mm: string; in: string } {
  return { mm: sizeLine([tenths.width, tenths.height, tenths.depth], "mm"),
           in: sizeLine([tenths.width, tenths.height, tenths.depth], "in") };
}

// An inch value equal to the stored value's inch display keeps the stored tenths.
export function tenthsFromInchDisplay(tenths: number, inchInput: string): number {
  const value = Number(inchInput.trim());
  return roundHalfUp(value * 254) === tenths ? tenths : roundHalfUp(value * 254);
}

export const SIZE_MAX_TENTHS = 50000;

export function sizeValid(tenths: number): boolean {
  return tenths >= 10 && tenths <= SIZE_MAX_TENTHS;
}

export function unitName(unit: Unit): string {
  return unit === "mm" ? "millimetres" : "inches";
}
