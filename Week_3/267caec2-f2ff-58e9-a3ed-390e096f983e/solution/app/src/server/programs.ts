import { randomUUID } from "node:crypto";
import { recordAudit } from "./audit.js";
import { optionalUser, requireRole, requireUser } from "./auth.js";
import { type Db, isUniqueViolation, many, one, pool, tx } from "./db.js";
import { FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { panelRows } from "./panel.js";
import { ENTRY_STATES, entriesOpen, feeInEffect } from "./rules.js";
import { cutoff, deadlineLabel, isDate, isTimeZone, isoInZone } from "./time.js";
import { text, wholeNumber } from "./validate.js";

// Programs and categories (brief: API, Programs and categories).

interface ProgramRow {
  id: string;
  name: string;
  year: number;
  time_zone: string;
  early_bird_date: string;
  deadline_date: string;
  early_bird_fee_cents: number;
  standard_fee_cents: number;
}

export interface CategoryRow {
  id: string;
  program_id: string;
  name: string;
  shortlist_size: number;
  finalist_count: number;
  embargo_at: Date | null;
}

export interface RoundRow {
  id: string;
  category_id: string;
  kind: "round_1" | "final";
  name: string;
  state: string;
  ballot_deadline: string | null;
  opened_at: Date | null;
  closed_at: Date | null;
}

const PROGRAM_COLUMNS = "p.id, p.name, p.year, p.time_zone, p.early_bird_date, p.deadline_date, p.early_bird_fee_cents, p.standard_fee_cents";
export const CATEGORY_COLUMNS = "c.id, c.program_id, c.name, c.shortlist_size, c.finalist_count, c.embargo_at";
export const ROUND_COLUMNS = "r.id, r.category_id, r.kind, r.name, r.state, r.ballot_deadline, r.opened_at, r.closed_at";

export async function programById(db: Db, id: string): Promise<ProgramRow | null> {
  return one<ProgramRow>(db, `SELECT ${PROGRAM_COLUMNS} FROM programs p WHERE p.id = $1`, [id]);
}

export async function categoryById(db: Db, id: string): Promise<CategoryRow | null> {
  return one<CategoryRow>(db, `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id = $1`, [id]);
}

async function categoryRounds(db: Db, categoryIds: string[]): Promise<RoundRow[]> {
  return many<RoundRow>(db, `SELECT ${ROUND_COLUMNS} FROM rounds r WHERE r.category_id = ANY($1)
    ORDER BY r.kind = 'final', r.id`, [categoryIds]);
}

/** Newest year first, newest created first within a year. */
async function allPrograms(): Promise<ProgramRow[]> {
  return many<ProgramRow>(pool, `SELECT ${PROGRAM_COLUMNS} FROM programs p ORDER BY p.year DESC, p.seq DESC`);
}

/** The Program projection; directors also see each category's rounds. */
function programView(program: ProgramRow, categories: CategoryRow[], rounds: RoundRow[] | null, now: Date) {
  const zone = program.time_zone;
  const fee = feeInEffect(program, now);
  return {
    id: program.id,
    name: program.name,
    year: program.year,
    timeZone: zone,
    earlyBirdDate: program.early_bird_date,
    deadlineDate: program.deadline_date,
    earlyBirdEndsAt: isoInZone(cutoff(program.early_bird_date, zone), zone),
    deadlineAt: isoInZone(cutoff(program.deadline_date, zone), zone),
    earlyBirdLabel: deadlineLabel(program.early_bird_date, zone),
    deadlineLabel: deadlineLabel(program.deadline_date, zone),
    earlyBirdFeeCents: program.early_bird_fee_cents,
    standardFeeCents: program.standard_fee_cents,
    currentTier: fee.tier,
    currentFeeCents: fee.amountCents,
    entriesOpen: entriesOpen(program, now),
    categories: categories.filter((c) => c.program_id === program.id).map((c) => categoryView(c, rounds)),
  };
}

function categoryView(category: CategoryRow, rounds: RoundRow[] | null) {
  const base = { id: category.id, name: category.name, shortlistSize: category.shortlist_size, finalistCount: category.finalist_count };
  if (!rounds) return base;
  return {
    ...base,
    rounds: rounds.filter((r) => r.category_id === category.id).map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state })),
  };
}

