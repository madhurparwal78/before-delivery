import { COLOUR_FAMILIES, type ColourFamily } from "../shared/api.js";
import { tenthsAfterEdit, type SizeTenths, type SizeUnit } from "../shared/sizes.js";

export type RawFields = Record<string, unknown>;

export interface Facts {
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string;
  colour_family: ColourFamily;
  source_url: string | null;
  source_note: string;
  notes: string;
  size: SizeTenths;
}

export const COPY = {
  title: "Give the object a name of 1 to 80 characters.",
  maker: "Keep the maker to 80 characters or fewer.",
  materials: "List up to 8 materials of 40 characters or fewer.",
  finish: "Keep the finish to 80 characters or fewer.",
  colour_family: "Choose a colour family.",
  source_url: "Enter a link that starts with http:// or https://.",
  source_note: "Keep this to 120 characters or fewer.",
  notes: "Keep notes to 2000 characters or fewer.",
  size: "Enter a size above 0 and up to 5000.0 mm (196.9 in).",
  point: "Pick a point on the photograph.",
  unit: "Choose millimetres or inches.",
  version: "Send the reference's current version number.",
} as const;

const SIZE_KEYS = ["width", "height", "depth"] as const;
const length = (text: string): number => Array.from(text).length;

function text(raw: RawFields, key: string): string {
  const value = raw[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseYear(raw: string, latest: number): number | null | undefined {
  if (raw === "") return null;
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  const year = Number(raw);
  return year >= 1800 && year <= latest ? year : undefined;
}

function parseMaterials(value: unknown): string[] | null {
  const entries = (Array.isArray(value) ? value.map(String) : String(value ?? "").split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.length <= 8 && entries.every((entry) => length(entry) <= 40) ? entries : null;
}

interface FactsContext {
  /** The server clock's year in the effective home zone. */
  latestYear: number;
  /** Stored facts an edit starts from; null for a capture, where every required field must be sent. */
  stored: { facts: Facts; unit?: undefined } | null;
}

interface ParsedFacts {
  facts: Partial<Facts>;
  errors: Record<string, string>;
}

/** Reads the capture or edit fields once: what is valid becomes `facts`, what is not becomes a per-field message. */
export function parseFacts(raw: RawFields, { latestYear, stored }: FactsContext): ParsedFacts {
  const facts: Partial<Facts> = {};
  const errors: Record<string, string> = {};
  const given = (key: string): boolean => (stored ? key in raw : true);

  if (given("title")) {
    const title = text(raw, "title");
    if (length(title) < 1 || length(title) > 80) errors.title = COPY.title;
    else facts.title = title;
  }
  if (given("maker")) {
    const maker = text(raw, "maker");
    if (length(maker) > 80) errors.maker = COPY.maker;
    else facts.maker = maker === "" ? null : maker;
  }
  if (given("year")) {
    const year = parseYear(text(raw, "year"), latestYear);
    if (year === undefined) errors.year = `Enter a year from 1800 to ${latestYear}.`;
    else facts.year = year;
  }
  if (given("materials")) {
    const materials = parseMaterials(raw.materials);
    if (materials === null) errors.materials = COPY.materials;
    else facts.materials = materials;
  }
  if (given("finish")) {
    const finish = text(raw, "finish");
    if (length(finish) > 80) errors.finish = COPY.finish;
    else facts.finish = finish;
  }
  if (given("colour_family")) {
    const family = text(raw, "colour_family");
    if (!(COLOUR_FAMILIES as readonly string[]).includes(family)) errors.colour_family = COPY.colour_family;
    else facts.colour_family = family as ColourFamily;
  }
  if (given("source_url")) {
    const link = text(raw, "source_url");
    if (link !== "" && (length(link) > 500 || !/^https?:\/\//.test(link))) errors.source_url = COPY.source_url;
    else facts.source_url = link === "" ? null : link;
  }
  if (given("source_note")) {
    const note = text(raw, "source_note");
    if (length(note) > 120) errors.source_note = COPY.source_note;
    else facts.source_note = note;
  }
  if (given("notes")) {
    const notes = text(raw, "notes");
    if (length(notes) > 2000) errors.notes = COPY.notes;
    else facts.notes = notes;
  }

  const sizeGiven = SIZE_KEYS.some((key) => given(key));
  if (sizeGiven) {
    const unit = text(raw, "unit");
    const unitValid = unit === "mm" || unit === "in";
    if (!unitValid) errors.unit = COPY.unit;
    const size: Partial<SizeTenths> = {};
    for (const key of SIZE_KEYS) {
      if (!given(key)) continue;
      const tenths = unitValid ? tenthsAfterEdit(text(raw, key), unit as SizeUnit, stored?.facts.size[key] ?? null) : null;
      if (tenths === null) errors[key] = COPY.size;
      else size[key] = tenths;
    }
    if (Object.keys(errors).every((key) => !SIZE_KEYS.some((sizeKey) => sizeKey === key))) {
      facts.size = { ...stored?.facts.size, ...size } as SizeTenths;
    }
  }
  return { facts, errors };
}

/** A point on the upright photograph: both fractions from 0 to 1. */
export function parsePoint(rawX: unknown, rawY: unknown, keys: readonly [string, string]): { point: { x: number; y: number } | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const read = (value: unknown, key: string): number => {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (!(number >= 0 && number <= 1)) errors[key] = COPY.point;
    return number;
  };
  const x = read(rawX, keys[0]);
  const y = read(rawY, keys[1]);
  return { point: Object.keys(errors).length === 0 ? { x, y } : null, errors };
}
