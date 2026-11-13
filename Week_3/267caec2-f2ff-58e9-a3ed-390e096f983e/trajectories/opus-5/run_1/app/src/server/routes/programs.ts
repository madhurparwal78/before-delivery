import { categoryExists, judgingStarted, notFound } from '../copy';
import { categoriesOf, loadProgram, panelOf, roundsOf, writeAudit } from '../data';
import { newId, pool } from '../db';
import { isTimeZone, parseDate } from '../domain/time';
import type { CategoryRow, EntryState, ProgramRow } from '../domain/types';
import { json, requireRole, route, type Ctx, type Reply } from '../http/router';
import { integer, Problems, text } from '../http/validate';
import { categoryJson, programJson } from '../view';

const ENTRY_STATES: EntryState[] = [
  'draft',
  'submitted',
  'screened',
  'disqualified',
  'withdrawn',
  'round_1',
  'shortlisted',
  'eliminated',
  'final_round',
  'winner',
  'finalist',
  'honourable_mention',
  'published',
];

async function programBody(program: ProgramRow, asDirector: boolean, now: Date): Promise<Record<string, unknown>> {
  const categories = await categoriesOf(pool, program.id);
  const shaped = [];
  for (const category of categories) {
    shaped.push(categoryJson(category, asDirector ? await roundsOf(pool, category.id) : null));
  }
  return programJson(program, shaped, now);
}

async function judgingLocked(programId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM rounds r JOIN categories c ON c.id = r.category_id
     WHERE c.program_id = $1 AND r.state <> 'scheduled' LIMIT 1`,
    [programId],
  );
  return result.rowCount !== 0;
}

async function listPrograms(ctx: Ctx): Promise<Reply> {
  const now = new Date();
  const asDirector = ctx.actor?.role === 'director';
  const result = await pool.query<ProgramRow>('SELECT * FROM programs ORDER BY year DESC, seq DESC');
  const programs = [];
  for (const program of result.rows) {
    programs.push(await programBody(program, asDirector, now));
  }
  return json(200, { programs });
}

function validateDates(problems: Problems, earlyBird: string, deadline: string): void {
  const early = parseDate(earlyBird);
  const close = parseDate(deadline);
  problems.check(early !== null, 'earlyBirdDate', 'Give a date as YYYY-MM-DD.');
  problems.check(close !== null, 'deadlineDate', 'Give a date as YYYY-MM-DD.');
  if (early !== null && close !== null && earlyBird > deadline) {
    problems.add('earlyBirdDate', 'Early-bird must end on or before the entry deadline.');
  }
}

async function createProgram(ctx: Ctx): Promise<Reply> {
  const actor = requireRole(ctx, 'director');
  const name = text(ctx.body, 'name');
  const year = integer(ctx.body, 'year');
  const timeZone = text(ctx.body, 'timeZone');
  const earlyBirdDate = text(ctx.body, 'earlyBirdDate');
  const deadlineDate = text(ctx.body, 'deadlineDate');
  const earlyBirdFeeCents = integer(ctx.body, 'earlyBirdFeeCents');
  const standardFeeCents = integer(ctx.body, 'standardFeeCents');

  const problems = new Problems();
  problems.check(name.length >= 2 && name.length <= 80, 'name', 'Give a program name of 2 to 80 characters.');
  problems.check(year !== null && year >= 2000 && year <= 2100, 'year', 'Give a year from 2000 to 2100.');
  problems.check(isTimeZone(timeZone) && timeZone.includes('/'), 'timeZone', 'Choose an IANA time zone.');
  validateDates(problems, earlyBirdDate, deadlineDate);
  problems.check(
    earlyBirdFeeCents !== null && earlyBirdFeeCents >= 100 && earlyBirdFeeCents <= 100000,
    'earlyBirdFeeCents',
    'Give a fee from $1.00 to $1,000.00.',
  );
  problems.check(
    standardFeeCents !== null && standardFeeCents >= 100 && standardFeeCents <= 100000,
    'standardFeeCents',
    'Give a fee from $1.00 to $1,000.00.',
  );
  if (earlyBirdFeeCents !== null && standardFeeCents !== null && earlyBirdFeeCents > standardFeeCents) {
    problems.add('earlyBirdFeeCents', 'The early-bird fee cannot be above the standard fee.');
  }
  problems.throwIfAny();

  const id = newId('prg');
  const inserted = await pool.query<ProgramRow>(
    `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date,
       early_bird_fee_cents, standard_fee_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, name, year, timeZone, earlyBirdDate, deadlineDate, earlyBirdFeeCents, standardFeeCents],
  );
  await writeAudit(pool, actor.id, 'program.create', 'program', id, { name });
  return json(201, { program: await programBody(inserted.rows[0], true, new Date()) });
}