async function programPayload(db: Db, program: ProgramRow, director: boolean) {
  const categories = await many<CategoryRow>(db, `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.program_id = $1 ORDER BY c.seq`, [program.id]);
  const rounds = director ? await categoryRounds(db, categories.map((c) => c.id)) : null;
  return programView(program, categories, rounds, new Date());
}

export async function listPrograms(req: ApiRequest): Promise<ApiResult> {
  const user = await optionalUser(req);
  const programs = await allPrograms();
  const categories = await many<CategoryRow>(pool, `SELECT ${CATEGORY_COLUMNS} FROM categories c ORDER BY c.seq`);
  const rounds = user?.role === "director" ? await categoryRounds(pool, categories.map((c) => c.id)) : null;
  const now = new Date();
  return { status: 200, json: { programs: programs.map((p) => programView(p, categories, rounds, now)) } };
}

function checkDates(errors: FieldErrors, earlyBird: unknown, deadline: unknown): void {
  errors.check(isDate(earlyBird), "earlyBirdDate", "Give the early-bird date as a calendar date.");
  errors.check(isDate(deadline), "deadlineDate", "Give the entry deadline as a calendar date.");
  if (isDate(earlyBird) && isDate(deadline)) {
    errors.check(earlyBird <= deadline, "earlyBirdDate", "The early-bird date can't be after the entry deadline.");
  }
}

