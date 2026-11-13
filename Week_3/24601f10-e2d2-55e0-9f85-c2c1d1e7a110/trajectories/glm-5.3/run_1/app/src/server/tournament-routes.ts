import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { errors, sendJson } from "./errors.js";
import { findUserByUsername, isoNow, newId, sha256hex } from "./auth.js";
import { one, withTransaction, query } from "./db.js";
import { s3 } from "./s3.js";
import * as T from "./tournaments.js";
import * as F from "./formats.js";
import { computeStandings } from "./standings.js";
import { recordMessage } from "./live.js";
import { ROSTER_ERRORS, FIELD_ERRORS } from "../shared/types.js";
import { parseRoster, decodeRosterText } from "../shared/roster.js";
import { round1Pairings } from "../shared/bracket.js";
import Busboy from "busboy";
import { readJson } from "./routes.js";

const TIME_ZONES: string[] = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

export async function handleTournamentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  tid: string,
  rest: string,
  user: { id: string; username: string } | null
): Promise<void> {
  // this route needs the session cookie; the signed-out check comes before any
  // record visibility check in the published error precedence
  if (!user) throw errors.unauthenticated();
  const t = await T.getTournamentRow(tid);
  if (!t) throw errors.notFoundTournament();
  let role: "organizer" | "co_organizer" | "player" | "viewer" | null = null;
  if (user) role = await T.myRole(t, user.id);
  // a draft tournament is visible only to its organizers
  if (t.state === "draft" && role !== "organizer" && role !== "co_organizer") {
    throw errors.notFoundTournament();
  }
  const isOrganizer = role === "organizer" || role === "co_organizer";
  const signedIn = user !== null;

  const respondTournament = async (): Promise<void> => {
    sendJson(res, 200, { tournament: await T.toTournament(t!, user?.id ?? null, true) });
  };

  if (rest === "" || rest === "/") {
    if (method === "GET") {
      if (!signedIn) throw errors.unauthenticated();
      await respondTournament();
      return;
    }
    if (method === "PATCH") {
      if (!user) throw errors.unauthenticated();
      if (!isOrganizer) throw errors.forbiddenTournament();
      const body = (await readJson(req)) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const updates: Record<string, string> = {};
      if (body.name !== undefined) {
        const name = String(body.name);
        if (name.length < 1 || name.length > 60) fields.name = FIELD_ERRORS.name;
        else updates.name = name;
      }
      if (body.time_zone !== undefined) {
        const tz = String(body.time_zone);
        if (!TIME_ZONES.includes(tz)) fields.time_zone = FIELD_ERRORS.time_zone;
        else updates.time_zone = tz;
      }
      if (body.fill !== undefined) {
        const fill = String(body.fill);
        if (!["lilac", "lemon", "mint"].includes(fill)) fields.fill = FIELD_ERRORS.fill;
        else updates.fill = fill;
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      const cols = Object.keys(updates);
      if (cols.length > 0) {
        const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
        await query(`UPDATE tournaments SET ${sets} WHERE id = $1`, [t!.id, ...cols.map((c) => updates[c]!)]);
      }
      const fresh = (await T.getTournamentRow(tid))!;
      sendJson(res, 200, { tournament: await T.toTournament(fresh, user!.id, true) });
      await T.broadcastTournament(tid);
      return;
    }
    if (method === "DELETE") {
      if (!user) throw errors.unauthenticated();
      if (role !== "organizer") throw errors.forbiddenOrganizerOnly();
      if (t!.state === "running" || t!.state === "finished") {
        throw errors.ws("The tournament has already started.");
      }
      await withTransaction(async (tx) => {
        await tx.query(`DELETE FROM live_messages WHERE tournament_id = $1`, [tid]);
        await tx.query(`DELETE FROM feed_edges WHERE tournament_id = $1`, [tid]);
        await tx.query(`DELETE FROM tournaments WHERE id = $1`, [tid]);
      });
      res.writeHead(204);
      res.end();
      return;
    }
    throw errors.notFound();
  }

  if (rest === "/co-organizers") {
    if (method === "POST") {
      if (!user) throw errors.unauthenticated();
      if (role !== "organizer") throw errors.forbiddenOrganizerOnly();
      const body = (await readJson(req)) as { username?: string };
      const target = await findUserByUsername(String(body.username ?? ""));
      if (!target) {
        throw errors.validation({ username: FIELD_ERRORS.no_account(String(body.username ?? "").toLowerCase()) });
      }
      if (target.id === t!.organizer_id) {
        throw errors.validation({ username: FIELD_ERRORS.organizer_co });
      }
      const existing = await one<{ user_id: string }>(
        `SELECT user_id FROM co_organizers WHERE tournament_id = $1 AND user_id = $2`,
        [tid, target.id]
      );
      if (existing) {
        throw errors.validation({ username: FIELD_ERRORS.repeat_co(target.username) });
      }
      await query(`INSERT INTO co_organizers (tournament_id, user_id) VALUES ($1,$2)`, [tid, target.id]);
      const cos = await T.coOrganizerUsernames(tid);
      sendJson(res, 201, { co_organizers: cos });
      return;
    }
    throw errors.notFound();
  }

  const coDelete = rest.match(/^\/co-organizers\/([^/]+)$/);
  if (coDelete) {
    if (method === "DELETE") {
      if (!user) throw errors.unauthenticated();
      if (role !== "organizer") throw errors.forbiddenOrganizerOnly();
      const target = await findUserByUsername(coDelete[1]!);
      if (!target) throw errors.notFound();
      await query(`DELETE FROM co_organizers WHERE tournament_id = $1 AND user_id = $2`, [tid, target.id]);
      res.writeHead(204);
      res.end();
      return;
    }
    throw errors.notFound();
  }

  if (rest === "/entrants") {
    if (method === "GET") {
      if (!signedIn) throw errors.unauthenticated();
      const rows = await T.getEntrantRows(tid);
      sendJson(res, 200, { entrants: rows.map((e) => T.toEntrant(e, isOrganizer)) });
      return;
    }
    if (method === "POST") {
      if (!user) throw errors.unauthenticated();
      if (!isOrganizer) throw errors.forbiddenTournament();
      if (t!.state === "running" || t!.state === "finished") {
        throw errors.ws("The tournament has already started.");
      }
      const body = (await readJson(req)) as { name?: string; username?: string };
      const name = String(body.name ?? "").trim();
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 40) fields.name = FIELD_ERRORS.entrant_name;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);
      const existing = await one<{ id: string }>(
        `SELECT id FROM entrants WHERE tournament_id = $1 AND lower(name) = lower($2)`,
        [tid, name]
      );
      if (existing) throw errors.validation({ name: "That name is already in the field." });
      let userId: string | null = null;
      let username: string | null = null;
      if (body.username !== undefined && body.username !== null && String(body.username) !== "") {
        const target = await findUserByUsername(String(body.username));
        if (!target) {
          throw errors.validation({ username: FIELD_ERRORS.no_account(String(body.username).toLowerCase()) });
        }
        const taken = await one<{ id: string }>(
          `SELECT id FROM entrants WHERE tournament_id = $1 AND user_id = $2`,
          [tid, target.id]
        );
        if (taken) {
          throw errors.validation({ username: FIELD_ERRORS.no_account(target.username) });
        }
        userId = target.id;
        username = target.username;
      }
      const countRow = await one<{ max: number | null }>(
        `SELECT MAX(seed) as max FROM entrants WHERE tournament_id = $1`,
        [tid]
      );
      const seed = (countRow?.max ?? 0) + 1;
      const id = newId();
      await query(
        `INSERT INTO entrants (id, tournament_id, name, seed, username, user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, tid, name, seed, username, userId]
      );
      const row = (await one<T.EntrantRow>(`SELECT * FROM entrants WHERE id = $1`, [id]))!;
      await recordMessage(tid, "entrants.updated", {
        entrants: (await T.getEntrantRows(tid)).map((e) => T.toEntrant(e, true)),
      });
      sendJson(res, 201, { entrant: T.toEntrant(row, isOrganizer) });
      return;
    }
    throw errors.notFound();
  }

  if (rest === "/seeding" && method === "PUT") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    if (t!.state === "running" || t!.state === "finished") {
      throw errors.ws("The tournament has already started.");
    }
    const body = (await readJson(req)) as { order?: string[]; seeding_version?: number };
    const rows = await T.getEntrantRows(tid);
    const order = body.order ?? [];
    if (order.length !== rows.length || new Set(order).size !== order.length || !rows.every((r) => order.includes(r.id))) {
      throw errors.validationMsg("Check the highlighted fields.");
    }
    if (body.seeding_version !== t!.seeding_version) {
      const changedBy = await whoChangedSeeding(tid, t!.seeding_version, body.seeding_version ?? 0);
      throw errors.staleSeeding(changedBy, rows.map((e) => T.toEntrant(e, isOrganizer)));
    }
    await withTransaction(async (tx) => {
      let seed = 1;
      for (const id of order) {
        await tx.query(`UPDATE entrants SET seed = $2 WHERE id = $1`, [id, seed]);
        seed += 1;
      }
      await tx.query(`UPDATE tournaments SET seeding_version = seeding_version + 1 WHERE id = $1`, [tid]);
    });
    const freshRows = await T.getEntrantRows(tid);
    const freshT = (await T.getTournamentRow(tid))!;
    await recordMessage(tid, "entrants.updated", {
      entrants: freshRows.map((e) => T.toEntrant(e, true)),
    });
    await T.broadcastTournament(tid);
    sendJson(res, 200, { entrants: freshRows.map((e) => T.toEntrant(e, isOrganizer)), seeding_version: freshT.seeding_version });
    return;
  }

  if (rest === "/preview" && method === "GET") {
    if (!signedIn) throw errors.unauthenticated();
    const rows = await T.getEntrantRows(tid);
    const bySeed = new Map(rows.map((e) => [e.seed, e.name]));
    const pairings = round1Pairings(rows.length);
    sendJson(res, 200, {
      matches: pairings.map((p: { number: number; upper: number | null; lower: number | null }) => ({
        number: p.number,
        upper: p.upper !== null ? (bySeed.get(p.upper) ?? null) : null,
        lower: p.lower !== null ? (bySeed.get(p.lower) ?? null) : null,
      })),
    });
    return;
  }

  if (rest === "/roster") {
    if (method === "POST") {
      if (!user) throw errors.unauthenticated();
      if (!isOrganizer) throw errors.forbiddenTournament();
      if (t!.state === "running" || t!.state === "finished") {
        throw errors.ws("The tournament has already started.");
      }
      await handleRosterUpload(req, res, t!);
      return;
    }
    if (method === "GET") {
      if (!signedIn) throw errors.unauthenticated();
      const rec = await one<{ roster_file_name: string; roster_sha256: string }>(
        `SELECT roster_file_name, roster_sha256 FROM tournaments WHERE id = $1`,
        [tid]
      );
      if (!rec?.roster_sha256) throw errors.notFoundRoster();
      try {
        const key = `rosters/${tid}/${rec.roster_sha256}.cupfold.txt`;
        const obj = await s3.get(key);
        if (!obj.body) throw errors.storageUnavailable();
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${rec.roster_file_name}"`,
        });
        res.end(obj.body);
      } catch (e) {
        if (e instanceof Error && e.constructor.name === "S3Error") throw errors.storageUnavailable();
        throw e;
      }
      return;
    }
    throw errors.notFound();
  }

  if (rest === "/logo") {
    if (method === "POST") {
      if (!user) throw errors.unauthenticated();
      if (!isOrganizer) throw errors.forbiddenTournament();
      await handleLogoUpload(req, res, t!);
      return;
    }
    if (method === "GET") {
      const rec = await one<{ logo_sha256: string }>(`SELECT logo_sha256 FROM tournaments WHERE id = $1`, [tid]);
      if (!rec?.logo_sha256) throw errors.notFound();
      try {
        const ext = rec.logo_sha256.endsWith("x") ? "png" : "png";
        const key = `logos/${tid}/${rec.logo_sha256}.${ext}`;
        const obj = await s3.get(key);
        if (!obj.body) throw errors.notFound();
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(obj.body);
      } catch (e) {
        if (e instanceof Error && e.constructor.name === "S3Error") throw errors.storageUnavailable();
        throw e;
      }
      return;
    }
    throw errors.notFound();
  }

  if (rest === "/checkin/open" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    const body = (await readJson(req)) as { closes_at?: string };
    if (body.closes_at !== undefined && body.closes_at !== null && String(body.closes_at) !== "") {
      const parsed = new Date(String(body.closes_at));
      if (Number.isNaN(parsed.getTime())) {
        throw errors.validation({ closes_at: FIELD_ERRORS.closes_at_format });
      }
    }
    const fresh = await T.openCheckin(t!, body.closes_at ? String(body.closes_at) : null);
    await T.broadcastTournament(tid);
    sendJson(res, 200, { tournament: await T.toTournament(fresh, user.id, true) });
    return;
  }

  if (rest === "/checkin/close" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    const fresh = await T.closeCheckin(t!);
    await recordMessage(tid, "announcement", { text: "Check-in is closed." });
    await T.broadcastTournament(tid);
    sendJson(res, 200, { tournament: await T.toTournament(fresh, user.id, true) });
    return;
  }

  if (rest === "/draft" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    const fresh = await T.backToDraft(t!);
    await T.broadcastTournament(tid);
    sendJson(res, 200, { tournament: await T.toTournament(fresh, user.id, true) });
    return;
  }

  if (rest === "/checkin" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    const now = isoNow();
    // the state machine decides first, as in the tournament state table
    if (t!.state !== "checkin_open") {
      if (t!.state === "checkin_closed" || t!.state === "running" || t!.state === "finished") {
        throw errors.checkinClosed();
      }
      throw errors.ws("Check-in is not open.");
    }
    if (t!.checkin_closes_at && new Date(t!.checkin_closes_at).getTime() <= new Date(now).getTime()) {
      throw errors.checkinClosed();
    }
    // only the linked player checks in; organizers use the entrant toggle
    const entrant = await one<T.EntrantRow>(`SELECT * FROM entrants WHERE tournament_id = $1 AND user_id = $2`, [
      tid,
      user.id,
    ]);
    if (!entrant) throw errors.forbiddenTournament();
    const already = entrant.checked_in;
    if (!already) {
      await query(`UPDATE entrants SET checked_in = true WHERE id = $1`, [entrant.id]);
      await recordMessage(tid, "checkin.updated", {
        checked_in_count: (await countCheckedIn(tid)),
        entrant: { name: entrant.name, checked_in: true },
      });
      await recordMessage(tid, "announcement", { text: `${entrant.name} checked in` });
    }
    const freshEntrant = (await one<T.EntrantRow>(`SELECT * FROM entrants WHERE id = $1`, [entrant.id]))!;
    sendJson(res, 200, { entrant: T.toEntrant(freshEntrant, false), checked_in_count: await countCheckedIn(tid) });
    return;
  }

  if (rest === "/start" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    const result = await T.startTournament(t!);
    sendJson(res, 200, {
      tournament: await T.toTournament(result.tournament, user.id, true),
      removed: result.removed,
    });
    return;
  }

  if (rest === "/rounds" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    if (t!.format !== "swiss") throw errors.ws("Only Swiss tournaments have a next round.");
    if (t!.state === "draft" || t!.state === "checkin_open" || t!.state === "checkin_closed") {
      throw errors.ws("The tournament is not running.");
    }
    if (t!.state === "finished") {
      throw errors.ws("This tournament is finished. Its results can no longer change.");
    }
    const matches = await T.getMatchRows(tid);
    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
    const latest = rounds[rounds.length - 1] ?? 0;
    if (latest >= (t!.swiss_rounds ?? 0)) {
      throw errors.ws("This tournament is finished. Its results can no longer change.");
    }
    const done = matches.filter((m) => m.round === latest).every((m) => m.state === "confirmed" || m.state === "resolved" || m.state === "bye" || m.state === "not_needed");
    if (!done) throw errors.ws(`Finish every match in round ${latest} first.`);
    const next = latest + 1;
    const entrants = await T.getEntrantRows(tid);
    const now = isoNow();
    let newMatches: T.MatchRow[] = [];
    await withTransaction(async (tx) => {
      await F.pairSwissRound(tx, t!, entrants, next, now);
    });
    newMatches = (await T.getMatchRows(tid)).filter((m) => m.round === next);
    const nameOf = T.makeNameLookup(entrants);
    for (const m of newMatches) {
      await recordMessage(tid, "match.updated", { match: T.toMatch(m, nameOf, true) });
    }
    await recordMessage(tid, "announcement", { text: `Round ${next} is paired` });
    await T.broadcastTournament(tid);
    sendJson(res, 201, { round: next, matches: newMatches.map((m) => T.toMatch(m, nameOf, true)) });
    return;
  }

  if (rest === "/matches" && method === "GET") {
    if (!signedIn) throw errors.unauthenticated();
    const rows = await T.getMatchRows(tid);
    const entrants = await T.getEntrantRows(tid);
    const nameOf = T.makeNameLookup(entrants);
    sendJson(res, 200, { matches: rows.map((m) => T.toMatch(m, nameOf, isOrganizer)) });
    return;
  }

  if (rest === "/standings" && method === "GET") {
    if (!signedIn) throw errors.unauthenticated();
    if (t!.format === "single_elimination" || t!.format === "double_elimination") {
      throw errors.ws("Standings exist only for round robin and Swiss.");
    }
    const s = await computeStandings(tid, t!.format);
    sendJson(res, 200, { columns: s.columns, rows: s.rows });
    return;
  }

  if (rest === "/me" && method === "GET") {
    if (!user) throw errors.unauthenticated();
    const entrant = await one<T.EntrantRow>(`SELECT * FROM entrants WHERE tournament_id = $1 AND user_id = $2`, [
      tid,
      user.id,
    ]);
    if (!entrant) throw errors.notFoundTournament();
    const matches = await T.getMatchRows(tid);
    const open = matches
      .filter(
        (m) =>
          (m.upper_entrant_id === entrant.id || m.lower_entrant_id === entrant.id) &&
          (m.state === "pending" || m.state === "called" || m.state === "reported" || m.state === "disputed")
      )
      .sort((a, b) => a.bracket.localeCompare(b.bracket) || a.round - b.round || a.number - b.number);
    sendJson(res, 200, {
      entrant: T.toEntrant(entrant, false),
      checked_in: entrant.checked_in,
      next_match: open[0] ? T.toMatch(open[0], T.makeNameLookup(await T.getEntrantRows(tid)), isOrganizer) : null,
    });
    return;
  }

  if (rest === "/disputes" && method === "GET") {
    if (!user) throw errors.unauthenticated();
    if (!isOrganizer) throw errors.forbiddenTournament();
    const rows = await T.getMatchRows(tid);
    const nameOf = T.makeNameLookup(await T.getEntrantRows(tid));
    sendJson(res, 200, { matches: rows.filter((m) => m.state === "disputed").map((m) => T.toMatch(m, nameOf, true)) });
    return;
  }

  if (rest === "/share/rotate" && method === "POST") {
    if (!user) throw errors.unauthenticated();
    if (role !== "organizer") throw errors.forbiddenOrganizerOnly();
    const code = shareCodeNew();
    await query(`UPDATE tournaments SET share_code = $2 WHERE id = $1`, [tid, code]);
    const { closeShareSockets } = await import("./live-routes.js");
    await closeShareSockets(tid);
    sendJson(res, 200, { share_url: `${config.publicUrl}/s/${code}` });
    return;
  }

  throw errors.notFound();
}