async function updateProgram(ctx: Ctx): Promise<Reply> {
  const program = await loadProgram(pool, ctx.params.id);
  if (program === null) throw notFound();
  const actor = requireRole(ctx, 'director');
  if (await judgingLocked(program.id)) throw judgingStarted();

  const earlyBirdDate = 'earlyBirdDate' in ctx.body ? text(ctx.body, 'earlyBirdDate') : program.early_bird_date;
  const deadlineDate = 'deadlineDate' in ctx.body ? text(ctx.body, 'deadlineDate') : program.deadline_date;
  const problems = new Problems();
  validateDates(problems, earlyBirdDate, deadlineDate);
  problems.throwIfAny();

  const updated = await pool.query<ProgramRow>(
    'UPDATE programs SET early_bird_date = $2, deadline_date = $3 WHERE id = $1 RETURNING *',
    [program.id, earlyBirdDate, deadlineDate],
  );
  await writeAudit(pool, actor.id, 'program.update', 'program', program.id, { earlyBirdDate, deadlineDate });
  return json(200, { program: await programBody(updated.rows[0], true, new Date()) });
}

async function addCategory(ctx: Ctx): Promise<Reply> {
  const program = await loadProgram(pool, ctx.params.id);
  if (program === null) throw notFound();
  const actor = requireRole(ctx, 'director');
  if (await judgingLocked(program.id)) throw judgingStarted();

  const name = text(ctx.body, 'name');
  const shortlistSize = integer(ctx.body, 'shortlistSize');
  const finalistCount = integer(ctx.body, 'finalistCount');

  const clash = await pool.query('SELECT 1 FROM categories WHERE program_id = $1 AND lower(name) = lower($2)', [
    program.id,
    name,
  ]);
  if (clash.rowCount !== 0) throw categoryExists();

  const problems = new Problems();
  problems.check(name.length >= 2 && name.length <= 60, 'name', 'Give a category name of 2 to 60 characters.');
  problems.check(
    shortlistSize !== null && shortlistSize >= 1 && shortlistSize <= 50,
    'shortlistSize',
    'Give a shortlist size from 1 to 50.',
  );
  problems.check(
    finalistCount !== null && finalistCount >= 1 && (shortlistSize === null || finalistCount <= shortlistSize),
    'finalistCount',
    'Give a finalist count from 1 to the shortlist size.',
  );
  problems.throwIfAny();

  const id = newId('cat');
  const inserted = await pool.query<CategoryRow>(
    'INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, program.id, name, shortlistSize, finalistCount],
  );
  await pool.query(
    `INSERT INTO rounds (id, category_id, name, kind) VALUES ($1, $2, 'Round 1', 'round_1'), ($3, $2, 'Final round', 'final')`,
    [newId('rnd'), id, newId('rnd')],
  );
  await writeAudit(pool, actor.id, 'category.create', 'category', id, { name });
  return json(201, { category: categoryJson(inserted.rows[0], await roundsOf(pool, id)) });
}

async function programSummary(ctx: Ctx): Promise<Reply> {
  const program = await loadProgram(pool, ctx.params.id);
  if (program === null) throw notFound();
  requireRole(ctx, 'director');

  const categories = await categoriesOf(pool, program.id);
  const shaped = [];
  for (const category of categories) {
    const counts = await pool.query<{ state: EntryState; n: string }>(
      'SELECT state, count(*) AS n FROM entries WHERE category_id = $1 GROUP BY state',
      [category.id],
    );
    const tally: Record<string, number> = {};
    for (const state of ENTRY_STATES) tally[state] = 0;
    for (const row of counts.rows) tally[row.state] = Number(row.n);
    const rounds = await roundsOf(pool, category.id);
    const roundBodies = [];
    for (const round of rounds) {
      roundBodies.push({
        id: round.id,
        name: round.name,
        state: round.state,
        panel: await panelOf(pool, round),
      });
    }
    shaped.push({ id: category.id, name: category.name, counts: tally, rounds: roundBodies });
  }
  return json(200, { categories: shaped });
}

export const programRoutes = [
  route('GET', '/api/programs', listPrograms),
  route('POST', '/api/programs', createProgram),
  route('PATCH', '/api/programs/:id', updateProgram),
  route('POST', '/api/programs/:id/categories', addCategory),
  route('GET', '/api/programs/:id/summary', programSummary),
];
