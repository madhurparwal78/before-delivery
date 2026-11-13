import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { createDb, SCHEMA_SQL } from "./db.js";
import { loadConfig } from "./config.js";
import { S3 } from "./s3.js";
import { cookiesOf, gameCode, id, playerCookie, pgToIso, sha256Hex } from "./util.js";
import { apiError, errorBody, type ApiError } from "./errors.js";
import { GameHub, loadGame, puzzleOf, elapsedMs, nextFreeColour, isPlayer, seatTeamOf, hostOf, opLog, statsOf, playerColour, type PuzzleRecord } from "./games.js";
import { applyWrite, isSolved } from "./writes.js";
import { parseOverlapText } from "../shared/parser.js";
import { computeLinks } from "../shared/parser.js";
import { countChars, hasControlChars, validName, formatTime, revealedPhrase, slugify } from "../shared/util.js";
import { computeNumbering } from "../shared/grid.js";
import { COLOURS } from "../shared/types.js";
import type { ClientWrite, ConfigJSON, GameJSON, PuzzleJSON, SquareJSON, Solution, TimerSegment, StatsJSON, Colour } from "../shared/types.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const s3 = new S3(config.s3);

const JSON_LIMIT = 16384;
const LIVE_MESSAGE_LIMIT = 4096;

// ---------------------------------------------------------------------------
// Library fixtures

interface Fixture {
  slug: string;
  text: string;
}

function loadFixtures(): Fixture[] {
  const slugs = ["morning-kettle", "night-shift", "harbour-lights", "quiet-orchard", "long-table"];
  return slugs.map((slug) => ({ slug, text: readFileSync(join(process.cwd(), `assets/${slug}.overlap.txt`)).toString("utf8") }));
}

async function ensureSchema(): Promise<void> {
  await db.query(SCHEMA_SQL);
}

