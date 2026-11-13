import type { ServerResponse } from "node:http";
import { errors, sendJson } from "./errors.js";
import { one } from "./db.js";
import * as T from "./tournaments.js";
import { computeStandings } from "./standings.js";
import { s3 } from "./s3.js";

export async function handleShare(
  res: ServerResponse,
  pathname: string
): Promise<void> {
  // GET only; other methods were refused with 405 earlier
  const parts = pathname.split("/").filter(Boolean); // api, share, code, [logo]
  const code = parts[2] ?? "";
  const sub = parts[3] ?? "";
  const row = await one<{ id: string; state: string; logo_sha256: string | null }>(
    `SELECT id, state, logo_sha256 FROM tournaments WHERE share_code = $1`,
    [code]
  );
  if (!row) throw errors.notFoundLink();
  if (row.state === "draft") throw errors.notFoundDraft();
  const t = (await T.getTournamentRow(row.id))!;
  const entrants = await T.getEntrantRows(t.id);
  const matches = await T.getMatchRows(t.id);
  const nameOf = T.makeNameLookup(entrants);

  if (sub === "logo") {
    if (!row.logo_sha256) throw errors.notFound();
    const [hash, ext] = row.logo_sha256.split("|");
    try {
      const obj = await s3.get(`logos/${t.id}/${hash}.${ext}`);
      if (!obj.body) throw errors.notFound();
      res.writeHead(200, { "Content-Type": ext === "jpg" ? "image/jpeg" : "image/png" });
      res.end(obj.body);
    } catch {
      throw errors.storageUnavailable();
    }
    return;
  }

  // public shape: display names, seeds, scores, states and labels only
  sendJson(res, 200, {
    tournament: await publicTournament(t),
    entrants: entrants.map((e) => ({ name: e.name, seed: e.seed })),
    matches: matches.map((m) => publicMatch(m, nameOf)),
    standings:
      t.format === "round_robin" || t.format === "swiss" ? await publicStandings(t) : null,
  });
}

export async function publicTournament(t: T.TournamentRow): Promise<Record<string, unknown>> {
  const full = await T.toTournament(t, null, false);
  return {
    id: full.id,
    name: full.name,
    format: full.format,
    state: full.state,
    fill: full.fill,
    time_zone: full.time_zone,
    server_time: full.server_time,
    field_size: full.field_size,
    entrant_count: full.entrant_count,
    checked_in_count: full.checked_in_count,
    current_round: full.current_round,
    swiss_rounds: full.swiss_rounds,
    logo_url: full.logo_url ? `/s/logo/${t.id}` : null,
  };
}

export function publicMatch(m: import("./brackets.js").MatchRow, nameOf: (id: string | null) => string): Record<string, unknown> {
  return {
    id: m.id,
    label: m.label,
    // public shape: display names, seeds, scores, states and labels only
    bracket: m.bracket,
    round: m.round,
    number: m.number,
    upper: m.upper_entrant_id ? { name: nameOf(m.upper_entrant_id) } : m.upper_is_bye ? { bye: true } : null,
    lower: m.lower_entrant_id ? { name: nameOf(m.lower_entrant_id) } : m.lower_is_bye ? { bye: true } : null,
    state: m.state,
    upper_games: m.upper_games,
    lower_games: m.lower_games,
    winner: m.winner,
    report: m.report ? { by: m.report.by, upper_games: m.report.upper_games, lower_games: m.report.lower_games, reported_at: m.report.reported_at, auto_confirm_at: m.report.auto_confirm_at } : null,
    dispute: m.dispute ? { by: m.dispute.by, upper_games: m.dispute.upper_games, lower_games: m.dispute.lower_games, disputed_at: m.dispute.disputed_at } : null,
    called_at: m.called_at,
    version: m.version,
  };
}

async function publicStandings(t: T.TournamentRow): Promise<Record<string, unknown>> {
  const s = await computeStandings(t.id, t.format);
  return { columns: s.columns, rows: s.rows };
}
