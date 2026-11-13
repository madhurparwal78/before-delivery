import { config } from "./config";
import type { Ctx, Reply } from "./context";
import { json, requireRole, roundNumber } from "./context";
import { isUniqueViolation, pool, tx } from "./db";
import { conflict, notFound, unavailable } from "./errors";
import { loadRound, loadRounds } from "./query";
import type { SheetType } from "./sheet";
import { checkSheet } from "./sheet";
import { NIGHT } from "./seed";
import { StorageUnavailable, confirmObject, getObject, putObject } from "./storage";
import { loadTable } from "./table";
import type { Round, RoundStatus } from "../shared/api-types";

function theRound(ctx: Ctx): number {
  const number = roundNumber(ctx.params[0]);
  if (number === null) throw notFound();
  return number;
}

export async function listRounds(): Promise<Reply> {
  return json(200, { night: NIGHT, server_time: new Date().toISOString(), rounds: await loadRounds(pool) });
}

export async function showRound(ctx: Ctx): Promise<Reply> {
  const round = await loadRound(pool, theRound(ctx));
  return json(200, { round });
}

interface Locked {
  status: RoundStatus;
  kind: "standard" | "picture";
  sheet_key: string | null;
  sheet_size: number | null;
  sheet_sha256: string | null;
}

/**
 * The round machine, in one place. Every move locks the round's row, checks its refusals in the
 * published order and changes its status only along drafted -> open -> closed -> marked -> published.
 */
async function lockRound(client: Parameters<Parameters<typeof tx>[0]>[0], number: number): Promise<Locked> {
  const result = await client.query<Locked>(
    "SELECT status, kind, sheet_key, sheet_size, sheet_sha256 FROM rounds WHERE number = $1 FOR UPDATE",
    [number],
  );
  return result.rows[0] as Locked;
}

export async function openRound(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  requireRole(ctx, "quizmaster");
  await tx(async (client) => {
    const round = await lockRound(client, number);
    if (round.status !== "drafted") throw conflict("round_not_drafted");
    const busy = await client.query("SELECT 1 FROM rounds WHERE status = 'open'");
    if (busy.rowCount !== 0) throw conflict("another_round_open");
    if (round.kind === "picture") {
      if (round.sheet_key === null) throw conflict("sheet_not_stored");
      try {
        await confirmObject(round.sheet_key, round.sheet_size as number, round.sheet_sha256 as string);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw unavailable("storage_unavailable");
        throw error;
      }
    }
    try {
      await client.query(
        `UPDATE rounds SET status = 'open', opened_at = t.ts, closes_at = t.ts + make_interval(secs => $2)
         FROM (SELECT clock_timestamp() AS ts) t WHERE number = $1`,
        [number, config.roundSeconds],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("another_round_open");
      throw error;
    }
  });
  return json(200, { round: await loadRound(pool, number) });
}

export async function closeRound(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  requireRole(ctx, "quizmaster");
  const closed = await pool.query(
    "UPDATE rounds SET status = 'closed', closed_at = clock_timestamp() WHERE number = $1 AND status = 'open'",
    [number],
  );
  if (closed.rowCount === 0) throw conflict("round_not_open");
  return json(200, { round: await loadRound(pool, number) });
}

export async function finishMarking(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  requireRole(ctx, "marker");
  await tx(async (client) => {
    const round = await lockRound(client, number);
    if (round.status !== "closed") throw conflict("round_not_closed");
    const left = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM answers WHERE round = $1 AND current AND mark IS NULL",
      [number],
    );
    const unmarked = left.rows[0]?.count ?? 0;
    if (unmarked > 0) throw conflict("unmarked_answers", unmarked);
    await client.query("UPDATE rounds SET status = 'marked' WHERE number = $1", [number]);
  });
  return json(200, { round: await loadRound(pool, number) });
}

export async function publishRound(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  requireRole(ctx, "quizmaster");
  await tx(async (client) => {
    const round = await lockRound(client, number);
    if (round.status !== "marked") throw conflict("round_not_marked");
    const open = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM disputes d JOIN answers a ON a.id = d.answer_id
       WHERE a.round = $1 AND d.status = 'raised'`,
      [number],
    );
    const raised = open.rows[0]?.count ?? 0;
    if (raised > 0) throw conflict("disputes_pending", raised);
    await client.query("UPDATE rounds SET status = 'published', published_at = clock_timestamp() WHERE number = $1", [number]);
    await client.query("UPDATE league SET table_version = table_version + 1");
  });
  return json(200, { round: await loadRound(pool, number), table: await loadTable(pool) });
}

export async function uploadSheet(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  requireRole(ctx, "quizmaster");
  const round = (await loadRound(pool, number)) as Round;
  if (round.kind !== "picture") throw conflict("not_picture_round");
  if (round.status !== "drafted") throw conflict("round_not_drafted");
  const declared = (ctx.req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() as SheetType;
  const sheet = checkSheet(ctx.bytes, declared);
  const key = `sheets/night-${NIGHT}/round-${number}/${sheet.sha256}.${sheet.extension}`;
  try {
    await putObject(key, sheet.bytes, sheet.contentType);
    await confirmObject(key, sheet.bytes.length, sheet.sha256);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw unavailable("storage_unavailable");
    throw error;
  }
  const stored = await pool.query(
    `UPDATE rounds SET sheet_key = $2, sheet_content_type = $3, sheet_size = $4, sheet_sha256 = $5,
       sheet_width = $6, sheet_height = $7 WHERE number = $1 AND status = 'drafted'`,
    [number, key, sheet.contentType, sheet.bytes.length, sheet.sha256, sheet.width, sheet.height],
  );
  if (stored.rowCount === 0) throw conflict("round_not_drafted");
  return json(201, { round: await loadRound(pool, number) });
}

export async function downloadSheet(ctx: Ctx): Promise<Reply> {
  const number = theRound(ctx);
  const session = requireRole(ctx, "quizmaster", "marker", "captain");
  const round = (await loadRound(pool, number)) as Round;
  if (round.status === "drafted" && session.role !== "quizmaster") throw conflict("round_not_open");
  if (round.sheet === null || round.sheet.key === null) throw notFound();
  try {
    const stored = await getObject(round.sheet.key);
    return { status: 200, image: { bytes: stored.bytes, contentType: stored.contentType } };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw unavailable("storage_unavailable");
    throw error;
  }
}