export async function createProgram(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  requireRole(user, "director");
  const b = req.body;
  const errors = new FieldErrors();
  const name = text(b.name, 2, 80);
  errors.check(name !== null, "name", "Give a program name of 2 to 80 characters.");
  errors.check(wholeNumber(b.year, 2000, 2100), "year", "Give a year from 2000 to 2100.");
  errors.check(isTimeZone(b.timeZone), "timeZone", "Choose an IANA time zone such as Europe/Lisbon.");
  checkDates(errors, b.earlyBirdDate, b.deadlineDate);
  const feeCopy = "Fees are whole cents from 100 to 100000.";
  errors.check(wholeNumber(b.earlyBirdFeeCents, 100, 100000), "earlyBirdFeeCents", feeCopy);
  errors.check(wholeNumber(b.standardFeeCents, 100, 100000), "standardFeeCents", feeCopy);
  if (wholeNumber(b.earlyBirdFeeCents, 100, 100000) && wholeNumber(b.standardFeeCents, 100, 100000)) {
    errors.check(b.earlyBirdFeeCents <= b.standardFeeCents, "earlyBirdFeeCents", "The early-bird fee can't be above the standard fee.");
  }
  errors.throwIfAny();
  const id = randomUUID();
  const program = await tx(async (client) => {
    await client.query(
      `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date, early_bird_fee_cents, standard_fee_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, b.year, b.timeZone, b.earlyBirdDate, b.deadlineDate, b.earlyBirdFeeCents, b.standardFeeCents]);
    await recordAudit(client, "program.create", "program", id, { name });
    return programPayload(client, (await programById(client, id)) as ProgramRow, true);
  });
  return { status: 201, json: { program } };
}

/** 409 judging_started once any round of the program has left scheduled. */
async function guardJudgingNotStarted(db: Db, programId: string): Promise<void> {
  const started = await one(db, `SELECT 1 FROM rounds r JOIN categories c ON c.id = r.category_id
    WHERE c.program_id = $1 AND r.state <> 'scheduled' LIMIT 1`, [programId]);
  if (started) throw refuse("judging_started");
}

async function directorProgram(req: ApiRequest, db: Db): Promise<ProgramRow> {
  const user = await requireUser(req);
  const program = await programById(db, req.params.id ?? "");
  if (!program) throw refuse("not_found");
  requireRole(user, "director");
  return program;
}

export async function updateProgram(req: ApiRequest): Promise<ApiResult> {
  const program = await tx(async (client) => {
    const found = await directorProgram(req, client);
    await client.query("SELECT 1 FROM programs WHERE id = $1 FOR UPDATE", [found.id]);
    await guardJudgingNotStarted(client, found.id);
    const earlyBird = req.body.earlyBirdDate ?? found.early_bird_date;
    const deadline = req.body.deadlineDate ?? found.deadline_date;
    const errors = new FieldErrors();
    checkDates(errors, earlyBird, deadline);
    errors.throwIfAny();
    await client.query("UPDATE programs SET early_bird_date = $2, deadline_date = $3 WHERE id = $1", [found.id, earlyBird, deadline]);
    await recordAudit(client, "program.update", "program", found.id, { earlyBirdDate: earlyBird, deadlineDate: deadline });
    return programPayload(client, (await programById(client, found.id)) as ProgramRow, true);
  });
  return { status: 200, json: { program } };
}

export async function addCategory(req: ApiRequest): Promise<ApiResult> {
  const category = await tx(async (client) => {
    const program = await directorProgram(req, client);
    await client.query("SELECT 1 FROM programs WHERE id = $1 FOR UPDATE", [program.id]);
    await guardJudgingNotStarted(client, program.id);
    const b = req.body;
    if (typeof b.name === "string" && await one(client,
      "SELECT 1 FROM categories WHERE program_id = $1 AND lower(name) = lower($2)", [program.id, b.name.trim()])) {
      throw refuse("category_exists");
    }
    const errors = new FieldErrors();
    const name = text(b.name, 2, 60);
    errors.check(name !== null, "name", "Give a category name of 2 to 60 characters.");
    errors.check(wholeNumber(b.shortlistSize, 1, 50), "shortlistSize", "Give a shortlist size from 1 to 50.");
    const shortlist = wholeNumber(b.shortlistSize, 1, 50) ? b.shortlistSize : 50;
    errors.check(wholeNumber(b.finalistCount, 1, shortlist), "finalistCount", "Give a finalist count from 1 to the shortlist size.");
    errors.throwIfAny();
    const id = randomUUID();
    try {
      await client.query("INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5)",
        [id, program.id, name, b.shortlistSize, b.finalistCount]);
    } catch (error) {
      throw isUniqueViolation(error) ? refuse("category_exists") : error;
    }
    await client.query(`INSERT INTO rounds (id, category_id, kind, name) VALUES ($1, $3, 'round_1', 'Round 1'), ($2, $3, 'final', 'Final round')`,
      [randomUUID(), randomUUID(), id]);
    await recordAudit(client, "category.create", "category", id, { name, programId: program.id });
    const [row] = await many<CategoryRow>(client, `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id = $1`, [id]);
    return categoryView(row as CategoryRow, await categoryRounds(client, [id]));
  });
  return { status: 201, json: { category } };
}

export async function programSummary(req: ApiRequest): Promise<ApiResult> {
  const program = await directorProgram(req, pool);
  const categories = await many<CategoryRow>(pool, `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.program_id = $1 ORDER BY c.seq`, [program.id]);
  const counts = await many<{ category_id: string; state: string; n: number }>(pool,
    "SELECT category_id, state, count(*)::int AS n FROM entries WHERE program_id = $1 GROUP BY category_id, state", [program.id]);
  const rounds = await categoryRounds(pool, categories.map((c) => c.id));
  const summary = [];
  for (const category of categories) {
    const tally = Object.fromEntries(ENTRY_STATES.map((s) => [s, 0]));
    for (const row of counts) if (row.category_id === category.id) tally[row.state] = row.n;
    const categoryRoundsWithPanel = [];
    for (const round of rounds.filter((r) => r.category_id === category.id)) {
      categoryRoundsWithPanel.push({ id: round.id, name: round.name, state: round.state, panel: await panelRows(pool, round) });
    }
    summary.push({ id: category.id, name: category.name, counts: tally, rounds: categoryRoundsWithPanel });
  }
  return { status: 200, json: { categories: summary } };
}