async function ensureLibrary(): Promise<void> {
  const res = await db.query(`SELECT COUNT(*)::int AS n FROM puzzles WHERE source = 'library'`);
  if ((res.rows[0]?.n ?? 0) >= 5) return;
  for (const fixture of loadFixtures()) {
    const parsed = parseOverlapText(Buffer.from(fixture.text, "utf8"), config.maxGrid);
    if (!parsed.puzzle) throw new Error(`library fixture ${fixture.slug} does not parse`);
    const p = parsed.puzzle;
    const existing = await db.query(`SELECT id FROM puzzles WHERE fixture = $1`, [fixture.slug]);
    if (existing.rowCount && existing.rowCount > 0) continue;
    const pid = id("pz");
    await db.query(
      `INSERT INTO puzzles (id, title, author, cols, rows, source, fixture, sha256, blocks, numbers, clues, solution)
       VALUES ($1,$2,$3,$4,$5,'library',$6,NULL,$7,$8,$9,$10)`,
      [
        pid,
        p.title,
        p.author,
        p.cols,
        p.rows,
        fixture.slug,
        JSON.stringify(p.blocks),
        JSON.stringify(p.numbers),
        JSON.stringify(p.clues),
        JSON.stringify(p.grid),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers

function puzzleJson(r: Record<string, unknown>): PuzzleJSON {
  const clues = r.clues as { across: { number: number; row: number; col: number; length: number; text: string }[]; down: { number: number; row: number; col: number; length: number; text: string }[] };
  const key = (n: number, d: string) => `${d[0]}${n}`;
  const links = computeLinks(
    [...clues.across.map((c) => ({ number: c.number, direction: "across" as const, text: c.text })), ...clues.down.map((c) => ({ number: c.number, direction: "down" as const, text: c.text }))],
  );
  const linkList = (dir: "across" | "down") => (clues[dir] ?? []).map((c) => ({ number: c.number, row: c.row, col: c.col, length: c.length, text: c.text, links: links.get(key(c.number, dir)) ?? [] }));
  return {
    id: r.id as string,
    title: r.title as string,
    author: r.author as string,
    cols: r.cols as number,
    rows: r.rows as number,
    source: r.source as "library" | "upload",
    fixture: (r.fixture as string | null) ?? null,
    sha256: (r.sha256 as string | null) ?? null,
    created_at: pgToIso(r.created_at as Date),
    blocks: r.blocks as string[],
    numbers: r.numbers as { row: number; col: number; number: number }[],
    clues: { across: linkList("across"), down: linkList("down") },
  };
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > limit) throw apiError(413, "too_large", { message: `This file is larger than ${limit} bytes.` });
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, limit = JSON_LIMIT): Promise<Record<string, unknown>> {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return {};
  const text = raw.toString("utf8");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw apiError(422, "invalid");
    return parsed as Record<string, unknown>;
  } catch (e) {
    if ((e as ApiError).status) throw e;
    throw apiError(422, "invalid");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, errorBody(err));
}

function playerOf(req: IncomingMessage): string | null {
  const cookies = cookiesOf(req.headers.cookie);
  const value = cookies["overlap_player"];
  return value && value.length > 0 ? value : null;
}

async function requirePlayer(req: IncomingMessage): Promise<string> {
  const pid = playerOf(req);
  if (!pid) throw apiError(401, "no_player");
  const res = await db.query(`SELECT id FROM players WHERE id = $1`, [pid]);
  if (res.rowCount === 0) throw apiError(401, "no_player");
  return pid;
}

function linkUrl(code: string): string {
  if (config.publicUrl) return `${config.publicUrl.replace(/\/$/, "")}/g/${code}`;
  return `/g/${code}`;
}

// ---------------------------------------------------------------------------
// Hub with broadcast helpers

const hub = new GameHub(db, config, async (gameId) => {
  await writeSolveRecord(gameId);
});

// The one place where the link access check is decided.
async function canSeeGame(gameId: string, playerId: string): Promise<GameJSON | null> {
  const gameRes = await db.query(`SELECT host_player_id, link_state, status, mode, race_state FROM games WHERE id = $1`, [gameId]);
  if (gameRes.rowCount === 0) return null;
  const g = gameRes.rows[0]!;
  if (g.host_player_id === playerId) return loadGame(db, gameId, await seatTeamOf(db, gameId, playerId));
  const seated = await isPlayer(db, gameId, playerId);
  if (seated) return loadGame(db, gameId, await seatTeamOf(db, gameId, playerId));
  return null;
}

// ---------------------------------------------------------------------------
// Solve records

async function writeSolveRecord(gameId: string): Promise<void> {
  const gameRes = await db.query(`SELECT id, puzzle_id, solved_at, solved_elapsed_ms FROM games WHERE id = $1 AND status = 'solved'`, [gameId]);
  if (gameRes.rowCount === 0) return;
  const g = gameRes.rows[0]!;
  const puzzleRes = await db.query(`SELECT id, title, cols, rows FROM puzzles WHERE id = $1`, [g.puzzle_id]);
  const p = puzzleRes.rows[0]!;
  const seats = await db.query(
    `SELECT s.player_id, pl.display_name, s.colour FROM seats s JOIN players pl ON pl.id = s.player_id WHERE s.game_id = $1 ORDER BY s.joined_at ASC`,
    [gameId],
  );
  const sqRes = await db.query(`SELECT row, col, value, pencil, state, owner FROM squares WHERE game_id = $1 AND team = 0 ORDER BY row, col`, [gameId]);
  const ops = await opLog(db, gameId);
  const segRes = await db.query(`SELECT started_at, ended_at FROM timer_segments WHERE game_id = $1 ORDER BY started_at`, [gameId]);
  const segs: TimerSegment[] = segRes.rows.map((r) => ({ started_at: pgToIso(r.started_at), ended_at: r.ended_at ? pgToIso(r.ended_at) : null }));
  const playersForStats = seats.rows.map((r) => ({ id: r.player_id, display_name: r.display_name, colour: r.colour, host: false, present: true, team: null, score: 0 }));
  const stats = statsOf(sqRes.rows as SquareJSON[], playersForStats);
  const elapsed = await elapsedMs(db, gameId, "solved");
  const record = {
    format: "overlap-solve-record-1",
    game_id: gameId,
    puzzle_id: p.id,
    puzzle_title: p.title,
    cols: p.cols,
    rows: p.rows,
    solved_at: pgToIso(g.solved_at as Date),
    elapsed_ms: elapsed,
    revealed_count: 0,
    checked_count: 0,
    players: seats.rows.map((r) => ({ id: r.player_id, display_name: r.display_name, colour: r.colour })),
    initial: await initialSquares(gameId),
    final: sqRes.rows.map((r) => ({ row: r.row, col: r.col, value: r.value, pencil: r.pencil, state: r.state, owner: r.owner })),
    ops,
    timer_segments: segs,
    stats: stats.map((s) => ({ player_id: s.player_id, letters: s.letters, revealed: s.revealed })),
  };
  const counts = await db.query(`SELECT revealed_count, checked_count FROM games WHERE id = $1`, [gameId]);
  record.revealed_count = counts.rows[0]!.revealed_count;
  record.checked_count = counts.rows[0]!.checked_count;
  await s3.put(`records/${gameId}.json`, Buffer.from(JSON.stringify(record), "utf8"), "application/json");
  await db.query(`UPDATE history SET record_ready = TRUE WHERE game_id = $1`, [gameId]);
  await db.query(`DELETE FROM pending_records WHERE game_id = $1`, [gameId]);
}

/** The squares as the game began, seeded squares included, from the first op of each square. */
async function initialSquares(gameId: string): Promise<SquareJSON[]> {
  const sqRes = await db.query(`SELECT row, col, value, pencil, state, owner FROM squares WHERE game_id = $1 AND team = 0 ORDER BY row, col`, [gameId]);
  const ops = await opLog(db, gameId);
  const firstCell = new Map<string, { value: string; pencil: boolean; state: SquareJSON["state"]; owner: SquareJSON["owner"] }>();
  for (const op of ops) {
    if (op.type !== "cell" || op.row === undefined || op.col === undefined) continue;
    const key = `${op.row},${op.col}`;
    if (!firstCell.has(key)) {
      firstCell.set(key, {
        value: op.value ?? "",
        pencil: op.pencil ?? false,
        state: (op.state as SquareJSON["state"]) ?? "filled",
        owner: null,
      });
    }
  }
  return sqRes.rows.map((r) => {
    const hit = firstCell.get(`${r.row},${r.col}`);
    return {
      row: r.row,
      col: r.col,
      value: hit ? hit.value : r.value,
      pencil: hit ? hit.pencil : r.pencil,
      state: hit ? hit.state : r.state,
      owner: hit ? null : r.owner,
    };
  });
}

async function deferRecord(gameId: string): Promise<void> {
  await db.query(`INSERT INTO pending_records (game_id) VALUES ($1) ON CONFLICT (game_id) DO NOTHING`, [gameId]);
  hub.scheduleRecordRetry(gameId, async () => {
    const pending = await db.query(`SELECT 1 FROM pending_records WHERE game_id = $1`, [gameId]);
    if (pending.rowCount === 0) return;
    await writeSolveRecord(gameId);
  });
}

// ---------------------------------------------------------------------------
// Write dispatch (shared by POST ops and the live connection)

async function dispatchWrite(gameId: string, playerId: string, write: Record<string, unknown>): Promise<Record<string, unknown>> {
  const err = await db.tx(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [gameId]);
    const gameRes = await client.query(`SELECT id, puzzle_id, host_player_id, link_state, status, timer_state, mode, race_state, seq FROM games WHERE id = $1`, [gameId]);
    if (gameRes.rowCount === 0) return { error: apiError(404, "not_found") };
    const g = gameRes.rows[0]!;

    const seatRes = await client.query(`SELECT colour, team FROM seats WHERE game_id = $1 AND player_id = $2`, [gameId, playerId]);
    if (seatRes.rowCount === 0) return { error: apiError(404, "not_found") };
    const seat = seatRes.rows[0]!;

    const type = write.type as string;
    const clientOpId = (write.client_op_id as string | undefined) ?? null;

    // Replay keys: same id and identical body returns the stored result.
    if (type !== "cursor" && clientOpId) {
      if (typeof clientOpId !== "string" || clientOpId.length < 1 || clientOpId.length > 64) {
        return { error: apiError(422, "invalid", { message: "Bad client op id." }) };
      }
      const prior = await client.query(
        `SELECT body, response FROM client_op_results WHERE game_id = $1 AND player_id = $2 AND client_op_id = $3`,
        [gameId, playerId, clientOpId],
      );
      if (prior.rowCount && prior.rowCount > 0) {
        const body = prior.rows[0]!.body as Record<string, unknown>;
        const same = canonical(body) === canonical(write);
        if (!same) return { error: apiError(409, "op_id_reused") };
        return { response: prior.rows[0]!.response as Record<string, unknown> };
      }
    }

    // State conflicts, in the published order.
    if (g.status === "solved" && type !== "cursor") {
      return { error: apiError(409, g.mode === "race" && g.race_state === "finished" ? "game_solved" : "game_solved") };
    }
    if (g.mode === "race" && type === "cell" && g.race_state === "lobby") return { error: apiError(409, "race_not_started") };
    if (g.mode === "race" && type === "cell" && seat.team === null) return { error: apiError(403, "watching") };

    const puzzle = await puzzleOf(db, g.puzzle_id);
    if (!puzzle) return { error: apiError(404, "not_found") };

    const settings = await client.query(`SELECT autocheck FROM players WHERE id = $1`, [playerId]);
    const autocheckEnabled = Boolean(settings.rows[0]?.autocheck);

    const result = await applyWrite(client, {
      gameId,
      mode: g.mode,
      raceState: g.race_state,
      status: g.status,
      seq: g.seq,
      playerId,
      colour: seat.colour,
      team: (seat.team as 1 | 2 | null) ?? null,
      puzzle,
    }, write, autocheckEnabled);

    if (clientOpId && type !== "cursor") {
      await client.query(
        `INSERT INTO client_op_results (game_id, player_id, client_op_id, body, response) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (game_id, player_id, client_op_id) DO NOTHING`,
        [gameId, playerId, clientOpId, stripOpId(write), result.response],
      );
    }
    return result;
  });
  if ("error" in err && err.error) throw err.error;
  return err.response!;
}

function stripOpId(body: Record<string, unknown>): Record<string, unknown> {
  const { client_op_id, ...rest } = body;
  void client_op_id;
  return rest;
}

