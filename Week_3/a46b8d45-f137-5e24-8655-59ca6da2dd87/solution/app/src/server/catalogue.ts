import { type Db, one, rows } from "./db";
import { failFields } from "./errors";
import { integerIn, isObject } from "./parse";
import { BOOKLET_RANGE } from "./rules";
import type { CatalogueModel, CatalogueModelDetail, EditionView, ImportReport } from "../shared/types";
import { isValidCalendarDate, today } from "./clock";

interface ModelRow {
  slug: string;
  name: string;
  axis: CatalogueModel["axis"];
  retired_names: string[];
}

// ---- models --------------------------------------------------------------------------------

export async function listModels(db: Db): Promise<CatalogueModel[]> {
  const found = await rows<ModelRow & { part_count: number }>(
    db,
    "SELECT m.slug, m.name, m.axis, m.retired_names, (SELECT count(*)::int FROM parts p WHERE p.model_slug = m.slug) AS part_count FROM models m ORDER BY m.slug COLLATE \"C\"",
  );
  return found.map((model) => ({ slug: model.slug, name: model.name, axis: model.axis, diagram: model.axis !== null, part_count: model.part_count }));
}

export async function modelDetail(db: Db, slug: string): Promise<CatalogueModelDetail | null> {
  const model = await one<ModelRow>(db, "SELECT slug, name, axis, retired_names FROM models WHERE slug = $1", [slug]);
  if (!model) return null;
  const parts = await rows<{ booklet_number: number; part_number: string; name: string; longest_side_mm: number; status: "active" | "withdrawn" }>(
    db,
    "SELECT booklet_number, part_number, name, longest_side_mm, status FROM parts WHERE model_slug = $1 ORDER BY booklet_number",
    [slug],
  );
  return { slug: model.slug, name: model.name, axis: model.axis, diagram: model.axis !== null, parts };
}

// ---- model name matching -------------------------------------------------------------------

const SUPPLIER_CODE = /[\s/-]+[a-z]{2,4}\d{2,4}$/i;

/** Lower-case, hyphens to spaces, runs of spaces collapsed, trimmed. */
const normaliseName = (name: string): string => name.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** Removes a trailing supplier code (2 to 4 letters then 2 to 4 digits) before normalising. */
const supplierName = (name: string): string => normaliseName(name.replace(SUPPLIER_CODE, ""));

type ModelMatch = { kind: "matched"; slug: string } | { kind: "unknown_model" } | { kind: "ambiguous_model" };

function matchModel(models: readonly ModelRow[], supplierModelName: string): ModelMatch {
  const wanted = supplierName(supplierModelName);
  const hits = models.filter((model) => [model.name, ...model.retired_names].some((name) => normaliseName(name) === wanted));
  if (hits.length === 1 && hits[0]) return { kind: "matched", slug: hits[0].slug };
  return { kind: hits.length === 0 ? "unknown_model" : "ambiguous_model" };
}

// ---- supplier import -----------------------------------------------------------------------

const IMPORT_HEADER = "model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status";