async function countCheckedIn(tid: string): Promise<number> {
  const r = await one<{ count: string }>(`SELECT COUNT(*) as count FROM entrants WHERE tournament_id = $1 AND checked_in = true`, [tid]);
  return Number(r?.count ?? 0);
}

async function whoChangedSeeding(tid: string, currentVersion: number, sentVersion: number): Promise<string> {
  void tid;
  void currentVersion;
  void sentVersion;
  // The brief does not track who made each seeding save; use the tournament organizer.
  const r = await one<{ username: string }>(`SELECT u.username FROM tournaments t JOIN users u ON u.id = t.organizer_id WHERE t.id = $1`, [tid]);
  return r?.username ?? "another organizer";
}

function shareCodeNew(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 22; i++) out += chars[bytes[i]! % 64];
  return out;
}

export async function handleEntrantPatch(
  req: IncomingMessage,
  res: ServerResponse,
  entrantId: string,
  user: { id: string; username: string }
): Promise<void> {
  const row = await one<{ id: string; tournament_id: string }>(`SELECT id, tournament_id FROM entrants WHERE id = $1`, [entrantId]);
  if (!row) throw errors.notFoundTournament();
  const t = await T.getTournamentRow(row.tournament_id);
  if (!t) throw errors.notFoundTournament();
  const role = await T.myRole(t, user.id);
  if (role !== "organizer" && role !== "co_organizer") throw errors.forbiddenTournament();
  if (t.state === "running" || t.state === "finished") {
    throw errors.ws("The tournament has already started.");
  }
  const body = (await readJson(req)) as { username?: string | null };
  if (body.username === null) {
    await query(`UPDATE entrants SET username = NULL, user_id = NULL WHERE id = $1`, [entrantId]);
  } else {
    const target = await findUserByUsername(String(body.username ?? ""));
    if (!target) {
      throw errors.validation({ username: FIELD_ERRORS.no_account(String(body.username ?? "").toLowerCase()) });
    }
    const taken = await one<{ id: string }>(`SELECT id FROM entrants WHERE tournament_id = $1 AND user_id = $2 AND id <> $3`, [
      t.id,
      target.id,
      entrantId,
    ]);
    if (taken) throw errors.validation({ username: FIELD_ERRORS.no_account(target.username) });
    await query(`UPDATE entrants SET username = $2, user_id = $3 WHERE id = $1`, [entrantId, target.username, target.id]);
  }
  const fresh = (await one<T.EntrantRow>(`SELECT * FROM entrants WHERE id = $1`, [entrantId]))!;
  await recordMessage(t.id, "entrants.updated", {
    entrants: (await T.getEntrantRows(t.id)).map((e) => T.toEntrant(e, true)),
  });
  sendJson(res, 200, { entrant: T.toEntrant(fresh, true) });
}

