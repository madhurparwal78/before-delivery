import type { CheckScope, Colour, Direction, SquareState } from "../shared/types.js";
import type { Db } from "./db.js";
import { apiError, type ApiError } from "./errors.js";
import { elapsedMs, opRowToJson, type PuzzleRecord } from "./games.js";
import { pgToIso } from "./util.js";
import type { LiveConn } from "./games.js";

export interface ApplyContext {
  gameId: string;
  mode: "shared" | "race";
  raceState: "lobby" | "racing" | "finished" | null;
  status: "open" | "live" | "paused" | "solved";
  seq: number;
  playerId: string;
  colour: Colour;
  team: 1 | 2 | null;
  puzzle: PuzzleRecord;
}

export type Broadcast = (msg: Record<string, unknown>, opts?: { team?: 1 | 2 | null }) => void;

export interface WriteResult {
  response: Record<string, unknown>;
  broadcast: Record<string, unknown> | null;
  error?: ApiError;
}

interface SquareRow {
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: string | null;
  team: number | null;
}

const whiteAt = (puzzle: PuzzleRecord, row: number, col: number): boolean =>
  puzzle.blocks[row]?.[col] !== "#";

const answerAt = (puzzle: PuzzleRecord, row: number, col: number): string =>
  puzzle.solution[row]?.[col] ?? "";

/**
 * The one place where the solve test is decided: every white square's entry equals its answer.
 * Comparison ignores case, a rebus must match its full string, and pencil entries count.
 */
export function isSolved(puzzle: PuzzleRecord, squares: SquareRow[]): boolean {
  for (const sq of squares) {
    if (!whiteAt(puzzle, sq.row, sq.col)) continue;
    if (sq.value.toUpperCase() !== answerAt(puzzle, sq.row, sq.col)) return false;
  }
  return true;
}

function wordCells(puzzle: PuzzleRecord, row: number, col: number, direction: Direction): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = [];
  if (direction === "across") {
    let c = col;
    while (c > 0 && whiteAt(puzzle, row, c - 1)) c--;
    while (c < puzzle.cols && whiteAt(puzzle, row, c)) {
      cells.push({ row, col: c });
      c++;
    }
  } else {
    let r = row;
    while (r > 0 && whiteAt(puzzle, r - 1, col)) r--;
    while (r < puzzle.rows && whiteAt(puzzle, r, col)) {
      cells.push({ row: r, col });
      r++;
    }
  }
  return cells.length >= 2 ? cells : [];
}

function scopeCells(ctx: ApplyContext, scope: CheckScope, row: number, col: number, direction: Direction | null): { row: number; col: number }[] {
  if (scope === "square") return [{ row, col }];
  if (scope === "word") return wordCells(ctx.puzzle, row, col, direction ?? "across");
  const cells: { row: number; col: number }[] = [];
  for (let r = 0; r < ctx.puzzle.rows; r++)
    for (let c = 0; c < ctx.puzzle.cols; c++) if (whiteAt(ctx.puzzle, r, c)) cells.push({ row: r, col: c });
  return cells;
}

interface Tx {
  query: Db["query"];
}

/**
 * Applies one write inside a transaction. All validation, state changes, sequencing and
 * solve detection happen here; the caller broadcasts the returned message.
 */
