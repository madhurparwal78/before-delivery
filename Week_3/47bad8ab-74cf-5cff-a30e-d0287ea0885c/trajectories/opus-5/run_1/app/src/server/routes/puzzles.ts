import { config } from '../config';
import { query } from '../db';
import { errors } from '../errors';
import { retryPendingRecords } from '../games/records';
import { puzzleJson } from '../games/state';
import { readBody, requirePlayer, sendJson } from '../http';
import { presentPlayersByGame } from '../live';
import { boardPuzzles, createUpload, visiblePuzzle } from '../puzzles';
import { storage, uploadKey } from '../storage';
import type { RouteContext } from './context';

/** Distinct players with an open live connection to any unsolved game of each puzzle. */
async function inProgressCounts(): Promise<Map<string, number>> {
  const present = presentPlayersByGame();
  const counts = new Map<string, number>();
  if (present.size === 0) return counts;
  const games = await query<{ id: string; puzzle_id: string; status: string }>(
    'select id, puzzle_id, status from games where id = any($1::uuid[])',
    [[...present.keys()]],
  );
  const players = new Map<string, Set<string>>();
  for (const game of games.rows) {
    if (game.status === 'solved') continue;
    const set = players.get(game.puzzle_id) ?? new Set<string>();
    for (const playerId of present.get(game.id) ?? []) set.add(playerId);
    players.set(game.puzzle_id, set);
  }
  for (const [puzzleId, set] of players) counts.set(puzzleId, set.size);
  return counts;
}

export async function getPuzzles({ req, res, url }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const tiles = await boardPuzzles(
    player.id,
    { size: url.searchParams.get('size'), source: url.searchParams.get('source') },
    await inProgressCounts(),
  );
  sendJson(res, 200, { puzzles: tiles });
}

export async function getPuzzle({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const puzzle = await visiblePuzzle(params[0], player.id);
  sendJson(res, 200, puzzleJson(puzzle));
}

export async function postPuzzles({ req, res }: RouteContext): Promise<void> {
  const bytes = await readBody(req, config.uploadMaxBytes);
  const player = await requirePlayer(req);
  const { puzzle, solution } = await createUpload(bytes, player.id);
  void retryPendingRecords();
  sendJson(res, 201, { puzzle: puzzleJson(puzzle), solution });
}

export async function getOriginal({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const puzzle = await visiblePuzzle(params[0], player.id);
  if (puzzle.source !== 'upload') throw errors.notFound();
  const bytes = await storage.get(uploadKey(puzzle.id));
  if (!bytes) throw errors.notFound();
  void retryPendingRecords();
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': bytes.byteLength,
    'content-disposition': `attachment; filename="${puzzle.id}.overlap.txt"`,
  });
  res.end(Buffer.from(bytes));
}