/** Canonical JSON for body comparison: JSONB re-orders keys, so compare sorted. */
function canonical(body: Record<string, unknown>): string {
  const sorted = Object.keys(body)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = body[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

// ---------------------------------------------------------------------------
// HTTP routes

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const method = req.method ?? "GET";

  if (pathname === "/api/health" && method === "GET") {
    let reachable = true;
    try {
      reachable = await s3.headBucket();
    } catch {
      reachable = false;
    }
    return sendJson(res, 200, { status: reachable ? "ok" : "unavailable" });
  }

  if (pathname === "/api/config" && method === "GET") {
    const body: ConfigJSON = {
      heartbeat_ms: config.heartbeatMs,
      presence_grace_ms: config.presenceGraceMs,
      upload_max_bytes: config.uploadMaxBytes,
      max_grid: config.maxGrid,
      max_players: config.maxPlayers,
      live_rate: config.liveRate,
      toast_ms: config.toastMs,
      replay_step_ms: config.replayStepMs,
    };
    return sendJson(res, 200, body);
  }

  if (pathname === "/api/players" && method === "POST") {
    const body = await readJson(req);
    const name = String(body.display_name ?? "").trim();
    const chars = countChars(name);
    if (chars < 1 || chars > 24 || hasControlChars(name)) {
      return sendError(res, apiError(422, "invalid", { fields: { display_name: "Enter a name between 1 and 24 characters." } }));
    }
    const pid = id("pl");
    await db.query(`INSERT INTO players (id, display_name) VALUES ($1,$2)`, [pid, name]);
    res.setHeader("set-cookie", playerCookie(pid));
    return sendJson(res, 201, { id: pid, display_name: name });
  }

  if (pathname === "/api/players/me" && method === "GET") {
    const pid = await requirePlayer(req);
    const r = await db.query(`SELECT id, display_name FROM players WHERE id = $1`, [pid]);
    return sendJson(res, 200, { id: r.rows[0]!.id, display_name: r.rows[0]!.display_name });
  }

  if (pathname === "/api/players/me/settings" && method === "GET") {
    const pid = await requirePlayer(req);
    const r = await db.query(`SELECT skip_filled, jump_next_clue, autocheck FROM players WHERE id = $1`, [pid]);
    return sendJson(res, 200, r.rows[0]!);
  }

  if (pathname === "/api/players/me/settings" && method === "PUT") {
    const pid = await requirePlayer(req);
    const body = await readJson(req);
    const keys = ["skip_filled", "jump_next_clue", "autoorder"] as const;
    void keys;
    const values: Record<string, boolean> = {};
    for (const key of ["skip_filled", "jump_next_clue", "autocheck"]) {
      const v = body[key];
      if (typeof v !== "boolean") {
        return sendError(res, apiError(422, "invalid", { fields: { [key]: `${key} must be a boolean.` } }));
      }
      values[key] = v;
    }
    await db.query(`UPDATE players SET skip_filled = $1, jump_next_clue = $2, autocheck = $3 WHERE id = $4`, [
      values.skip_filled, values.jump_next_clue, values.autocheck, pid,
    ]);
    return sendJson(res, 200, values);
  }

  if (pathname === "/api/puzzles" && method === "GET") {
    const pid = await requirePlayer(req);
    const url = new URL(req.url ?? "/", "http://local");
    const size = url.searchParams.get("size");
    const source = url.searchParams.get("source");
    if (size !== null && !["small", "medium", "large"].includes(size)) {
      return sendError(res, apiError(422, "invalid", { fields: { size: "Size must be small, medium or large." } }));
    }
    if (source !== null && !["library", "mine"].includes(source)) {
      return sendError(res, apiError(422, "invalid", { fields: { source: "Source must be library or mine." } }));
    }
    const sizeOf = (cols: number, rows: number): "small" | "medium" | "large" => {
      const larger = Math.max(cols, rows);
      return larger <= 7 ? "small" : larger <= 12 ? "medium" : "large";
    };
    const params: unknown[] = [pid];
    let where = ` AND (source = 'library' OR uploader_id = $1)`;
    if (source === "library") where = ` AND source = 'library'`;
    if (source === "mine") where = ` AND source = 'upload' AND uploader_id = $1`;
    const rows = await db.query(
      `SELECT p.id, p.title, p.author, p.cols, p.rows, p.source, p.fixture,
              (SELECT COUNT(DISTINCT pr.player_id)::int FROM presence pr
                 JOIN games g ON g.id = pr.game_id
                 WHERE g.puzzle_id = p.id AND g.status <> 'solved' AND pr.connections > 0) AS in_progress
       FROM puzzles p WHERE TRUE ${where}
       ORDER BY (p.source = 'library') DESC, p.created_at ASC`,
      params,
    );
    const puzzles = rows.rows
      .map((r) => ({ ...r, in_progress: Number(r.in_progress) }))
      .filter((r) => size === null || sizeOf(r.cols, r.rows) === size);
    return sendJson(res, 200, { puzzles });
  }

  if (pathname === "/api/puzzles" && method === "POST") {
    const pid = await requirePlayer(req);
    const raw = await readBody(req, config.uploadMaxBytes);
    if (raw.length > config.uploadMaxBytes) {
      return sendError(res, apiError(413, "too_large", { message: `This file is larger than ${config.uploadMaxBytes} bytes.` }));
    }
    const parsed = parseOverlapText(raw, config.maxGrid);
    if (!parsed.puzzle) {
      const lines = parsed.problems.map((p) => `Line ${p.line}: ${p.message}`);
      return sendError(res, apiError(422, "invalid_puzzle", {
        lines,
        message: parsed.problems.length === 1 ? "This puzzle has 1 problem." : `This puzzle has ${parsed.problems.length} problems.`,
      }));
    }
    const p = parsed.puzzle;
    const pidNew = id("pz");
    let stored: Buffer;
    try {
      await s3.put(`uploads/${pidNew}/original.overlap.txt`, raw, "text/plain; charset=utf-8");
      stored = await s3.get(`uploads/${pidNew}/original.overlap.txt`);
    } catch {
      return sendError(res, apiError(503, "storage_unavailable"));
    }
    const reparsed = parseOverlapText(stored, config.maxGrid);
    if (!reparsed.puzzle) {
      return sendError(res, apiError(422, "invalid_puzzle", { lines: reparsed.problems.map((x) => `Line ${x.line}: ${x.message}`) }));
    }
    const storedPuzzle = reparsed.puzzle;
    const links = computeLinks(storedPuzzle.clues);
    const numbering = computeNumbering(storedPuzzle.cols, storedPuzzle.rows, storedPuzzle.blocks.map((b) => [...b].map((ch) => ch !== "#")));
    const clueRows = storedPuzzle.clues.map((c) => ({
      number: c.number,
      direction: c.direction,
      row: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.row ?? 0,
      col: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.col ?? 0,
      length: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.length ?? 0,
      text: c.text,
    }));
    for (const clue of clueRows) {
      const word = numbering.words.find((w) => w.number === clue.number && w.direction === clue.direction);
      clue.length = word ? word.length : 0;
    }
    const clueLists = {
      across: clueRows.filter((c) => c.direction === "across").sort((a, b) => a.number - b.number),
      down: clueRows.filter((c) => c.direction === "down").sort((a, b) => a.number - b.number),
    };
    void links;
    await db.query(
      `INSERT INTO puzzles (id, title, author, cols, rows, source, fixture, uploader_id, sha256, blocks, numbers, clues, solution)
       VALUES ($1,$2,$3,$4,$5,'upload',NULL,$6,$7,$8,$9,$10,$11)`,
      [
        pidNew,
        storedPuzzle.title,
        storedPuzzle.author,
        storedPuzzle.cols,
        storedPuzzle.rows,
        pid,
        sha256Hex(raw),
        JSON.stringify(storedPuzzle.blocks),
        JSON.stringify(storedPuzzle.numbers),
        JSON.stringify(clueLists),
        JSON.stringify(storedPuzzle.grid),
      ],
    );
    const row = await db.query(`SELECT * FROM puzzles WHERE id = $1`, [pidNew]);
    const solution: Solution = storedPuzzle.grid.map((r) => [...r]);
    return sendJson(res, 201, { puzzle: puzzleJson(row.rows[0]!), solution });
  }

  const puzzleMatch = pathname.match(/^\/api\/puzzles\/([^/]+)$/);
  if (puzzleMatch && method === "GET") {
    await requirePlayer(req);
    const pid = await requirePlayer(req);
    const row = await db.query(`SELECT * FROM puzzles WHERE id = $1`, [puzzleMatch[1]!]);
    if (row.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    const r = row.rows[0]!;
    if (r.source === "upload" && r.uploader_id !== pid) {
      const inGame = await db.query(
        `SELECT 1 FROM seats s JOIN games g ON g.id = s.game_id WHERE s.player_id = $1 AND g.puzzle_id = $2`,
        [pid, puzzleMatch[1]!],
      );
      if (inGame.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    }
    return sendJson(res, 200, puzzleJson(r));
  }

  const originalMatch = pathname.match(/^\/api\/puzzles\/([^/]+)\/original$/);
  if (originalMatch && method === "GET") {
    const pid = await requirePlayer(req);
    const row = await db.query(`SELECT * FROM puzzles WHERE id = $1`, [originalMatch[1]!]);
    if (row.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    const r = row.rows[0]!;
    if (r.source !== "upload") return sendError(res, apiError(404, "not_found"));
    if (r.uploader_id !== pid) {
      const inGame = await db.query(
        `SELECT 1 FROM seats s JOIN games g ON g.id = s.game_id WHERE s.player_id = $1 AND g.puzzle_id = $2`,
        [pid, originalMatch[1]!],
      );
      if (inGame.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    }
    let bytes: Buffer;
    try {
      bytes = await s3.get(`uploads/${originalMatch[1]}/original.overlap.txt`);
    } catch {
      return sendError(res, apiError(503, "storage_unavailable"));
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${originalMatch[1]}.overlap.txt"`,
    });
    res.end(bytes);
    return;
  }

  if (pathname === "/api/games" && method === "POST") {
    const pid = await requirePlayer(req);
    const body = await readJson(req);
    const puzzleId = body.puzzle_id;
    const mode = body.mode ?? "shared";
    if (typeof puzzleId !== "string" || !puzzleId) {
      return sendError(res, apiError(422, "invalid", { fields: { puzzle_id: "A puzzle is required." } }));
    }
    if (mode !== "shared" && mode !== "race") {
      return sendError(res, apiError(422, "invalid", { fields: { mode: "Mode must be shared or race." } }));
    }
    const puzzle = await puzzleOf(db, puzzleId);
    if (!puzzle) return sendError(res, apiError(404, "not_found"));
    const upl = await db.query(`SELECT source, uploader_id FROM puzzles WHERE id = $1`, [puzzleId]);
    const meta = upl.rows[0]!;
    if (meta.source === "upload" && meta.uploader_id !== pid) {
      const inGame = await db.query(
        `SELECT 1 FROM seats s JOIN games g ON g.id = s.game_id WHERE s.player_id = $1 AND g.puzzle_id = $2`,
        [pid, puzzleId],
      );
      if (inGame.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    }
    const gid = await createGame(puzzleId, pid, mode);
    const game = await loadGame(db, gid, null);
    return sendJson(res, 201, game);
  }

  const gameMatch = pathname.match(/^\/api\/games\/([^/]+)$/);
  if (gameMatch && method === "GET") {
    const pid = await requirePlayer(req);
    const gameId = gameMatch[1]!;
    const game = await canSeeGame(gameId, pid);
    if (!game) return sendError(res, apiError(404, "not_found"));
    return sendJson(res, 200, game);
  }

  const opsMatch = pathname.match(/^\/api\/games\/([^/]+)\/ops$/);
  if (opsMatch && method === "GET") {
    const pid = await requirePlayer(req);
    const gameId = opsMatch[1]!;
    const game = await canSeeGame(gameId, pid);
    if (!game) return sendError(res, apiError(404, "not_found"));
    return sendJson(res, 200, { ops: await opLog(db, gameId) });
  }

  if (opsMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const gameId = opsMatch[1]!;
    const game = await canSeeGame(gameId, pid);
    if (!game) return sendError(res, apiError(404, "not_found"));
    const body = await readJson(req);
    const write = body as Record<string, unknown>;
    if (write.type === "cursor") return sendError(res, apiError(422, "invalid", { message: "Cursor writes need the live connection." }));
    const rate = hub.rateCheck(pid);
    if (!rate.ok) {
      if (rate.notice) return sendError(res, apiError(429, "rate_limited"));
      return sendError(res, apiError(429, "rate_limited"));
    }
    const response = await dispatchWrite(gameId, pid, write);
    const msg = response as Record<string, unknown>;
    if (msg.type === "cell" || msg.type === "check" || msg.type === "reveal" || msg.type === "clear" || msg.type === "claim") {
      broadcastWrite(gameId, pid, msg);
    }
    const fresh = await loadGame(db, gameId, await seatTeamOf(db, gameId, pid));
    if ((msg as { solved?: boolean }).solved) await onSolved(gameId, fresh!);
    return sendJson(res, 200, response);
  }

  const linkOffMatch = pathname.match(/^\/api\/games\/([^/]+)\/link\/off$/);
  if (linkOffMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const gameId = linkOffMatch[1]!;
    const host = await hostOf(db, gameId);
    if (!host) return sendError(res, apiError(404, "not_found"));
    if (host !== pid) return sendError(res, apiError(403, "not_host"));
    const state = await db.query(`SELECT link_state FROM games WHERE id = $1`, [gameId]);
    if (state.rows[0]!.link_state === "off") return sendError(res, apiError(409, "link_already_off"));
    await db.query(`UPDATE games SET link_state = 'off', code = NULL WHERE id = $1`, [gameId]);
    hub.broadcast(gameId, { type: "link_off", reason: "off", message: "This game link was turned off." });
    closeNonHost(gameId, pid);
    const game = await loadGame(db, gameId, null);
    return sendJson(res, 200, game);
  }

  const linkReplaceMatch = pathname.match(/^\/api\/games\/([^/]+)\/link\/replace$/);
  if (linkReplaceMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const gameId = linkReplaceMatch[1]!;
    const host = await hostOf(db, gameId);
    if (!host) return sendError(res, apiError(404, "not_found"));
    if (host !== pid) return sendError(res, apiError(403, "not_host"));
    const oldCode = await db.query(`SELECT code, link_state FROM games WHERE id = $1`, [gameId]);
    if (oldCode.rows[0]!.link_state === "off") return sendError(res, apiError(409, "link_already_off"));
    const newCode = gameCode();
    await db.query(`UPDATE games SET prev_code = code, code = $2 WHERE id = $1`, [gameId, newCode]);
    hub.broadcast(gameId, { type: "link_off", reason: "replaced", message: "This game link was replaced. Ask the host for the new one." });
    closeNonHost(gameId, pid);
    const game = await loadGame(db, gameId, null);
    return sendJson(res, 200, game);
  }

  const teamMatch = pathname.match(/^\/api\/games\/([^/]+)\/team$/);
  if (teamMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const gameId = teamMatch[1]!;
    const seated = await isPlayer(db, gameId, pid);
    if (!seated) return sendError(res, apiError(404, "not_found"));
    const gameRes = await db.query(`SELECT mode, race_state FROM games WHERE id = $1`, [gameId]);
    const g = gameRes.rows[0]!;
    if (g.mode !== "race") return sendError(res, apiError(422, "invalid", { fields: { team: "Shared games have no teams." } }));
    if (g.race_state !== "lobby") return sendError(res, apiError(409, "race_started"));
    const body = await readJson(req);
    const team = body.team;
    if (team !== null && team !== 1 && team !== 2) {
      return sendError(res, apiError(422, "invalid", { fields: { team: "Team must be 1, 2 or null." } }));
    }
    await db.query(`UPDATE seats SET team = $1 WHERE game_id = $2 AND player_id = $3`, [team, gameId, pid]);
    hub.setSeatTeam(gameId, pid, (team as 1 | 2 | null) ?? null);
    hub.broadcast(gameId, { type: "team", player_id: pid, team: (team as 1 | 2 | null) ?? null });
    const game = await loadGame(db, gameId, (team as 1 | 2 | null) ?? null);
    return sendJson(res, 200, game);
  }

  const raceStartMatch = pathname.match(/^\/api\/games\/([^/]+)\/race\/start$/);
  if (raceStartMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const gameId = raceStartMatch[1]!;
    const host = await hostOf(db, gameId);
    if (!host) return sendError(res, apiError(404, "not_found"));
    if (host !== pid) return sendError(res, apiError(403, "not_host"));
    const gameRes = await db.query(`SELECT mode, race_state FROM games WHERE id = $1`, [gameId]);
    const g = gameRes.rows[0]!;
    if (g.mode !== "race") return sendError(res, apiError(422, "invalid", { fields: { mode: "Only race games can start a race." } }));
    if (g.race_state !== "lobby") return sendError(res, apiError(409, "race_started"));
    const teams = await db.query(`SELECT team, COUNT(*)::int AS n FROM seats WHERE game_id = $1 GROUP BY team`, [gameId]);
    const counts = new Map<number, number>();
    for (const row of teams.rows) counts.set(row.team as number, row.n);
    if ((counts.get(1) ?? 0) < 1 || (counts.get(2) ?? 0) < 1) {
      return sendError(res, apiError(422, "invalid", { fields: { teams: "Each team needs at least one player." } }));
    }
    await db.query(`UPDATE games SET race_state = 'racing', scores = $2 WHERE id = $1`, [gameId, JSON.stringify({ "1": 0, "2": 0 })]);
    await goLive(gameId);
    hub.broadcast(gameId, { type: "race", state: "racing", scores: { "1": 0, "2": 0 } });
    const game = await loadGame(db, gameId, await seatTeamOf(db, gameId, pid));
    return sendJson(res, 200, game);
  }

  const linkMatch = pathname.match(/^\/api\/links\/([^/]+)$/);
  if (linkMatch && method === "GET") {
    await requirePlayer(req);
    const code = linkMatch[1]!;
    const row = await db.query(`SELECT id, link_state, status, code FROM games WHERE code = $1`, [code]);
    if (row.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    const g = row.rows[0]!;
    const count = await db.query(`SELECT COUNT(*)::int AS n FROM seats WHERE game_id = $1`, [g.id]);
    const puzzleTitle = await db.query(`SELECT p.title FROM games g JOIN puzzles p ON p.id = g.puzzle_id WHERE g.id = $1`, [g.id]);
    return sendJson(res, 200, {
      game_id: g.id,
      puzzle_title: puzzleTitle.rows[0]!.title,
      status: g.status,
      player_count: count.rows[0]!.n,
    });
  }

  const joinMatch = pathname.match(/^\/api\/links\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const pid = await requirePlayer(req);
    const code = joinMatch[1]!;
    const row = await db.query(`SELECT id, link_state, status, mode, host_player_id FROM games WHERE code = $1`, [code]);
    if (row.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    const g = row.rows[0]!;
    const seated = await isPlayer(db, g.id, pid);
    if (!seated) {
      const count = await db.query(`SELECT COUNT(*)::int AS n FROM seats WHERE game_id = $1`, [g.id]);
      if (count.rows[0]!.n >= config.maxPlayers) return sendError(res, apiError(409, "game_full"));
      if (g.status === "solved") return sendError(res, apiError(409, "game_solved"));
      const colour = await nextFreeColour(db, g.id);
      if (!colour) return sendError(res, apiError(409, "game_full"));
      await db.query(`INSERT INTO seats (game_id, player_id, colour) VALUES ($1,$2,$3)`, [g.id, pid, colour]);
      if (g.mode === "race") {
        await db.query(`UPDATE seats SET team = NULL WHERE game_id = $1 AND player_id = $2`, [g.id, pid]);
      }
    }
    const game = await loadGame(db, g.id, await seatTeamOf(db, g.id, pid));
    return sendJson(res, 200, game);
  }

  if (pathname === "/api/history" && method === "GET") {
    const pid = await requirePlayer(req);
    const rows = await db.query(
      `SELECT h.*, p.title AS puzzle_title FROM history h JOIN puzzles p ON p.id = h.puzzle_id
       WHERE h.player_id = $1 ORDER BY h.solved_at DESC`,
      [pid],
    );
    const entries = [];
    for (const r of rows.rows) {
      const seats = await db.query(
        `SELECT pl.display_name, s.colour FROM seats s JOIN players pl ON pl.id = s.player_id WHERE s.game_id = $1 ORDER BY s.joined_at ASC`,
        [r.game_id],
      );
      const sq = await db.query(`SELECT row, col, owner FROM squares WHERE game_id = $1 AND team = 0 AND owner IS NOT NULL ORDER BY row, col`, [r.game_id]);
      const players = seats.rows.map((s) => ({ display_name: s.display_name, colour: s.colour as Colour }));
      const stats = (r.stats as StatsJSON[]) ?? [];
      entries.push({
        game_id: r.game_id,
        puzzle_id: r.puzzle_id,
        puzzle_title: r.puzzle_title,
        cols: r.cols,
        rows: r.rows,
        elapsed_ms: Number(r.elapsed_ms),
        solved_at: pgToIso(r.solved_at),
        revealed_count: r.revealed_count,
        checked_count: r.checked_count,
        record_ready: r.record_ready,
        players,
        squares: sq.rows.map((s) => ({ row: s.row, col: s.col, owner: s.owner as Colour })),
        stats: stats.map((s) => ({ display_name: players.find((p) => p.colour === s.colour)?.display_name ?? "", colour: s.colour, letters: s.letters, revealed: s.revealed })),
      });
    }
    return sendJson(res, 200, { entries });
  }

  const recordMatch = pathname.match(/^\/api\/history\/([^/]+)\/record$/);
  if (recordMatch && method === "GET") {
    const pid = await requirePlayer(req);
    const gameId = recordMatch[1]!;
    const entry = await db.query(`SELECT 1 FROM history WHERE game_id = $1 AND player_id = $2`, [gameId, pid]);
    if (entry.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    let bytes: Buffer;
    try {
      bytes = await s3.get(`records/${gameId}.json`);
    } catch {
      return sendError(res, apiError(503, "storage_unavailable"));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(bytes);
    return;
  }

  if (pathname === "/api/grading/seed" && method === "POST") {
    if (!config.grading) return sendError(res, apiError(404, "not_found"));
    return gradingSeed(req, res);
  }

  if (pathname === "/api/grading/session" && method === "POST") {
    if (!config.grading) return sendError(res, apiError(404, "not_found"));
    const body = await readJson(req);
    const pid = String(body.player_id ?? "");
    const found = await db.query(`SELECT id FROM players WHERE id = $1`, [pid]);
    if (found.rowCount === 0) return sendError(res, apiError(404, "not_found"));
    res.setHeader("set-cookie", playerCookie(pid));
    res.writeHead(204);
    res.end();
    return;
  }

  return sendError(res, apiError(404, "not_found"));
}

// ---------------------------------------------------------------------------
// Game creation and lifecycle

async function createGame(puzzleId: string, hostId: string, mode: "shared" | "race"): Promise<string> {
  const gid = id("gm");
  const code = gameCode();
  await db.tx(async (client) => {
    await client.query(
      `INSERT INTO games (id, puzzle_id, host_player_id, code, link_state, status, timer_state, mode, race_state, scores)
       VALUES ($1,$2,$3,$4,'active','open','paused',$5,$6,$7)`,
      [gid, puzzleId, hostId, code, mode, mode === "race" ? "lobby" : null, mode === "race" ? JSON.stringify({ "1": 0, "2": 0 }) : null],
    );
    await client.query(`INSERT INTO seats (game_id, player_id, colour) VALUES ($1,$2,'teal')`, [gid, hostId]);
    const puzzle = await puzzleOf(db, puzzleId);
    if (!puzzle) throw new Error("missing puzzle");
    const white: { row: number; col: number }[] = [];
    for (let r = 0; r < puzzle.rows; r++) {
      for (let c = 0; c < puzzle.cols; c++) {
        if (puzzle.blocks[r]![c] !== "#") white.push({ row: r, col: c });
      }
    }
    if (mode === "race") {
      for (const team of [1, 2]) {
        for (const sq of white) {
          await client.query(`INSERT INTO squares (game_id, team, row, col, value, pencil, state, owner) VALUES ($1,$2,$3,$4,'',FALSE,'empty',NULL)`, [gid, team, sq.row, sq.col]);
        }
      }
    }
    for (const sq of white) {
      await client.query(`INSERT INTO squares (game_id, team, row, col, value, pencil, state, owner) VALUES ($1,0,$2,$3,'',FALSE,'empty',NULL)`, [gid, sq.row, sq.col]);
    }
  });
  return gid;
}

async function goLive(gameId: string): Promise<void> {
  const g = await db.query(`SELECT status, timer_state FROM games WHERE id = $1`, [gameId]);
  const row = g.rows[0]!;
  if (row.status === "open") {
    await db.query(`UPDATE games SET status = 'live', timer_state = 'running' WHERE id = $1`, [gameId]);
    await db.query(`INSERT INTO timer_segments (game_id, started_at) VALUES ($1, now())`, [gameId]);
    hub.cancelGrace(gameId);
    const elapsed = await elapsedMs(db, gameId, "running");
    hub.broadcast(gameId, { type: "timer", state: "running", elapsed_ms: elapsed });
  } else if (row.status === "paused") {
    await db.query(`UPDATE games SET status = 'live', timer_state = 'running' WHERE id = $1`, [gameId]);
    await db.query(`INSERT INTO timer_segments (game_id, started_at) VALUES ($1, now())`, [gameId]);
    hub.cancelGrace(gameId);
    const elapsed = await elapsedMs(db, gameId, "running");
    hub.broadcast(gameId, { type: "timer", state: "running", elapsed_ms: elapsed });
  }
}

async function closeNonHost(gameId: string, hostId: string): Promise<void> {
  const conns = hub["conns"] as Map<string, Map<number, { playerId: string; close: (code?: number, reason?: string) => void }>>;
  const map = conns.get(gameId);
  if (!map) return;
  for (const conn of [...map.values()]) {
    if (conn.playerId !== hostId) {
      try {
        conn.close(4410, "link off");
      } catch {
        // already closed
      }
    }
  }
}

function broadcastWrite(gameId: string, byPlayer: string, msg: Record<string, unknown>): void {
  const team = msg.team as 1 | 2 | undefined;
  if (team !== undefined) {
    hub.broadcastTeam(gameId, team, msg);
  } else {
    hub.broadcast(gameId, msg);
  }
}

async function onSolved(gameId: string, game: GameJSON): Promise<void> {
  const stats = statsOf(game.squares, game.players);
  const elapsed = await elapsedMs(db, gameId, "solved");
  const segs = game.timer_segments;
  const finalSegs = segs.map((s) => ({ started_at: s.started_at, ended_at: s.ended_at ?? new Date().toISOString() }));
  const solvedMsg = {
    type: "solved",
    seq: game.seq,
    elapsed_ms: elapsed,
    revealed_count: game.revealed_count,
    stats,
  };
  hub.broadcast(gameId, solvedMsg);
  await db.query(`UPDATE games SET solved_elapsed_ms = $2, timer_state = 'solved', status = 'solved' WHERE id = $1`, [gameId, elapsed]);
  // history entries for every player
  const seats = await db.query(
    `SELECT s.player_id, pl.display_name, s.colour FROM seats s JOIN players pl ON pl.id = s.player_id WHERE s.game_id = $1 ORDER BY s.joined_at ASC`,
    [gameId],
  );
  const puzzle = await db.query(`SELECT id, title, cols, rows FROM puzzles WHERE id = $1`, [game.puzzle_id]);
  const p = puzzle.rows[0]!;
  for (const seat of seats.rows) {
    await db.query(
      `INSERT INTO history (game_id, player_id, puzzle_id, puzzle_title, cols, rows, elapsed_ms, solved_at, revealed_count, checked_count, stats, record_ready)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)
       ON CONFLICT (game_id, player_id) DO NOTHING`,
      [gameId, seat.player_id, p.id, p.title, p.cols, p.rows, elapsed, new Date().toISOString(), game.revealed_count, game.checked_count, JSON.stringify(stats)],
    );
  }
  try {
    await writeSolveRecord(gameId);
  } catch {
    await deferRecord(gameId);
  }
  void finalSegs;
}

// ---------------------------------------------------------------------------
// Live WebSocket

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://local");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    const apiErr = err as ApiError;
    if (apiErr.status) {
      sendError(res, apiErr);
    } else {
      console.error("server error:", err);
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid", message: "Server error." }));
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://local");
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith("/api/games/") || !pathname.endsWith("/live")) {
    socket.destroy();
    return;
  }
  // Same origin only
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    void handleLive(req, ws, pathname);
  });
});

async function handleLive(req: IncomingMessage, ws: WebSocket, pathname: string): Promise<void> {
  const gameId = pathname.replace("/api/games/", "").replace("/live", "");
  const pid = playerOf(req);
  if (!pid) {
    ws.close(1008, "no player");
    return;
  }
  const game = await canSeeGame(gameId, pid);
  if (!game) {
    ws.close(1008, "not found");
    return;
  }

  const connKey = ++hubConnSeq;
  const send = (msg: unknown) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const close = (code?: number) => ws.close(code ?? 1000);
  hub.register({ playerId: pid, gameId, send, close });
  (hub as unknown as { conns: Map<string, Map<number, { key?: number }>> });
  const map = (hub as unknown as { conns: Map<string, Map<number, unknown & { key?: number }>> }).conns.get(gameId)!;
  const stored = [...map.values()].find((c) => (c as { key?: number }).key === connKey);
  if (stored) (stored as { key: number }).key = connKey;

  // Update presence
  const team = game.players.find((p) => p.id === pid)?.team ?? null;
  hub.setSeatTeam(gameId, pid, team);
  const prev = await db.query(`SELECT connections FROM presence WHERE game_id = $1 AND player_id = $2`, [gameId, pid]);
  const connections = (prev.rows[0]?.connections ?? 0) + 1;
  await db.query(
    `INSERT INTO presence (game_id, player_id, connections, last_seen) VALUES ($1,$2,1,now())
     ON CONFLICT (game_id, player_id) DO UPDATE SET connections = $3, last_seen = now()`,
    [gameId, pid, connections],
  );

  const seat = await db.query(`SELECT colour, display_name FROM seats s JOIN players pl ON pl.id = s.player_id WHERE s.game_id = $1 AND s.player_id = $2`, [gameId, pid]);
  const seatColour = (seat.rows[0]?.colour as Colour | undefined) ?? "teal";
  const displayName = seat.rows[0]?.display_name ?? "";

  const wasPresent = (prev.rows[0]?.connections ?? 0) > 0;
  await goLive(gameId);
  const fresh = await loadGame(db, gameId, team);
  send({ type: "hello", you: pid, game: fresh });

  if (!wasPresent) {
    hub.broadcast(gameId, { type: "presence", player_id: pid, display_name: displayName, colour: seatColour, present: true }, pid);
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState !== 1) return;
    send({ type: "ping" });
  }, config.heartbeatMs);
  heartbeat.unref?.();

  ws.on("message", (data) => {
    void (async () => {
      const raw = data.toString("utf8");
      if (raw.length > LIVE_MESSAGE_LIMIT) {
        ws.close(1009, "too big");
        return;
      }
      if (raw === "pong") return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        send({ type: "error", code: "invalid", message: "Bad message.", client_op_id: null });
        return;
      }
      if (msg.type === "pong") return;
      const rate = hub.rateCheck(pid);
      if (!rate.ok) {
        if (rate.notice) send({ type: "error", code: "rate_limited", message: "Slow down a little.", client_op_id: (msg.client_op_id as string | null) ?? null });
        return;
      }
      if (msg.type === "cursor") {
        const row = msg.row as number;
        const col = msg.col as number;
        const direction = msg.direction as "across" | "down";
        if (typeof row !== "number" || typeof col !== "number" || (direction !== "across" && direction !== "down")) return;
        await db.query(
          `INSERT INTO cursors (game_id, player_id, team, row, col, direction) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (game_id, player_id) DO UPDATE SET team = $3, row = $4, col = $5, direction = $6`,
          [gameId, pid, team, row, col, direction],
        );
        const cursorMsg: Record<string, unknown> = { type: "cursor", player_id: pid, colour: seatColour, row, col, direction };
        if (team !== null) {
          cursorMsg.team = team;
          hub.broadcastTeam(gameId, team, cursorMsg);
        } else if (team === null && game.mode === "shared") {
          hub.broadcast(gameId, cursorMsg, pid);
        }
        return;
      }
      try {
        const response = await dispatchWrite(gameId, pid, msg);
        const out = { ...response };
        if (out.type === "cell" || out.type === "check" || out.type === "reveal" || out.type === "clear" || out.type === "claim") {
          const msgTeam = out.team as 1 | 2 | undefined;
          if (msgTeam !== undefined) {
            hub.broadcastTeam(gameId, msgTeam, out);
          } else {
            hub.broadcast(gameId, out, pid);
          }
        }
        send(out);
        if ((response as { solved?: boolean }).solved) {
          const freshGame = await loadGame(db, gameId, null);
          await onSolved(gameId, freshGame!);
        }
      } catch (err) {
        const apiErr = err as ApiError;
        send({ type: "error", code: apiErr.status ? apiErr.code : "invalid", message: apiErr.message ?? "Write refused.", client_op_id: (msg.client_op_id as string | null) ?? null });
      }
    })();
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    void (async () => {
      await hub.unregister(gameId, pid, connKey);
      const left = hub.connectionsOf(gameId, pid);
      if (left === 0) {
        await db.query(`UPDATE presence SET connections = 0 WHERE game_id = $1 AND player_id = $2`, [gameId, pid]);
        hub.broadcast(gameId, { type: "presence", player_id: pid, display_name: displayName, colour: seatColour, present: false });
        // Grace: pause the timer when the last connection closes
        const anyLeft = [...((hub as unknown as { conns: Map<string, Map<number, { playerId: string }>> }).conns.get(gameId)?.values() ?? [])].length;
        if (anyLeft === 0) {
          hub.startGrace(gameId, async () => {
            const g = await db.query(`SELECT status FROM games WHERE id = $1`, [gameId]);
            if (g.rows[0]?.status === "live") {
              await db.query(`UPDATE games SET status = 'paused', timer_state = 'paused' WHERE id = $1`, [gameId]);
              await db.query(`UPDATE timer_segments SET ended_at = now() - interval '1 millisecond' * $2 WHERE game_id = $1 AND ended_at IS NULL`, [gameId, config.presenceGraceMs]);
              const elapsed = await elapsedMs(db, gameId, "paused");
              hub.broadcast(gameId, { type: "timer", state: "paused", elapsed_ms: elapsed });
            }
          });
        }
      } else {
        await db.query(`UPDATE presence SET connections = $3 WHERE game_id = $1 AND player_id = $2`, [gameId, pid, left]);
      }
    })();
  });
}

let hubConnSeq = 0;

// ---------------------------------------------------------------------------
// Static files

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("Not found");
    return;
  }
  // Never serve source files, manifests, lockfiles or anything with ..
  if (pathname.includes("..")) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const banned = [
    "/run.json",
    "/package.json",
    "/package-lock.json",
    "/tsconfig.json",
    "/THIRD_PARTY_NOTICES.md",
    "/assets/",
    "/src/",
    "/scripts/",
    "/dist/server.js",
  ];
  for (const b of banned) {
    if (pathname === b || pathname.startsWith(b)) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("Not found");
      return;
    }
  }
  let file = pathname;
  if (file === "/") file = "/index.html";
  const root = join(process.cwd(), "dist/public");
  const target = resolve(root, `.${file}`);
  if (!target.startsWith(root)) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("Not found");
    return;
  }
  if (!existsSync(target) || !target.startsWith(join(root))) {
    // SPA fallback for client routes
    const index = join(root, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "content-type": MIME[".html"]! });
      res.end(readFileSync(index));
      return;
    }
  }
  if (!existsSync(target)) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = extname(target);
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(target));
}