export async function handleEntrantDelete(
  res: ServerResponse,
  entrantId: string,
  user: { id: string; username: string }
): Promise<void> {
  const row = await one<{ id: string; tournament_id: string }>(`SELECT id, tournament_id FROM entrants WHERE id = $1`, [entrantId]);
  if (!row) throw errors.notFoundTournament();
  const t = await T.getTournamentRow(row.tournament_id);
  if (!t) throw errors.notFoundTournament();
  const role = await T.myRole(t, user.id);
  if (role !== "organizer" && role !== "co_organizer") throw errors.forbiddenTournament();
  if (t.state === "running" || t.state === "finished") {
    throw errors.ws("The tournament has already started.");
  }
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM entrants WHERE id = $1`, [entrantId]);
    await tx.query(`WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY seed) AS rn FROM entrants WHERE tournament_id = $1
    ) UPDATE entrants SET seed = ordered.rn FROM ordered WHERE entrants.id = ordered.id`, [t.id]);
  });
  await recordMessage(t.id, "entrants.updated", {
    entrants: (await T.getEntrantRows(t.id)).map((e) => T.toEntrant(e, true)),
  });
  res.writeHead(204);
  res.end();
}

export async function handleOrganizerCheckinToggle(
  req: IncomingMessage,
  res: ServerResponse,
  entrantId: string,
  user: { id: string; username: string }
): Promise<void> {
  const row = await one<{ id: string; tournament_id: string; name: string; checked_in: boolean }>(
    `SELECT id, tournament_id, name, checked_in FROM entrants WHERE id = $1`,
    [entrantId]
  );
  if (!row) throw errors.notFoundTournament();
  const t = await T.getTournamentRow(row.tournament_id);
  if (!t) throw errors.notFoundTournament();
  const role = await T.myRole(t, user.id);
  if (role !== "organizer" && role !== "co_organizer") throw errors.forbiddenTournament();
  if (t.state !== "checkin_open") throw errors.ws("Check-in is not open.");
  const body = (await readJson(req)) as { checked_in?: boolean };
  const checked = body.checked_in === true;
  await query(`UPDATE entrants SET checked_in = $2 WHERE id = $1`, [entrantId, checked]);
  await recordMessage(t.id, "checkin.updated", {
    checked_in_count: await countCheckedIn(t.id),
    entrant: { name: row.name, checked_in: checked },
  });
  if (checked) await recordMessage(t.id, "announcement", { text: `${row.name} checked in` });
  const fresh = (await one<T.EntrantRow>(`SELECT * FROM entrants WHERE id = $1`, [entrantId]))!;
  sendJson(res, 200, { entrant: T.toEntrant(fresh, true), checked_in_count: await countCheckedIn(t.id) });
}

async function handleRosterUpload(
  req: IncomingMessage,
  res: ServerResponse,
  t: T.TournamentRow
): Promise<void> {
  const { fileName, bytes } = await readMultipart(req, config.rosterMaxBytes);
  // 1. file name, then empty content, checked before storing
  if (!fileName.endsWith(".cupfold.txt")) {
    throw errors.validationMsg(ROSTER_ERRORS.extension);
  }
  if (bytes.length === 0) {
    throw errors.validationMsg(ROSTER_ERRORS.empty);
  }
  const hash = sha256hex(bytes);
  const key = `rosters/${t.id}/${hash}.cupfold.txt`;
  // 2. the file is stored
  try {
    await s3.put(key, bytes, "text/plain; charset=utf-8");
  } catch {
    throw errors.storageUnavailable();
  }
  // 3. UTF-8 decoding
  const text = decodeRosterText(bytes);
  if (text === null) {
    throw errors.rosterInvalid([ROSTER_ERRORS.not_utf8]);
  }
  // 4. entrant count
  const lines = parseRoster(text);
  if (lines.length < 2 || lines.length > 128) {
    throw errors.rosterInvalid([ROSTER_ERRORS.count(lines.length)]);
  }
  // 5. per-line checks
  const lineErrors: string[] = [];
  const usedSeeds = new Map<number, number>();
  const usedNames = new Map<string, { first: string; line: number }>();
  const usedUsernames = new Map<string, number>();
  for (const l of lines) {
    if (l.seed !== null) {
      if (!Number.isInteger(l.seed) || l.seed < 1 || l.seed > 128) {
        lineErrors.push(ROSTER_ERRORS.seed_range(l.line));
      } else if (l.seed > lines.length) {
        lineErrors.push(ROSTER_ERRORS.seed_larger(l.line, l.seed, lines.length));
      } else if (usedSeeds.has(l.seed)) {
        lineErrors.push(ROSTER_ERRORS.seed_used(l.line, l.seed, usedSeeds.get(l.seed)!));
      } else {
        usedSeeds.set(l.seed, l.line);
      }
    }
    if (lineErrors.length >= 20) break;
    if (l.name === "") {
      lineErrors.push(ROSTER_ERRORS.name_empty(l.line));
    } else if ([...l.name].length > 40) {
      lineErrors.push(ROSTER_ERRORS.name_long(l.line));
    } else {
      const lower = l.name.toLowerCase();
      if (usedNames.has(lower)) {
        const first = usedNames.get(lower)!;
        lineErrors.push(ROSTER_ERRORS.duplicate_name(l.line, first.first, first.line));
      } else {
        usedNames.set(lower, { first: l.name, line: l.line });
      }
    }
    if (lineErrors.length >= 20) break;
    if (l.username) {
      const target = await findUserByUsername(l.username);
      if (!target) {
        lineErrors.push(ROSTER_ERRORS.no_account(l.line, l.username));
      } else if (usedUsernames.has(l.username)) {
        lineErrors.push(ROSTER_ERRORS.username_used(l.line, l.username, usedUsernames.get(l.username)!));
      } else {
        usedUsernames.set(l.username, l.line);
      }
    }
    if (lineErrors.length >= 20) break;
  }
  if (lineErrors.length > 0) {
    throw errors.rosterInvalid(lineErrors);
  }
  // valid: replace the field in one transaction
  const usernameIds = new Map<string, string>();
  for (const l of lines) {
    if (l.username) {
      const target = await findUserByUsername(l.username);
      if (target) usernameIds.set(l.username, target.id);
    }
  }
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM entrants WHERE tournament_id = $1`, [t.id]);
    // seeded lines take their seed; unseeded take the remaining numbers in file order
    const remaining: number[] = [];
    for (let s = 1; s <= lines.length; s++) {
      if (!usedSeeds.has(s)) remaining.push(s);
    }
    let ri = 0;
    let nextSeed = 1;
    for (const l of lines) {
      const seed = l.seed ?? remaining[ri++] ?? nextSeed;
      nextSeed += 1;
      const uid = l.username ? (usernameIds.get(l.username) ?? null) : null;
      await tx.query(
        `INSERT INTO entrants (id, tournament_id, name, seed, username, user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(), t.id, l.name, seed, l.username, uid]
      );
    }
    await tx.query(`UPDATE tournaments SET roster_file_name = $2, roster_sha256 = $3 WHERE id = $1`, [
      t.id,
      fileName,
      hash,
    ]);
  });
  const rows = await T.getEntrantRows(t.id);
  await recordMessage(t.id, "entrants.updated", { entrants: rows.map((e) => T.toEntrant(e, true)) });
  sendJson(res, 201, {
    entrants: rows.map((e) => T.toEntrant(e, true)),
    sha256: hash,
    file_name: fileName,
  });
}

async function handleLogoUpload(
  req: IncomingMessage,
  res: ServerResponse,
  t: T.TournamentRow
): Promise<void> {
  const { bytes } = await readMultipart(req, config.logoMaxBytes);
  // PNG: 89 50 4E 47; JPEG: FF D8 FF
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpg) {
    throw errors.validationMsg("Logos must be PNG or JPEG images.");
  }
  const hash = sha256hex(bytes);
  const ext = isPng ? "png" : "jpg";
  const key = `logos/${t.id}/${hash}.${ext}`;
  try {
    await s3.put(key, bytes, isPng ? "image/png" : "image/jpeg");
  } catch {
    throw errors.storageUnavailable();
  }
  const logoUrl = `/api/tournaments/${t.id}/logo?v=${hash.slice(0, 12)}`;
  await query(`UPDATE tournaments SET logo_url = $2, logo_sha256 = $3 WHERE id = $1`, [t.id, logoUrl, `${hash}|${ext}`]);
  await T.broadcastTournament(t.id);
  sendJson(res, 201, { logo_url: logoUrl, sha256: hash });
}

async function readMultipart(
  req: IncomingMessage,
  limit: number
): Promise<{ fileName: string; bytes: Buffer }> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit + 1024 * 1024) throw errors.tooLargeFile(limit);
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: limit, files: 1 } });
    let fileName = "";
    let chunks: Buffer[] = [];
    let size = 0;
    let resolved = false;
    bb.on("file", (name, stream, info) => {
      if (name !== "file") {
        stream.resume();
        return;
      }
      fileName = String(info.filename ?? "roster.cupfold.txt");
      stream.on("data", (d: Buffer) => {
        size += d.length;
        if (size > limit) {
          if (!resolved) {
            resolved = true;
            reject(errors.tooLargeFile(limit));
          }
          stream.resume();
          return;
        }
        chunks.push(d);
      });
    });
    bb.on("error", () => {
      if (!resolved) {
        resolved = true;
        reject(errors.tooLargeJson());
      }
    });
    bb.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve({ fileName, bytes: Buffer.concat(chunks) });
      }
    });
    req.pipe(bb);
  });
}

export { shareCodeNew };
