import { randomUUID } from 'node:crypto';
import type { PuzzleTile } from '../shared/types';
import { config } from './config';
import { query } from './db';
import { parseOverlapText, type ParsedPuzzle } from './domain/format';
import { errors } from './errors';
import type { PuzzleRecord } from './games/state';
import { sha256Of, storage, uploadKey } from './storage';
import harbourLights from './fixtures/harbour-lights.overlap.txt';
import longTable from './fixtures/long-table.overlap.txt';
import morningKettle from './fixtures/morning-kettle.overlap.txt';
import nightShift from './fixtures/night-shift.overlap.txt';
import quietOrchard from './fixtures/quiet-orchard.overlap.txt';

export const FIXTURES: { slug: string; text: string }[] = [
  { slug: 'morning-kettle', text: morningKettle },
  { slug: 'night-shift', text: nightShift },
  { slug: 'harbour-lights', text: harbourLights },
  { slug: 'quiet-orchard', text: quietOrchard },
  { slug: 'long-table', text: longTable },
];

function parseOrThrow(bytes: Uint8Array): ParsedPuzzle {
  const result = parseOverlapText(bytes, config.maxGrid);
  if (!result.ok) throw errors.invalidPuzzle(result.count, result.lines);
  return result.puzzle;
}

async function insertPuzzle(
  id: string,
  parsed: ParsedPuzzle,
  source: 'library' | 'upload',
  fixture: string | null,
  sha256: string | null,
  ownerId: string | null,
): Promise<PuzzleRecord> {
  const result = await query<PuzzleRecord>(
    `insert into puzzles (id, title, author, cols, rows, source, fixture, sha256, owner_id,
                          blocks, numbers, clues, solution)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning *`,
    [
      id,
      parsed.title,
      parsed.author,
      parsed.cols,
      parsed.rows,
      source,
      fixture,
      sha256,
      ownerId,
      JSON.stringify(parsed.blocks),
      JSON.stringify(parsed.numbers),
      JSON.stringify(parsed.clues),
      JSON.stringify(parsed.solution),
    ],
  );
  return result.rows[0];
}

export async function seedLibrary(): Promise<void> {
  for (const fixture of FIXTURES) {
    const existing = await query('select id from puzzles where fixture = $1', [fixture.slug]);
    if (existing.rowCount && existing.rowCount > 0) continue;
    const parsed = parseOrThrow(new TextEncoder().encode(fixture.text));
    await insertPuzzle(randomUUID(), parsed, 'library', fixture.slug, null, null);
  }
}

/** Validate, store the exact bytes, then parse the stored bytes into the saved puzzle. */
export async function createUpload(
  bytes: Uint8Array,
  ownerId: string,
): Promise<{ puzzle: PuzzleRecord; solution: string[][] }> {
  parseOrThrow(bytes);
  const id = randomUUID();
  await storage.put(uploadKey(id), bytes, 'text/plain; charset=utf-8');
  const stored = await storage.get(uploadKey(id));
  if (!stored) throw errors.storageUnavailable();
  const parsed = parseOrThrow(stored);
  const puzzle = await insertPuzzle(id, parsed, 'upload', null, sha256Of(stored), ownerId);
  return { puzzle, solution: parsed.solution };
}

export async function visiblePuzzle(puzzleId: string, playerId: string): Promise<PuzzleRecord> {
  const result = await query<PuzzleRecord>(
    `select p.* from puzzles p
      where p.id = $1
        and (p.source = 'library'
             or p.owner_id = $2
             or exists (select 1 from game_players gp
                          join games g on g.id = gp.game_id
                         where g.puzzle_id = p.id and gp.player_id = $2))`,
    [puzzleId, playerId],
  );
  const puzzle = result.rows[0];
  if (!puzzle) throw errors.notFound();
  return puzzle;
}

function sizeBand(puzzle: { cols: number; rows: number }): 'small' | 'medium' | 'large' {
  const side = Math.max(puzzle.cols, puzzle.rows);
  if (side <= 7) return 'small';
  return side <= 12 ? 'medium' : 'large';
}

export async function boardPuzzles(
  playerId: string,
  filters: { size?: string | null; source?: string | null },
  inProgress: Map<string, number>,
): Promise<PuzzleTile[]> {
  if (filters.size != null && !['small', 'medium', 'large'].includes(filters.size)) {
    throw errors.invalid({ size: 'Use small, medium or large.' });
  }
  if (filters.source != null && !['library', 'mine'].includes(filters.source)) {
    throw errors.invalid({ source: 'Use library or mine.' });
  }
  const result = await query<PuzzleRecord>(
    `select * from puzzles
      where source = 'library' or owner_id = $1
      order by created_at`,
    [playerId],
  );
  const library = result.rows
    .filter((puzzle) => puzzle.source === 'library')
    .sort(
      (a, b) =>
        FIXTURES.findIndex((f) => f.slug === a.fixture) -
        FIXTURES.findIndex((f) => f.slug === b.fixture),
    );
  const mine = result.rows
    .filter((puzzle) => puzzle.source === 'upload')
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  const ordered = [...library, ...mine];
  return ordered
    .filter((puzzle) => filters.size == null || sizeBand(puzzle) === filters.size)
    .filter(
      (puzzle) =>
        filters.source == null ||
        (filters.source === 'library' ? puzzle.source === 'library' : puzzle.source === 'upload'),
    )
    .map((puzzle) => ({
      id: puzzle.id,
      title: puzzle.title,
      author: puzzle.author,
      cols: puzzle.cols,
      rows: puzzle.rows,
      source: puzzle.source,
      fixture: puzzle.fixture,
      in_progress: inProgress.get(puzzle.id) ?? 0,
    }));
}