export async function applyWrite(
  client: { query: Db["query"] },
  ctx: ApplyContext,
  write: Record<string, unknown>,
  autocheckEnabled: boolean,
): Promise<WriteResult> {
  const gameId = ctx.gameId;
  const type = write.type as string;
  const clientOpId = (write.client_op_id as string | undefined) ?? null;

  // Reload squares for this game/team
  const teamClause = ctx.mode === "race" ? `AND team = $2` : `AND team = 0`;
  const sqRes = await client.query(
    `SELECT row, col, value, pencil, state, owner, team FROM squares WHERE game_id = $1 ${teamClause}`,
    ctx.mode === "race" ? [gameId, ctx.team] : [gameId],
  );
  const squares = sqRes.rows as SquareRow[];
  const sqAt = (row: number, col: number): SquareRow | undefined => squares.find((s) => s.row === row && s.col === col);

  if (type === "cell") {
    const row = write.row as number;
    const col = write.col as number;
    const value = String(write.value ?? "").toUpperCase();
    const pencil = Boolean(write.pencil);
    if (typeof row !== "number" || typeof col !== "number" || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= ctx.puzzle.rows || col < 0 || col >= ctx.puzzle.cols || !whiteAt(ctx.puzzle, row, col)) {
      throw apiError(422, "invalid", { message: "Invalid square." });
    }
    if (value !== "" && !/^[A-Z0-9]{1,8}$/.test(value)) throw apiError(422, "invalid", { message: "Invalid value." });
    const sq = sqAt(row, col)!;
    if (sq.state === "right" || sq.state === "revealed") throw apiError(409, "square_locked");

    const autocheck = autocheckEnabled && !pencil && value !== "" && ctx.mode !== "race";
    let newState: SquareState = value === "" ? "empty" : pencil ? "pencil" : "filled";
    if (autocheck) {
      newState = value === answerAt(ctx.puzzle, row, col) ? "right" : "wrong";
    }
    const owner = value === "" ? null : ctx.colour;

    const seq = ctx.seq + 1;
    if (ctx.mode === "race") {
      await client.query(
        `UPDATE squares SET value = $1, pencil = $2, state = $3, owner = $4
         WHERE game_id = $5 AND team = $6 AND row = $7 AND col = $8`,
        [value, autocheck ? false : pencil, newState, owner, gameId, ctx.team, row, col],
      );
    } else {
      await client.query(
        `UPDATE squares SET value = $1, pencil = $2, state = $3, owner = $4
         WHERE game_id = $5 AND team = 0 AND row = $6 AND col = $7`,
        [value, autocheck ? false : pencil, newState, owner, gameId, row, col],
      );
    }
    const opData = { row, col, value, pencil: autocheck ? false : pencil, state: newState, autocheck, ...(ctx.mode === "race" ? { team: ctx.team } : {}) };
    await client.query(
      `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'cell',$3,$4,$5,$6)`,
      [seq, gameId, ctx.playerId, clientOpId, ctx.team, opData],
    );
    await client.query(`UPDATE games SET seq = $1 WHERE id = $2`, [seq, gameId]);

    const response = {
      type: "cell",
      seq,
      row,
      col,
      value,
      pencil: autocheck ? false : pencil,
      state: newState,
      owner,
      by: ctx.playerId,
      client_op_id: clientOpId,
      autocheck,
      ...(ctx.mode === "race" ? { team: ctx.team } : {}),
    };

    // Solve test (shared games only; races finish on the last claim)
    if (ctx.mode !== "race") {
      const updated = squares.map((s) => (s.row === row && s.col === col ? { ...s, value, pencil, state: newState } : s));
      if (isSolved(ctx.puzzle, updated)) {
        const solved = await finishSolve(client, gameId, seq);
        return { response: { ...response, solved: true }, broadcast: response };
      }
    }
    return { response, broadcast: response };
  }

  if (type === "check" || type === "reveal") {
    const scope = write.scope as CheckScope;
    const row = write.row as number | null | undefined;
    const col = write.col as number | null | undefined;
    const direction = (write.direction as Direction | null | undefined) ?? null;
    if (scope !== "square" && scope !== "word" && scope !== "puzzle") throw apiError(422, "invalid", { message: "Invalid scope." });
    if (ctx.mode === "race") {
      if (scope !== "square") throw apiError(422, "invalid", { message: "Invalid scope." });
      if (ctx.raceState !== "racing") throw apiError(409, "race_not_started");
      if (ctx.team === null) throw apiError(403, "watching");
      if (typeof row !== "number" || typeof col !== "number") throw apiError(422, "invalid", { message: "Invalid square." });
      return applyRaceClaim(client, ctx, row, col, clientOpId, squares, sqAt);
    }
    if (ctx.status === "solved") throw apiError(409, "game_solved");
    if (scope === "square" && (typeof row !== "number" || typeof col !== "number")) throw apiError(422, "invalid", { message: "Invalid square." });
    if (scope === "word" && (typeof row !== "number" || typeof col !== "number" || (direction !== "across" && direction !== "down"))) throw apiError(422, "invalid", { message: "Invalid word." });
    const cells = scopeCells(ctx, scope, row ?? 0, col ?? 0, direction);
    const seq = ctx.seq + 1;

    if (type === "check") {
      const changed: { row: number; col: number; state: SquareState }[] = [];
      let wrong = 0;
      for (const cell of cells) {
        const sq = sqAt(cell.row, cell.col);
        if (!sq || sq.value === "" || sq.state === "right" || sq.state === "revealed") continue;
        const answer = answerAt(ctx.puzzle, cell.row, cell.col);
        const newState: SquareState = sq.value.toUpperCase() === answer ? "right" : "wrong";
        changed.push({ row: cell.row, col: cell.col, state: newState });
        if (newState === "wrong") wrong++;
        await client.query(
          `UPDATE squares SET state = $1, pencil = $2 WHERE game_id = $3 AND team = 0 AND row = $4 AND col = $5`,
          [newState, newState === "right" ? false : sq.pencil, gameId, cell.row, cell.col],
        );
      }
      await client.query(
        `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'check',$3,$4,$5,$6)`,
        [seq, gameId, ctx.playerId, clientOpId, ctx.team, { scope, row, col, direction, wrong, squares: changed }],
      );
      await client.query(`UPDATE games SET seq = $1, checked_count = checked_count + 1 WHERE id = $2`, [seq, gameId]);
      const response = { type: "check", seq, scope, by: ctx.playerId, wrong, squares: changed };
      return { response, broadcast: response };
    }

    // reveal
    const changed: { row: number; col: number; value: string; state: "revealed"; owner: Colour }[] = [];
    let revealed = 0;
    for (const cell of cells) {
      const sq = sqAt(cell.row, cell.col);
      if (!sq || sq.state === "right" || sq.state === "revealed") continue;
      const answer = answerAt(ctx.puzzle, cell.row, cell.col);
      await client.query(
        `UPDATE squares SET value = $1, pencil = FALSE, state = 'revealed', owner = $2 WHERE game_id = $3 AND team = 0 AND row = $4 AND col = $5`,
        [answer, ctx.colour, gameId, cell.row, cell.col],
      );
      changed.push({ row: cell.row, col: cell.col, value: answer, state: "revealed" as const, owner: ctx.colour });
      revealed++;
    }
    const segRes = await client.query(`SELECT revealed_count FROM games WHERE id = $1`, [gameId]);
    const newCount = Number(segRes.rows[0]?.revealed_count ?? 0) + revealed;
    await client.query(
      `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'reveal',$3,$4,$5,$6)`,
      [seq, gameId, ctx.playerId, clientOpId, ctx.team, { scope, row, col, direction, revealed, squares: changed }],
    );
    await client.query(`UPDATE games SET seq = $1, revealed_count = $2 WHERE id = $3`, [seq, newCount, gameId]);
    const response = { type: "reveal", seq, scope, by: ctx.playerId, revealed, squares: changed };

    const updated = squares.map((s) => {
      const hit = changed.find((c) => c.row === s.row && c.col === s.col);
      return hit ? { ...s, value: hit.value, pencil: false, state: "revealed" as SquareState, owner: ctx.colour } : s;
    });
    if (isSolved(ctx.puzzle, updated)) {
      await finishSolve(client, gameId, seq);
    }
    return { response, broadcast: response };
  }

  if (type === "clear") {
    if (ctx.mode === "race") {
      if (ctx.raceState !== "racing") throw apiError(409, "race_not_started");
      if (ctx.team === null) throw apiError(403, "watching");
      const scope = write.scope as string;
      if (scope !== "word") throw apiError(422, "invalid", { fields: { scope: "Only word clears are allowed in a race." } });
    } else if (ctx.status === "solved") {
      throw apiError(409, "game_solved");
    }
    const scope = write.scope as "word" | "puzzle";
    if (scope !== "word" && scope !== "puzzle") throw apiError(422, "invalid", { fields: { scope: "Scope must be word or puzzle." } });
    const row = write.row as number | null | undefined;
    const col = write.col as number | null | undefined;
    const direction = (write.direction as Direction | null | undefined) ?? null;
    if (scope === "word" && (typeof row !== "number" || typeof col !== "number" || (direction !== "across" && direction !== "down"))) {
      throw apiError(422, "invalid", { fields: { scope: "A word clear needs a square and a direction." } });
    }

    const seq = ctx.seq + 1;
    let cells: { row: number; col: number }[];
    if (scope === "word") {
      cells = wordCells(ctx.puzzle, row!, col!, direction!);
    } else {
      cells = [];
      for (let r = 0; r < ctx.puzzle.rows; r++)
        for (let c = 0; c < ctx.puzzle.cols; c++) if (whiteAt(ctx.puzzle, r, c)) cells.push({ row: r, col: c });
    }

    // The one place where the Clear word protection rule is decided.
    let toClear: { row: number; col: number }[];
    if (scope === "word") {
      const candidates = cells
        .map((cell) => sqAt(cell.row, cell.col))
        .filter((sq): sq is SquareRow => Boolean(sq && sq.value !== "" && sq.state !== "right" && sq.state !== "revealed"));
      const other = direction === "across" ? "down" : "across";
      const unprotected = candidates.filter((sq) => {
        const crossing = wordCells(ctx.puzzle, sq.row, sq.col, other);
        if (crossing.length === 0) return true;
        return !crossing.every((cell) => {
          const c = sqAt(cell.row, cell.col);
          return Boolean(c && c.value !== "");
        });
      });
      toClear = (unprotected.length > 0 ? unprotected : candidates).map((sq) => ({ row: sq.row, col: sq.col }));
    } else {
      toClear = cells.filter((cell) => {
        const sq = sqAt(cell.row, cell.col);
        return Boolean(sq && sq.value !== "" && sq.state !== "right" && sq.state !== "revealed");
      });
    }
    toClear.sort((a, b) => a.row - b.row || a.col - b.col);

    for (const cell of toClear) {
      if (ctx.mode === "race") {
        await client.query(
          `UPDATE squares SET value = '', pencil = FALSE, state = 'empty', owner = NULL
           WHERE game_id = $1 AND team = $2 AND row = $3 AND col = $4`,
          [gameId, ctx.team, cell.row, cell.col],
        );
      } else {
        await client.query(
          `UPDATE squares SET value = '', pencil = FALSE, state = 'empty', owner = NULL
           WHERE game_id = $1 AND team = 0 AND row = $2 AND col = $3`,
          [gameId, cell.row, cell.col],
        );
      }
    }
    await client.query(
      `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'clear',$3,$4,$5,$6)`,
      [seq, gameId, ctx.playerId, clientOpId, ctx.team, { scope, row, col, direction, cleared: toClear.length, squares: toClear }],
    );
    await client.query(`UPDATE games SET seq = $1 WHERE id = $2`, [seq, gameId]);
    const response = { type: "clear", seq, scope, by: ctx.playerId, cleared: toClear.length, squares: toClear, ...(ctx.mode === "race" ? { team: ctx.team } : {}) };
    return { response, broadcast: response };
  }

  throw apiError(422, "invalid", { message: "Unknown write type." });
}

