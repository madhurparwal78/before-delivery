import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { errors, sendJson } from "./errors.js";
import {
  validateSignup,
  findUserByUsername,
  createSession,
  advanceClock,
  isoNow,
  newId,
} from "./auth.js";
import { withTransaction } from "./db.js";
import * as T from "./tournaments.js";
import * as M from "./matches.js";
import * as F from "./formats.js";
import type { Tournament, TournamentFormat } from "../shared/types.js";
import type { EntrantRow } from "./brackets.js";

interface SeedEntrantSpec {
  name: string;
  seed?: number;
  username?: string;
  checked_in?: boolean;
}

type SeedStep =
  | { action: "called"; match?: string }
  | { action: "reported"; match?: string; upper_games: number; lower_games: number; by: string }
  | {
      action: "disputed";
      match?: string;
      upper_games: number;
      lower_games: number;
      by: string;
      counter: { upper_games: number; lower_games: number };
    }
  | { action: "confirmed"; match?: string; upper_games: number; lower_games: number; by?: string }
  | { action: "resolved"; match?: string; upper_games: number; lower_games: number; resolver?: string }
  | { action: "next_round" };

interface SeedTournamentSpec {
  key: string;
  name: string;
  format: TournamentFormat;
  organizer: string;
  co_organizers?: string[];
  time_zone?: string;
  fill?: string;
  state?: string;
  checkin_closes_at?: string;
  entrants: SeedEntrantSpec[];
  steps?: SeedStep[];
}

interface SeedRequest {
  users?: { username: string; password: string }[];
  tournaments?: SeedTournamentSpec[];
}

export async function handleGrading(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string
): Promise<void> {
  if (!config.grading) throw errors.notFound();
  const body = method === "POST" ? await readBody(req) : {};

  if (pathname === "/api/grading/seed" && method === "POST") {
    await gradingSeed(res, body as SeedRequest);
    return;
  }
  if (pathname === "/api/grading/session" && method === "POST") {
    const b = body as { username?: string };
    const user = await findUserByUsername(String(b.username ?? ""));
    if (!user) throw errors.notFound();
    await createSession(res, user.id);
    sendJson(res, 200, { user: { username: user.username } });
    return;
  }
  if (pathname === "/api/grading/clock" && method === "POST") {
    const b = body as { advance_ms?: number };
    const ms = Number(b.advance_ms);
    if (!Number.isInteger(ms) || ms < 0 || ms > 604800000) {
      throw errors.validationMsg("Check the highlighted fields.");
    }
    advanceClock(ms);
    const { runDeadlines } = await import("./timers.js");
    await runDeadlines();
    sendJson(res, 200, { server_time: isoNow() });
    return;
  }
  throw errors.notFound();
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 65536) throw errors.tooLargeJson();
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

async function gradingSeed(res: ServerResponse, body: SeedRequest): Promise<void> {
  const createdUserIds = new Map<string, string>();
  const createdTournamentIds = new Map<string, string>();
  try {
    // users are created first, under the account rules
    for (const u of body.users ?? []) {
      const created = await withTransaction((tx) => validateSignup(tx, u.username, u.password));
      createdUserIds.set(created.username, created.id);
    }
    for (const spec of body.tournaments ?? []) {
      const ids = await seedOneTournament(spec, createdUserIds);
      createdTournamentIds.set(spec.key, ids.tid);
    }
  } catch (e) {
    if (e instanceof Error && "status" in e) {
      const err = e as unknown as { status: number; code: string; message: string; extra?: Record<string, unknown> };
      sendJson(res, err.status, { error: err.code, message: err.message, ...(err.extra ?? {}) });
      return;
    }
    throw e;
  }
  const userOut: Record<string, { id: string }> = {};
  for (const [username, id] of createdUserIds) userOut[username] = { id };
  const tOut: Record<string, unknown> = {};
  for (const [key, tid] of createdTournamentIds) {
    const t = await T.getTournamentRow(tid);
    const entrants = await T.getEntrantRows(tid);
    const matches = await T.getMatchRows(tid);
    const entrantNames: Record<string, string> = {};
    for (const e of entrants) entrantNames[e.name] = e.id;
    const matchNames: Record<string, string> = {};
    for (const m of matches) matchNames[m.label] = m.id;
    tOut[key] = { id: tid, share_code: t?.share_code ?? "", entrants: entrantNames, matches: matchNames };
  }
  sendJson(res, 201, { users: userOut, tournaments: tOut });
}

