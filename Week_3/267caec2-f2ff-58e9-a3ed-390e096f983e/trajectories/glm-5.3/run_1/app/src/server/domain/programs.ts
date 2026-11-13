import { errors } from "../http/errors.js";
import { isValidDate, isValidZone, windowOpen, deadlineBoundary, deadlineLabel, instantWithZone, embargoLabel } from "./time.js";
import { feeTierAtPayment, feeForTier } from "./entries.js";
import type { Queryable } from "../db.js";
import { rows, row } from "../db.js";

export interface ProgramRow {
  id: string;
  name: string;
  year: number;
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
  early_bird_fee_cents: number;
  standard_fee_cents: number;
  created_at: Date;
}

export interface CategoryRow {
  id: string;
  program_id: string;
  name: string;
  shortlist_size: number;
  finalist_count: number;
  embargo_at: Date | null;
  results_email_at: Date | null;
  published_at: Date | null;
}

export interface RoundRow {
  id: string;
  category_id: string;
  name: string;
  kind: "round_1" | "final";
  state: "scheduled" | "open" | "closed" | "normalised" | "published";
  seq: number;
  ballot_deadline: string | null;
  opened_at: Date | null;
  closed_at: Date | null;
}

export interface ProgramValidation {
  name: string;
  year: number;
  timeZone: string;
  earlyBirdDate: string;
  deadlineDate: string;
  earlyBirdFeeCents: number;
  standardFeeCents: number;
}

/** The single validation for program creation and date edits. */
export function validateProgramInput(input: {
  name?: unknown;
  year?: unknown;
  timeZone?: unknown;
  earlyBirdDate?: unknown;
  deadlineDate?: unknown;
  earlyBirdFeeCents?: unknown;
  standardFeeCents?: unknown;
}): ProgramValidation {
  const fields: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    fields.name = "Program names are 2 to 80 characters.";
  }
  const year = input.year;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    fields.year = "Years run from 2000 to 2100.";
  }
  const timeZone = typeof input.timeZone === "string" ? input.timeZone : "";
  if (!isValidZone(timeZone)) {
    fields.timeZone = "Choose an IANA time zone.";
  }
  const earlyBirdDate = typeof input.earlyBirdDate === "string" ? input.earlyBirdDate : "";
  const deadlineDate = typeof input.deadlineDate === "string" ? input.deadlineDate : "";
  if (!isValidDate(earlyBirdDate)) {
    fields.earlyBirdDate = "Dates use the YYYY-MM-DD format.";
  }
  if (!isValidDate(deadlineDate)) {
    fields.deadlineDate = "Dates use the YYYY-MM-DD format.";
  }
  const earlyBirdFeeCents = input.earlyBirdFeeCents;
  const standardFeeCents = input.standardFeeCents;
  const feeError = "Fees are whole numbers from 100 to 100000 cents.";
  if (typeof earlyBirdFeeCents !== "number" || !Number.isInteger(earlyBirdFeeCents) || earlyBirdFeeCents < 100 || earlyBirdFeeCents > 100000) {
    fields.earlyBirdFeeCents = feeError;
  }
  if (typeof standardFeeCents !== "number" || !Number.isInteger(standardFeeCents) || standardFeeCents < 100 || standardFeeCents > 100000) {
    fields.standardFeeCents = feeError;
  }
  if (!("name" in fields) && typeof earlyBirdFeeCents === "number" && typeof standardFeeCents === "number" && earlyBirdFeeCents > standardFeeCents) {
    fields.standardFeeCents = "The early-bird fee can't be higher than the standard fee.";
  }
  if (!fields.earlyBirdDate && !fields.deadlineDate && earlyBirdDate > deadlineDate) {
    fields.earlyBirdDate = "The early-bird end can't be after the entry deadline.";
  }
  if (Object.keys(fields).length > 0) {
    throw errors.validation(fields);
  }
  return { name, year: input.year as number, timeZone, earlyBirdDate, deadlineDate, earlyBirdFeeCents: input.earlyBirdFeeCents as number, standardFeeCents: input.standardFeeCents as number };
}

export interface CategorySummary {
  id: string;
  name: string;
  shortlistSize: number;
  finalistCount: number;
  rounds: { id: string; name: string; kind: string; state: string }[];
}

export interface ProgramProjection {
  id: string;
  name: string;
  year: number;
  timeZone: string;
  earlyBirdDate: string;
  deadlineDate: string;
  earlyBirdEndsAt: string;
  deadlineAt: string;
  earlyBirdLabel: string;
  deadlineLabel: string;
  earlyBirdFeeCents: number;
  standardFeeCents: number;
  currentTier: "early_bird" | "standard";
  currentFeeCents: number;
  entriesOpen: boolean;
  categories: CategorySummary[];
}

export function projectProgram(program: ProgramRow, categories: CategoryRow[], rounds: RoundRow[], now = new Date()): ProgramProjection {
  const tier = feeTierAtPayment(program, now);
  return {
    id: program.id,
    name: program.name,
    year: program.year,
    timeZone: program.time_zone,
    earlyBirdDate: program.early_bird_date,
    deadlineDate: program.deadline_date,
    earlyBirdEndsAt: instantWithZone(deadlineBoundary(program.early_bird_date, program.time_zone), program.time_zone),
    deadlineAt: instantWithZone(deadlineBoundary(program.deadline_date, program.time_zone), program.time_zone),
    earlyBirdLabel: deadlineLabel(program.early_bird_date, program.time_zone),
    deadlineLabel: deadlineLabel(program.deadline_date, program.time_zone),
    earlyBirdFeeCents: program.early_bird_fee_cents,
    standardFeeCents: program.standard_fee_cents,
    currentTier: tier,
    currentFeeCents: feeForTier(program, tier),
    entriesOpen: windowOpen(program.deadline_date, program.time_zone, now),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      shortlistSize: category.shortlist_size,
      finalistCount: category.finalist_count,
      rounds: rounds
        .filter((r) => r.category_id === category.id)
        .sort((a, b) => a.seq - b.seq)
        .map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state })),
    })),
  };
}

export function projectCategory(category: CategoryRow): { id: string; name: string; shortlistSize: number; finalistCount: number } {
  return { id: category.id, name: category.name, shortlistSize: category.shortlist_size, finalistCount: category.finalist_count };
}

export function programEmbargoLabel(instant: Date, zone: string): string {
  return embargoLabel(instant, zone);
}

/** The open program: entries open with the soonest deadline; tie by created first. */
export async function findOpenProgram(db: Queryable): Promise<ProgramRow | null> {
  const programs = await rows<ProgramRow>(db, "SELECT * FROM programs");
  const open = programs.filter((p) => windowOpen(p.deadline_date, p.time_zone));
  if (open.length === 0) {
    return null;
  }
  open.sort((a, b) => {
    const at = deadlineBoundary(a.deadline_date, a.time_zone).getTime();
    const bt = deadlineBoundary(b.deadline_date, b.time_zone).getTime();
    if (at !== bt) {
      return at - bt;
    }
    return a.created_at.getTime() - b.created_at.getTime();
  });
  return open[0] ?? null;
}

export async function newestProgram(db: Queryable): Promise<ProgramRow | null> {
  return row<ProgramRow>(db, "SELECT * FROM programs ORDER BY year DESC, created_at DESC LIMIT 1");
}

export async function programById(db: Queryable, id: string): Promise<ProgramRow | null> {
  return row<ProgramRow>(db, "SELECT * FROM programs WHERE id = $1", [id]);
}
