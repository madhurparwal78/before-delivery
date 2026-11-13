import type { IncomingMessage, ServerResponse } from "node:http";
import { errors, sendJson } from "./errors.js";
import { one } from "./db.js";
import * as T from "./tournaments.js";
import * as M from "./matches.js";
import * as S from "./shutter.js";
import { readJson } from "./routes.js";

export async function handleMatchAction(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  matchId: string,
  action: string,
  user: { id: string; username: string }
): Promise<void> {
  if (method !== "POST") throw errors.notFound();
  const row = await one<{ tournament_id: string }>(`SELECT tournament_id FROM matches WHERE id = $1`, [matchId]);
  if (!row) throw errors.notFoundTournament();
  const t = await T.getTournamentRow(row.tournament_id);
  if (!t) throw errors.notFoundTournament();
  if (t.state === "draft") throw errors.notFoundTournament();
  const ctx = await M.loadMatchContext(t, user);
  const body = (await readJson(req)) as Record<string, unknown>;
  const version = Number(body.version ?? 0);
  const nameOf = T.makeNameLookup(await T.getEntrantRows(t.id));

  const respond = (m: import("./brackets.js").MatchRow): void => {
    sendJson(res, 200, { match: T.toMatch(m, nameOf, ctx.isOrganizer) });
  };

  switch (action) {
    case "call": {
      const m = await M.callMatch(matchId, version, ctx);
      respond(m);
      return;
    }
    case "report": {
      const m = await M.reportMatch(matchId, body, ctx);
      const outcome =
        m.state === "reported" ? "reported" : m.state === "disputed" ? "disputed" : "confirmed";
      sendJson(res, 200, { match: T.toMatch(m, nameOf, ctx.isOrganizer), outcome });
      return;
    }
    case "confirm": {
      respond(await M.confirmMatch(matchId, version, ctx));
      return;
    }
    case "dispute": {
      respond(await M.disputeMatch(matchId, body, ctx));
      return;
    }
    case "result": {
      if (!ctx.isOrganizer) throw errors.forbiddenTournament();
      respond(await M.reportMatch(matchId, body, ctx));
      return;
    }
    case "resolve": {
      respond(await M.resolveMatch(matchId, body, ctx));
      return;
    }
    case "edit-preview": {
      if (!ctx.isOrganizer) throw errors.forbiddenTournament();
      const { upper_games, lower_games } = scoreOf(body);
      const preview = await S.editPreview(matchId, { upper_games, lower_games, version }, t, ctx.isOrganizer);
      sendJson(res, 200, preview);
      return;
    }
    case "edit": {
      if (!ctx.isOrganizer) throw errors.forbiddenTournament();
      const { upper_games, lower_games } = scoreOf(body);
      const result = await S.commitEdit(
        matchId,
        { upper_games, lower_games, preview_token: String(body.preview_token ?? "") },
        t,
        ctx.isOrganizer,
        user.username
      );
      sendJson(res, 200, { match: T.toMatch(result.match, nameOf, ctx.isOrganizer), reset: result.reset });
      return;
    }
  }
  throw errors.notFound();
}

function scoreOf(body: Record<string, unknown>): { upper_games: number; lower_games: number } {
  const u = Number(body.upper_games);
  const l = Number(body.lower_games);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(u) || u < 0 || u > 99) fields.upper_games = "Enter a whole number from 0 to 99.";
  if (!Number.isInteger(l) || l < 0 || l > 99) fields.lower_games = "Enter a whole number from 0 to 99.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  return { upper_games: u, lower_games: l };
}