async function seedOneTournament(
  spec: SeedTournamentSpec,
  userIds: Map<string, string>
): Promise<{ tid: string }> {
  const organizerId = userIds.get(spec.organizer) ?? (await findUserByUsername(spec.organizer))?.id;
  if (!organizerId) throw errors.validationMsg("Check the highlighted fields.");
  const tid = newId();
  const shareCode = shareCodeNew();
  const state = (spec.state ?? "draft") as Tournament["state"];
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO tournaments (id, name, format, state, fill, time_zone, organizer_id, share_code, seeding_version, checkin_closes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
      [
        tid,
        spec.name,
        spec.format,
        state === "running" || state === "finished" ? "draft" : state,
        (spec.fill ?? "lilac") as Tournament["fill"],
        spec.time_zone ?? "UTC",
        organizerId,
        shareCode,
        spec.checkin_closes_at ?? null,
      ]
    );
    for (const co of spec.co_organizers ?? []) {
      const coId = userIds.get(co) ?? (await findUserByUsername(co))?.id;
      if (coId) await tx.query(`INSERT INTO co_organizers (tournament_id, user_id) VALUES ($1,$2)`, [tid, coId]);
    }
    let seed = 1;
    for (const e of spec.entrants) {
      const id = newId();
      const eSeed = e.seed ?? seed;
      seed += 1;
      const username = e.username ?? null;
      const userId = username ? (userIds.get(username) ?? (await findUserByUsername(username))?.id ?? null) : null;
      await tx.query(
        `INSERT INTO entrants (id, tournament_id, name, seed, username, user_id, checked_in) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, tid, e.name, eSeed, username, userId, e.checked_in ?? false]
      );
    }
    if (state === "running" || state === "finished") {
      const t0 = (await tx.one<T.TournamentRow>(`SELECT * FROM tournaments WHERE id = $1`, [tid]))!;
      const entrantRows = (await tx.all<EntrantRow>(
        `SELECT id, tournament_id, name, seed, username, checked_in FROM entrants WHERE tournament_id = $1 ORDER BY seed`,
        [tid]
      )) as EntrantRow[];
      const now = isoNow();
      await T.buildBracket(tx, t0, entrantRows, now);
      await tx.query(`UPDATE tournaments SET state = 'running', started_at = $2, field_size = $3 WHERE id = $1`, [
        tid,
        now,
        entrantRows.length,
      ]);
    } else if (state === "checkin_open" || state === "checkin_closed") {
      await tx.query(`UPDATE tournaments SET state = $2 WHERE id = $1`, [tid, state]);
    }
  });
  // steps apply through the same rules as live play, at the current server time
  await applySteps(spec, tid, userIds);
  if (spec.state === "finished") {
    const t = await T.getTournamentRow(tid);
    if (!t || t.state !== "finished") {
      const { maybeFinish } = await import("./matches.js");
      const ok = await maybeFinish(t!);
      if (!ok) {
        await withTransaction(async (tx) => {
          await tx.query(`DELETE FROM live_messages WHERE tournament_id = $1`, [tid]);
          await tx.query(`DELETE FROM feed_edges WHERE tournament_id = $1`, [tid]);
          await tx.query(`DELETE FROM tournaments WHERE id = $1`, [tid]);
        });
        throw errors.validationMsg("Seed steps do not finish the tournament.");
      }
    }
  }
  return { tid };
}

async function applySteps(
  spec: SeedTournamentSpec,
  tid: string,
  userIds: Map<string, string>
): Promise<void> {
  const usernameFor = (entrantName: string): string | null => {
    for (const e of spec.entrants) {
      if (e.name === entrantName) return e.username ?? null;
    }
    return null;
  };
  const actorFor = async (entrantName: string): Promise<{ user: { id: string; username: string }; entrantRow: EntrantRow | null }> => {
    const { one } = await import("./db.js");
    const entrantRow = (await one<EntrantRow>(
      `SELECT id, tournament_id, name, seed, username, checked_in FROM entrants WHERE tournament_id = $1 AND name = $2`,
      [tid, entrantName]
    )) ?? null;
    const uname = usernameFor(entrantName);
    const uid = uname ? (userIds.get(uname) ?? (await findUserByUsername(uname))?.id ?? "") : "";
    return { user: { id: uid, username: uname ?? entrantName }, entrantRow };
  };
  for (const step of spec.steps ?? []) {
    const t = (await T.getTournamentRow(tid))!;
    if (step.action === "next_round") {
      if (t.format !== "swiss") throw errors.ws("Only Swiss tournaments have a next round.");
      const matches = await T.getMatchRows(tid);
      const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
      const latest = rounds[rounds.length - 1] ?? 0;
      const done = matches
        .filter((m) => m.round === latest)
        .every((m) => ["confirmed", "resolved", "bye", "not_needed"].includes(m.state));
      if (!done) throw errors.ws(`Finish every match in round ${latest} first.`);
      const entrantRows = await T.getEntrantRows(tid);
      await withTransaction(async (tx) => {
        await F.pairSwissRound(tx, t, entrantRows, latest + 1, isoNow());
      });
      const { recordMessage } = await import("./live.js");
      const nameOf = T.makeNameLookup(entrantRows);
      for (const m of (await T.getMatchRows(tid)).filter((m) => m.round === latest + 1)) {
        await recordMessage(tid, "match.updated", { match: T.toMatch(m, nameOf, true) });
      }
      await recordMessage(tid, "announcement", { text: `Round ${latest + 1} is paired` });
      continue;
    }
    const stepMatch = (await T.getMatchRows(tid)).find((m) => m.label === step.match);
    const matchId = stepMatch?.id;
    if (!matchId) throw errors.validationMsg("Seed steps do not finish the tournament.");
    const stepVersion = stepMatch!.version;
    const baseCtx: M.MatchWriteContext = {
      tournament: t,
      user: { id: userIds.get(spec.organizer) ?? "", username: spec.organizer },
      isOrganizer: true,
      entrantRow: null,
      skipRateLimit: true,
    };
    switch (step.action) {
      case "called": {
        await M.callMatch(matchId, stepVersion, baseCtx);
        break;
      }
      case "reported":
      case "confirmed": {
        if (step.by !== undefined) {
          const actor = await actorFor(step.by);
          await M.reportMatch(
            matchId,
            { upper_games: step.upper_games, lower_games: step.lower_games, version: stepVersion },
            { tournament: t, user: actor.user, isOrganizer: false, entrantRow: actor.entrantRow, skipRateLimit: true }
          );
          if (step.action === "confirmed") {
            // the opponent confirms; the report bumped the version
            const m = (await T.getMatchRows(tid)).find((x) => x.id === matchId)!;
            const myId = actor.entrantRow?.id ?? null;
            const opponentId = m.upper_entrant_id === myId ? m.lower_entrant_id : m.upper_entrant_id;
            const opponentRow = (await T.getEntrantRows(tid)).find((e) => e.id === opponentId) ?? null;
            const oppName = opponentRow?.name ?? "";
            const oppActor = await actorFor(oppName);
            await M.confirmMatch(matchId, m.version, {
              tournament: t,
              user: oppActor.user,
              isOrganizer: false,
              entrantRow: opponentRow,
              skipRateLimit: true,
            });
          }
        } else {
          // the organizer saves the result
          await M.reportMatch(
            matchId,
            { upper_games: step.upper_games, lower_games: step.lower_games, version: stepVersion },
            baseCtx
          );
        }
        break;
      }
      case "disputed": {
        const actor = await actorFor(step.by);
        await M.reportMatch(
          matchId,
          { upper_games: step.upper_games, lower_games: step.lower_games, version: stepVersion },
          { tournament: t, user: actor.user, isOrganizer: false, entrantRow: actor.entrantRow, skipRateLimit: true }
        );
        const m = (await T.getMatchRows(tid)).find((x) => x.id === matchId)!;
        const myId = actor.entrantRow?.id ?? null;
        const opponentId = m.upper_entrant_id === myId ? m.lower_entrant_id : m.upper_entrant_id;
        const opponentRow = (await T.getEntrantRows(tid)).find((e) => e.id === opponentId) ?? null;
        const oppActor = await actorFor(opponentRow?.name ?? "");
        await M.disputeMatch(
          matchId,
          { upper_games: step.counter.upper_games, lower_games: step.counter.lower_games, version: m.version },
          { tournament: t, user: oppActor.user, isOrganizer: false, entrantRow: opponentRow, skipRateLimit: true }
        );
        break;
      }
      case "resolved": {
        const resolver = step.resolver ?? spec.organizer;
        const rid = userIds.get(resolver) ?? (await findUserByUsername(resolver))?.id ?? "";
        await M.resolveMatch(
          matchId,
          { upper_games: step.upper_games, lower_games: step.lower_games, version: stepVersion },
          { tournament: t, user: { id: rid, username: resolver }, isOrganizer: true, entrantRow: null, skipRateLimit: true }
        );
        break;
      }
    }
  }
}

function shareCodeNew(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 22; i++) out += chars[bytes[i]! % 64];
  return out;
}
