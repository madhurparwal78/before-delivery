import { categoriesOf, embargoPassed, loadProgram, roundsOf } from '../data';
import { pool } from '../db';
import { momentLabel, withOffset } from '../domain/time';
import type { CategoryRow, ProgramRow } from '../domain/types';
import { invalid } from '../http/errors';
import { json, route, type Ctx, type Reply } from '../http/router';

const AWARD_ORDER: Record<string, number> = { winner: 0, finalist: 1, honourable_mention: 2 };

interface GalleryRow {
  entry_number: number;
  title: string;
  studio_name: string;
  program_name: string;
  year: number;
  category: string;
  award: string;
  score: string | null;
  category_id: string;
  entry_id: string;
}

async function gallery(ctx: Ctx): Promise<Reply> {
  const award = ctx.query.get('award');
  if (award !== null && !(award in AWARD_ORDER)) throw invalid({ award: 'Choose a known award level.' });
  const year = ctx.query.get('year');
  const category = ctx.query.get('category');

  const result = await pool.query<GalleryRow>(
    `SELECT e.id AS entry_id, e.entry_number, e.title, s.name AS studio_name, p.name AS program_name,
            p.year, c.name AS category, e.award, rr.score, c.id AS category_id
     FROM entries e
     JOIN studios s ON s.id = e.studio_id
     JOIN categories c ON c.id = e.category_id
     JOIN programs p ON p.id = e.program_id
     JOIN rounds r ON r.category_id = c.id AND r.kind = 'final'
     LEFT JOIN round_results rr ON rr.round_id = r.id AND rr.entry_id = e.id
     WHERE e.award IS NOT NULL AND c.published = true AND c.embargo_at <= now()`,
  );
  const filtered = result.rows.filter(
    (row) =>
      (year === null || String(row.year) === year) &&
      (category === null || row.category.toLowerCase() === category.toLowerCase()) &&
      (award === null || row.award === award),
  );
  filtered.sort(
    (a, b) =>
      b.year - a.year ||
      a.category.localeCompare(b.category) ||
      AWARD_ORDER[a.award] - AWARD_ORDER[b.award] ||
      Number(b.score ?? 0) - Number(a.score ?? 0),
  );
  const items = [];
  for (const row of filtered) {
    const assets = await pool.query<{ id: string }>('SELECT id FROM assets WHERE entry_id = $1 ORDER BY seq', [
      row.entry_id,
    ]);
    items.push({
      entryNumber: row.entry_number,
      title: row.title,
      studioName: row.studio_name,
      programName: row.program_name,
      year: row.year,
      category: row.category,
      award: row.award,
      score: row.score === null ? null : Number(row.score).toFixed(2),
      images: assets.rows.map((asset) => `/api/assets/${asset.id}`),
    });
  }
  return json(200, { items });
}

async function defaultProgram(): Promise<ProgramRow | null> {
  const withResults = await pool.query<ProgramRow>(
    `SELECT p.* FROM programs p
     WHERE EXISTS (SELECT 1 FROM categories c WHERE c.program_id = p.id AND c.published = true)
     ORDER BY p.year DESC, p.seq DESC LIMIT 1`,
  );
  if (withResults.rowCount !== 0) return withResults.rows[0];
  const newest = await pool.query<ProgramRow>('SELECT * FROM programs ORDER BY year DESC, seq DESC LIMIT 1');
  return newest.rows[0] ?? null;
}

async function leaderboardCategory(
  category: CategoryRow,
  program: ProgramRow,
  now: Date,
): Promise<Record<string, unknown>> {
  const revealed = embargoPassed(category, now);
  const state = !category.published ? 'pending' : revealed ? 'revealed' : 'embargoed';
  const body: Record<string, unknown> = {
    id: category.id,
    name: category.name,
    state,
    revealsAt:
      state === 'embargoed' && category.embargo_at !== null
        ? withOffset(category.embargo_at, program.time_zone)
        : null,
    revealsLabel:
      state === 'embargoed' && category.embargo_at !== null
        ? momentLabel(category.embargo_at, program.time_zone)
        : null,
    cut: category.finalist_count,
    rows: [],
  };
  if (state !== 'revealed') return body;

  const rounds = await roundsOf(pool, category.id);
  const first = rounds.find((round) => round.kind === 'round_1');
  const final = rounds.find((round) => round.kind === 'final');
  if (first === undefined || final === undefined) return body;

  const shortlist = await pool.query<{ entry_id: string; score: string | null }>(
    `SELECT entry_id, score FROM round_results
     WHERE round_id = $1 AND cut = 'above' ORDER BY rank`,
    [first.id],
  );
  const previous = new Map(
    shortlist.rows.map((row, index) => [
      row.entry_id,
      { rank: index + 1, score: row.score === null ? null : Number(row.score).toFixed(2) },
    ]),
  );
  const rows = await pool.query<{
    rank: number;
    entry_id: string;
    entry_number: number;
    title: string;
    studio_name: string;
    score: string | null;
    cut: string;
    award: string | null;
  }>(
    `SELECT rr.rank, rr.entry_id, e.entry_number, e.title, s.name AS studio_name, rr.score, rr.cut, e.award
     FROM round_results rr
     JOIN entries e ON e.id = rr.entry_id
     JOIN studios s ON s.id = e.studio_id
     WHERE rr.round_id = $1 ORDER BY rr.rank`,
    [final.id],
  );
  body.rows = rows.rows.map((row) => ({
    rank: row.rank,
    entryNumber: row.entry_number,
    title: row.title,
    studioName: row.studio_name,
    score: row.score === null ? null : Number(row.score).toFixed(2),
    previousRank: previous.get(row.entry_id)?.rank ?? null,
    previousScore: previous.get(row.entry_id)?.score ?? null,
    award: row.award,
    cut: row.cut,
  }));
  return body;
}

async function leaderboard(ctx: Ctx): Promise<Reply> {
  const requested = ctx.query.get('programId');
  const program = requested === null ? await defaultProgram() : await loadProgram(pool, requested);
  if (program === null) return json(200, { program: null, categories: [] });
  const now = new Date();
  const categories = await categoriesOf(pool, program.id);
  const shaped = [];
  for (const category of categories) {
    shaped.push(await leaderboardCategory(category, program, now));
  }
  return json(200, {
    program: { id: program.id, name: program.name, year: program.year, timeZone: program.time_zone },
    categories: shaped,
  });
}

async function health(): Promise<Reply> {
  await pool.query('SELECT 1');
  return json(200, { status: 'ok' });
}

export const publicRoutes = [
  route('GET', '/api/public/gallery', gallery),
  route('GET', '/api/public/leaderboard', leaderboard),
  route('GET', '/api/health', health),
];