/**
 * The one place where the race claim is decided: a right check claims the square for
 * the team in both grids and scores one point; a wrong check marks only the checker's grid.
 */
async function applyRaceClaim(
  client: { query: Db["query"] },
  ctx: ApplyContext,
  row: number,
  col: number,
  clientOpId: string | null,
  squares: SquareRow[],
  sqAt: (row: number, col: number) => SquareRow | undefined,
): Promise<WriteResult> {
  const sq = sqAt(row, col);
  if (!sq || sq.value === "") throw apiError(422, "invalid", { message: "A claim needs a filled square." });
  const answer = answerAt(ctx.puzzle, row, col);
  const seq = ctx.seq + 1;

  if (sq.value.toUpperCase() === answer) {
    for (const team of [1, 2] as const) {
      await client.query(
        `UPDATE squares SET value = $1, pencil = FALSE, state = 'right', owner = $2
         WHERE game_id = $3 AND team = $4 AND row = $5 AND col = $6`,
        [answer, ctx.colour, ctx.gameId, team, row, col],
      );
    }
    const scoresRes = await client.query(`SELECT scores FROM games WHERE id = $1`, [ctx.gameId]);
    const scores = (scoresRes.rows[0]?.scores as { "1": number; "2": number } | null) ?? { "1": 0, "2": 0 };
    const teamKey = String(ctx.team) as "1" | "2";
    scores[teamKey] = (scores[teamKey] ?? 0) + 1;
    await client.query(`UPDATE games SET scores = $1, seq = $2 WHERE id = $3`, [scores, seq, ctx.gameId]);
    await client.query(`UPDATE seats SET score = score + 1 WHERE game_id = $1 AND player_id = $2`, [ctx.gameId, ctx.playerId]);
    await client.query(
      `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'claim',$3,$4,$5,$6)`,
      [seq, ctx.gameId, ctx.playerId, clientOpId, ctx.team, { row, col, value: answer, owner: ctx.colour, team: ctx.team, scores }],
    );
    const response = { type: "claim", seq, row, col, value: answer, owner: ctx.colour, team: ctx.team, by: ctx.playerId, scores, client_op_id: clientOpId };

    // Race end: every white square claimed
    const claimRes = await client.query(
      `SELECT COUNT(*) AS n FROM squares WHERE game_id = $1 AND team = 0 AND state = 'right'`,
      [ctx.gameId],
    );
    const claimed = Number(claimRes.rows[0]?.n ?? 0);
    const whites = await client.query(
      `SELECT COUNT(*) AS n FROM squares WHERE game_id = $1 AND team = 0`,
      [ctx.gameId],
    );
    const whiteCount = Number(whites.rows[0]?.n ?? 0);
    void squares;
    if (claimed >= whiteCount && whiteCount > 0) {
      await client.query(`UPDATE games SET race_state = 'finished', status = 'solved', timer_state = 'solved', solved_at = now(), solved_seq = $2, solved_elapsed_ms = $3 WHERE id = $1`, [ctx.gameId, seq, await elapsedMs({ query: client.query } as unknown as Db, ctx.gameId, "solved")]);
      await client.query(`UPDATE timer_segments SET ended_at = now() WHERE game_id = $1 AND ended_at IS NULL`, [ctx.gameId]);
      return { response, broadcast: response };
    }
    return { response, broadcast: response };
  }

  // wrong check: mark only the checker's team grid
  await client.query(
    `UPDATE squares SET state = 'wrong' WHERE game_id = $1 AND team = $2 AND row = $3 AND col = $4`,
    [ctx.gameId, ctx.team, row, col],
  );
  await client.query(
    `INSERT INTO ops (seq, game_id, type, by, client_op_id, team, data) VALUES ($1,$2,'check',$3,$4,$5,$6)`,
    [seq, ctx.gameId, ctx.playerId, clientOpId, ctx.team, { scope: "square", row, col, direction: null, wrong: 1, squares: [{ row, col, state: "wrong" }], team: ctx.team }],
  );
  await client.query(`UPDATE games SET seq = $1, checked_count = checked_count + 1 WHERE id = $2`, [seq, ctx.gameId]);
  const response = { type: "check", seq, scope: "square", by: ctx.playerId, wrong: 1, squares: [{ row, col, state: "wrong" as SquareState }], team: ctx.team };
  return { response, broadcast: response };
}

/** The one place where a solve is recorded. */
async function finishSolve(client: { query: Db["query"] }, gameId: string, seq: number): Promise<void> {
  await client.query(
    `UPDATE games SET status = 'solved', timer_state = 'solved', solved_at = now(), solved_seq = $2 WHERE id = $1`,
    [gameId, seq],
  );
  await client.query(`UPDATE timer_segments SET ended_at = now() WHERE game_id = $1 AND ended_at IS NULL`, [gameId]);
}

export type { LiveConn, ApiError };