// ---------------------------------------------------------------------------
// Grading seed

async function gradingSeed(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const playersOut: Record<string, { id: string; display_name: string }> = {};
  const puzzlesOut: Record<string, { id: string }> = {};
  const gamesOut: Record<string, { id: string; code: string; url: string }> = {};

  const playerKeyToId = new Map<string, string>();
  const players = (body.players as { key: string; display_name: string; settings?: Record<string, boolean> }[] | undefined) ?? [];
  for (const p of players) {
    const pid = id("pl");
    const name = String(p.display_name ?? "").trim();
    await db.query(`INSERT INTO players (id, display_name, skip_filled, jump_next_clue, autocheck) VALUES ($1,$2,$3,$4,$5)`, [
      pid, name,
      p.settings?.skip_filled ?? true,
      p.settings?.jump_next_clue ?? false,
      p.settings?.autocheck ?? false,
    ]);
    playersOut[p.key] = { id: pid, display_name: name };
    playerKeyToId.set(p.key, pid);
  }

  const puzzles = (body.puzzles as { key: string; fixture?: string; text?: string; owner?: string }[] | undefined) ?? [];
  for (const p of puzzles) {
    let pid: string;
    if (p.fixture) {
      const found = await db.query(`SELECT id FROM puzzles WHERE fixture = $1`, [p.fixture]);
      if (found.rowCount === 0) throw apiError(422, "invalid", { message: `Unknown fixture ${p.fixture}.` });
      pid = found.rows[0]!.id;
    } else if (p.text !== undefined) {
      const ownerId = playerKeyToId.get(p.owner ?? "") ?? null;
      if (!ownerId) throw apiError(422, "invalid", { message: "A text puzzle needs an owner." });
      const raw = Buffer.from(String(p.text), "utf8");
      const parsed = parseOverlapText(raw, config.maxGrid);
      if (!parsed.puzzle) throw apiError(422, "invalid", { message: "Seed puzzle does not parse." });
      const sp = parsed.puzzle;
      const newId = id("pz");
      await s3.put(`uploads/${newId}/original.overlap.txt`, raw, "text/plain; charset=utf-8");
      const numbering = computeNumbering(sp.cols, sp.rows, sp.blocks.map((b) => [...b].map((ch) => ch !== "#")));
      const clueRows = sp.clues.map((c) => ({
        number: c.number,
        direction: c.direction,
        row: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.row ?? 0,
        col: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.col ?? 0,
        length: numbering.words.find((w) => w.number === c.number && w.direction === c.direction)?.length ?? 0,
        text: c.text,
      }));
      const clueLists = {
        across: clueRows.filter((c) => c.direction === "across").sort((a, b) => a.number - b.number),
        down: clueRows.filter((c) => c.direction === "down").sort((a, b) => a.number - b.number),
      };
      await db.query(
        `INSERT INTO puzzles (id, title, author, cols, rows, source, fixture, uploader_id, sha256, blocks, numbers, clues, solution)
         VALUES ($1,$2,$3,$4,$5,'upload',NULL,$6,$7,$8,$9,$10,$11)`,
        [newId, sp.title, sp.author, sp.cols, sp.rows, ownerId, sha256Hex(raw), JSON.stringify(sp.blocks), JSON.stringify(sp.numbers), JSON.stringify(clueLists), JSON.stringify(sp.grid)],
      );
      pid = newId;
    } else {
      throw apiError(422, "invalid", { message: "A puzzle needs a fixture or text." });
    }
    puzzlesOut[p.key] = { id: pid };
  }

  const games = (body.games as Record<string, unknown>[] | undefined) ?? [];
  for (const g of games) {
    const puzzleKey = String(g.puzzle ?? "");
    const puzzleId = puzzlesOut[puzzleKey]?.id;
    if (!puzzleId) throw apiError(422, "invalid", { message: "Seed game needs a puzzle." });
    const hostKey = String(g.host ?? "");
    const hostId = playerKeyToId.get(hostKey);
    if (!hostId) throw apiError(422, "invalid", { message: "Seed game needs a host." });
    const mode = (g.mode as "shared" | "race" | undefined) ?? "shared";
    const gid = await createGame(puzzleId, hostId, mode);
    const playerKeys = (g.players as string[] | undefined) ?? [];
    let colourIdx = 1;
    const seated = new Set<string>([hostKey]);
    for (const key of playerKeys) {
      if (seated.has(key)) continue;
      const pid = playerKeyToId.get(key);
      if (!pid) continue;
      await db.query(`INSERT INTO seats (game_id, player_id, colour) VALUES ($1,$2,$3)`, [gid, pid, COLOURS[colourIdx % COLOURS.length]!]);
      colourIdx++;
      seated.add(key);
    }
    if (mode === "race") {
      const teams = (g.teams as Record<string, number> | undefined) ?? {};
      for (const [key, team] of Object.entries(teams)) {
        const pid = playerKeyToId.get(key);
        if (!pid) continue;
        await db.query(`UPDATE seats SET team = $1 WHERE game_id = $2 AND player_id = $3`, [team, gid, pid]);
      }
      if (g.race_state === "racing") {
        await db.query(`UPDATE games SET race_state = 'racing' WHERE id = $1`, [gid]);
      }
    }
    const squares = (g.squares as { row: number; col: number; value: string; pencil?: boolean; state?: string; owner?: string; team?: number }[] | undefined) ?? [];
    for (const sq of squares) {
      const ownerKey = sq.owner;
      const ownerColour = ownerKey ? undefined : undefined;
      void ownerColour;
      const ownerPid = ownerKey ? playerKeyToId.get(ownerKey) : null;
      let colour: string | null = null;
      if (ownerPid) {
        const c = await db.query(`SELECT colour FROM seats WHERE game_id = $1 AND player_id = $2`, [gid, ownerPid]);
        colour = c.rows[0]?.colour ?? null;
      }
      const teamValue = sq.team ?? null;
      if (mode === "race" && teamValue !== null) {
        await db.query(
          `UPDATE squares SET value = $1, pencil = $2, state = $3, owner = $4 WHERE game_id = $5 AND team = $6 AND row = $7 AND col = $8`,
          [sq.value, sq.pencil ?? false, sq.state ?? "filled", colour, gid, teamValue, sq.row, sq.col],
        );
      } else if (mode === "race") {
        // claimed square: both team grids
        for (const t of [1, 2]) {
          await db.query(
            `UPDATE squares SET value = $1, pencil = $2, state = $3, owner = $4 WHERE game_id = $5 AND team = $6 AND row = $7 AND col = $8`,
            [sq.value, sq.pencil ?? false, sq.state ?? "right", colour, gid, t, sq.row, sq.col],
          );
        }
        if (sq.state === "right") {
          const seatOwner = ownerPid;
          const teamOfOwner = await db.query(`SELECT team FROM seats WHERE game_id = $1 AND player_id = $2`, [gid, seatOwner]);
          const t = teamOfOwner.rows[0]?.team as number | undefined;
          if (t) {
            await db.query(`UPDATE seats SET score = score + 1 WHERE game_id = $1 AND player_id = $2`, [gid, seatOwner]);
            const sc = await db.query(`SELECT scores FROM games WHERE id = $1`, [gid]);
            const scores = (sc.rows[0]!.scores as { "1": number; "2": number } | null) ?? { "1": 0, "2": 0 };
            scores[String(t) as "1" | "2"] = (scores[String(t) as "1" | "2"] ?? 0) + 1;
            await db.query(`UPDATE games SET scores = $2 WHERE id = $1`, [gid, JSON.stringify(scores)]);
          }
        }
      } else {
        await db.query(
          `UPDATE squares SET value = $1, pencil = $2, state = $3, owner = $4 WHERE game_id = $5 AND team = 0 AND row = $6 AND col = $7`,
          [sq.value, sq.pencil ?? false, sq.state ?? "filled", colour, gid, sq.row, sq.col],
        );
      }
    }
    const timerState = g.timer_state as string | undefined;
    if (timerState === "running") {
      await db.query(`UPDATE games SET status = 'live', timer_state = 'running' WHERE id = $1`, [gid]);
      await db.query(`INSERT INTO timer_segments (game_id, started_at) VALUES ($1, now())`, [gid]);
    } else {
      await db.query(`UPDATE games SET status = 'paused', timer_state = 'paused' WHERE id = $1`, [gid]);
    }
    if (g.elapsed_ms !== undefined) {
      await db.query(`UPDATE games SET solved_elapsed_ms = $2 WHERE id = $1`, [gid, Number(g.elapsed_ms)]);
    }
    const codeRes = await db.query(`SELECT code FROM games WHERE id = $1`, [gid]);
    gamesOut[String(g.key)] = { id: gid, code: codeRes.rows[0]!.code, url: `/g/${codeRes.rows[0]!.code}` };
  }

  sendJson(res, 201, { players: playersOut, puzzles: puzzlesOut, games: gamesOut });
}

// ---------------------------------------------------------------------------
// Boot

async function boot(): Promise<void> {
  // Postgres retry loop
  for (;;) {
    try {
      await db.query("SELECT 1");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await ensureSchema();
  try {
    await s3.createBucket();
  } catch {
    // storage may be down at boot; the app still serves
  }
  await ensureLibrary();
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`overlap serving on 0.0.0.0:${config.port}`);
  });
}

void boot();