/** One CSV record per line; a field may be wrapped in double quotes. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(current);
      current = "";
    } else current += c;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

type RowCheck = { ok: true; row: ImportRow } | { ok: false; reason: string };

interface ImportRow {
  slug: string;
  booklet: number;
  partNumber: string;
  name: string;
  priceMinor: number;
  weightG: number;
  sideMm: number;
  status: "active" | "withdrawn";
}

const WHOLE = /^\d+$/;

function checkRow(fields: string[], models: readonly ModelRow[]): RowCheck {
  const [modelName = "", booklet = "", partNumber = "", name = "", price = "", weight = "", side = "", status = ""] = fields;
  if (fields.length < 8 || [modelName, booklet, partNumber, name, price, weight, side, status].some((field) => field === "")) return { ok: false, reason: "missing_field" };
  const match = matchModel(models, modelName);
  if (match.kind !== "matched") return { ok: false, reason: match.kind };
  const bookletNumber = WHOLE.test(booklet) ? integerIn(booklet, ...BOOKLET_RANGE) : "invalid";
  if (typeof bookletNumber !== "number") return { ok: false, reason: "bad_booklet_number" };
  if (!/^(\d{6}|\d{8})$/.test(partNumber)) return { ok: false, reason: "bad_part_number" };
  const priceMatch = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price);
  const priceMinor = priceMatch ? Number(priceMatch[1]) * 100 + Number((priceMatch[2] ?? "").padEnd(2, "0")) : 0;
  if (priceMinor < 1) return { ok: false, reason: "bad_price" };
  if (!WHOLE.test(weight) || Number(weight) < 1) return { ok: false, reason: "bad_weight" };
  if (!WHOLE.test(side) || Number(side) < 1) return { ok: false, reason: "bad_size" };
  if (status !== "active" && status !== "withdrawn") return { ok: false, reason: "bad_status" };
  return { ok: true, row: { slug: match.slug, booklet: bookletNumber, partNumber, name, priceMinor, weightG: Number(weight), sideMm: Number(side), status } };
}

export async function importSupplierFile(db: Db, csv: string): Promise<ImportReport | null> {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== IMPORT_HEADER) return null;
  const models = await rows<ModelRow>(db, "SELECT slug, name, axis, retired_names FROM models");
  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, unmatched: [] };
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const checked = checkRow(csvFields(line), models);
    const identity = checked.ok ? `${checked.row.slug}#${checked.row.booklet}` : "";
    if (!checked.ok || seen.has(identity)) {
      report.unmatched.push({ line: index + 1, reason: checked.ok ? "duplicate_row" : checked.reason });
      continue;
    }
    seen.add(identity);
    const { row } = checked;
    const existing = await one<{ part_number: string; name: string; price_minor: number; weight_g: number; longest_side_mm: number; status: string }>(
      db,
      "SELECT part_number, name, price_minor, weight_g, longest_side_mm, status FROM parts WHERE model_slug = $1 AND booklet_number = $2 FOR UPDATE",
      [row.slug, row.booklet],
    );
    if (!existing) {
      await rows(db, "INSERT INTO parts (model_slug, booklet_number, part_number, name, price_minor, weight_g, longest_side_mm, status, bin_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)", [
        row.slug, row.booklet, row.partNumber, row.name, row.priceMinor, row.weightG, row.sideMm, row.status,
      ]);
      report.created += 1;
    } else if (
      existing.part_number !== row.partNumber || existing.name !== row.name || existing.price_minor !== row.priceMinor ||
      existing.weight_g !== row.weightG || existing.longest_side_mm !== row.sideMm || existing.status !== row.status
    ) {
      await rows(db, "UPDATE parts SET part_number = $3, name = $4, price_minor = $5, weight_g = $6, longest_side_mm = $7, status = $8 WHERE model_slug = $1 AND booklet_number = $2", [
        row.slug, row.booklet, row.partNumber, row.name, row.priceMinor, row.weightG, row.sideMm, row.status,
      ]);
      report.updated += 1;
    } else report.unchanged += 1;
  }
  return report;
}

// ---- public parts list -----------------------------------------------------------------------

interface PartListRow {
  model: string;
  booklet_number: number;
  part_number: string;
  name: string;
  price_minor: number;
  status: "active" | "withdrawn";
}

function encodeCursor(row: Pick<PartListRow, "model" | "booklet_number" | "part_number">): string {
  return Buffer.from(JSON.stringify([row.model, row.booklet_number, row.part_number])).toString("base64url");
}

export function decodeCursor(text: string): [string, number, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === "string" && Number.isInteger(value[1]) && typeof value[2] === "string") {
      return [value[0], value[1] as number, value[2]];
    }
  } catch {
    return null;
  }
  return null;
}

export async function listParts(db: Db, model: string | null, limit: number, after: [string, number, string] | null): Promise<{ parts: PartListRow[]; next: string | null }> {
  const found = await rows<PartListRow>(
    db,
    `SELECT model_slug AS model, booklet_number, part_number, name, price_minor, status FROM parts
     WHERE ($1::text IS NULL OR model_slug = $1)
       AND ($2::text IS NULL OR (model_slug COLLATE "C", booklet_number, part_number COLLATE "C") > ($2::text COLLATE "C", $3::int, $4::text COLLATE "C"))
     ORDER BY model_slug COLLATE "C", booklet_number, part_number COLLATE "C" LIMIT $5`,
    [model, after?.[0] ?? null, after?.[1] ?? null, after?.[2] ?? null, limit + 1],
  );
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return { parts: page, next: found.length > limit && last ? encodeCursor(last) : null };
}

// ---- editions --------------------------------------------------------------------------------

export function listEditions(db: Db): Promise<EditionView[]> {
  return rows<EditionView>(db, "SELECT code, title, starts_on, standard_months, club_months, owner_contribution_percent FROM editions ORDER BY starts_on");
}

export function readEdition(body: unknown): EditionView {
  const input = isObject(body) ? body : {};
  const fields: Record<string, string> = {};
  const text = (name: string): string => (typeof input[name] === "string" ? (input[name] as string) : "");
  const code = text("code");
  if (code === "") fields["code"] = "required";
  else if (!/^[A-Z0-9-]{3,20}$/.test(code)) fields["code"] = "invalid";
  const title = text("title");
  if (title.trim() === "") fields["title"] = "required";
  else if ([...title].length > 80) fields["title"] = "too_long";
  const startsOn = text("starts_on");
  if (startsOn === "") fields["starts_on"] = "required";
  else if (!isValidCalendarDate(startsOn)) fields["starts_on"] = "invalid";
  else if (startsOn <= today()) fields["starts_on"] = "must_be_future";
  const standard = integerIn(input["standard_months"], 1, 120);
  const club = integerIn(input["club_months"], 1, 120);
  const percent = integerIn(input["owner_contribution_percent"], 0, 100);
  if (typeof standard === "string") fields["standard_months"] = standard;
  if (typeof club === "string") fields["club_months"] = club;
  if (typeof percent === "string") fields["owner_contribution_percent"] = percent;
  if (Object.keys(fields).length > 0) return failFields(fields);
  return { code, title: title.trim(), starts_on: startsOn, standard_months: standard as number, club_months: club as number, owner_contribution_percent: percent as number };
}
