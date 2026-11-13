import { all } from "./db.js";
import type { StandingRow, TournamentFormat } from "../shared/types.js";
import type { MatchRow, EntrantRow } from "./brackets.js";

export interface StandingResult {
  columns: string[];
  rows: StandingRow[];
}

export const RR_COLUMNS = ["Place", "Entrant", "Played", "Match points", "Head-to-head", "Game difference", "Games won", "Seed", "Decided by"];
export const SWISS_COLUMNS = ["Place", "Entrant", "Played", "Match points", "Buchholz cut 1", "Buchholz", "Sonneborn-Berger", "Seed", "Decided by"];

const RR_KEYS = ["Match points", "Head-to-head", "Game difference", "Games won", "Seed"];
const SWISS_KEYS = ["Match points", "Buchholz cut 1", "Buchholz", "Sonneborn-Berger", "Seed"];

interface OpponentScore {
  id: string | null;
  points: number;
  result: "win" | "loss" | "draw";
}

interface Stat {
  entrant: EntrantRow;
  played: number;
  match_points: number;
  games_won: number;
  games_lost: number;
  opponents: OpponentScore[];
  head_to_head: number;
  buchholz: number;
  buchholz_cut_1: number;
  sonneborn_berger: number;
  place: number;
  decided_by: string;
}

export async function computeStandings(tournamentId: string, format: TournamentFormat): Promise<StandingResult> {
  const entrants = await all<EntrantRow>(
    `SELECT id, tournament_id, name, seed, username, checked_in FROM entrants WHERE tournament_id = $1 ORDER BY seed`,
    [tournamentId]
  );
  const matches = await all<MatchRow>(`SELECT * FROM matches WHERE tournament_id = $1`, [tournamentId]);
  if (format === "round_robin") {
    return { columns: RR_COLUMNS, rows: rankRoundRobin(entrants, matches, false) };
  }
  return { columns: SWISS_COLUMNS, rows: rankSwiss(entrants, matches, true) };
}

/** Walk the finished matches once, filling stats and raw opponent lists. */
function collect(entrants: EntrantRow[], matches: MatchRow[], byeIsWin: boolean): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  for (const e of entrants) {
    stats.set(e.id, {
      entrant: e,
      played: 0,
      match_points: 0,
      games_won: 0,
      games_lost: 0,
      opponents: [],
      head_to_head: 0,
      buchholz: 0,
      buchholz_cut_1: 0,
      sonneborn_berger: 0,
      place: 0,
      decided_by: "",
    });
  }
  for (const m of matches) {
    const u = m.upper_entrant_id;
    const l = m.lower_entrant_id;
    if (m.state === "bye") {
      // A round-robin bye card is worth nothing; a Swiss bye is a 2-0 win worth 3.
      const who = u ?? l;
      const st = who ? stats.get(who) : undefined;
      if (st && byeIsWin) {
        st.played += 1;
        st.match_points += 3;
        st.games_won += 2;
        st.opponents.push({ id: null, points: 0, result: "win" });
      }
      continue;
    }
    if (m.state !== "confirmed" && m.state !== "resolved") continue;
    if (!u || !l) continue;
    const su = stats.get(u);
    const sl = stats.get(l);
    if (!su || !sl) continue;
    const ug = m.upper_games ?? 0;
    const lg = m.lower_games ?? 0;
    su.played += 1;
    sl.played += 1;
    su.games_won += ug;
    su.games_lost += lg;
    sl.games_won += lg;
    sl.games_lost += ug;
    if (ug > lg) {
      su.match_points += 3;
      su.opponents.push({ id: l, points: 0, result: "win" });
      sl.opponents.push({ id: u, points: 0, result: "loss" });
    } else if (ug < lg) {
      sl.match_points += 3;
      su.opponents.push({ id: l, points: 0, result: "loss" });
      sl.opponents.push({ id: u, points: 0, result: "win" });
    } else {
      su.match_points += 1;
      sl.match_points += 1;
      su.opponents.push({ id: l, points: 0, result: "draw" });
      sl.opponents.push({ id: u, points: 0, result: "draw" });
    }
  }
  return stats;
}

export function rankRoundRobin(entrants: EntrantRow[], matches: MatchRow[], byeIsWin: boolean): StandingRow[] {
  const stats = collect(entrants, matches, byeIsWin);
  const rows = [...stats.values()];
  const groups = new Map<number, Stat[]>();
  for (const st of rows) {
    const g = groups.get(st.match_points) ?? [];
    g.push(st);
    groups.set(st.match_points, g);
  }
  for (const g of groups.values()) {
    if (g.length > 1) {
      const ids = new Set(g.map((s) => s.entrant.id));
      for (const st of g) {
        let pts = 0;
        for (const m of matches) {
          if (m.state !== "confirmed" && m.state !== "resolved") continue;
          if (!m.upper_entrant_id || !m.lower_entrant_id) continue;
          if (!ids.has(m.upper_entrant_id) || !ids.has(m.lower_entrant_id)) continue;
          const ug = m.upper_games ?? 0;
          const lg = m.lower_games ?? 0;
          if (m.upper_entrant_id === st.entrant.id) pts += ug > lg ? 3 : ug === lg ? 1 : 0;
          else if (m.lower_entrant_id === st.entrant.id) pts += lg > ug ? 3 : ug === lg ? 1 : 0;
        }
        st.head_to_head = pts;
      }
    }
  }
  rows.sort(compareRR);
  const valueOf = (st: Stat): Record<string, number> => ({
    "Match points": st.match_points,
    "Head-to-head": st.head_to_head,
    "Game difference": st.games_won - st.games_lost,
    "Games won": st.games_won,
    Seed: st.entrant.seed,
  });
  assignPlaces(rows, RR_KEYS, valueOf);
  return rows.map(toRRRow);
}

function compareRR(a: Stat, b: Stat): number {
  if (a.match_points !== b.match_points) return b.match_points - a.match_points;
  if (a.head_to_head !== b.head_to_head) return b.head_to_head - a.head_to_head;
  const gdA = a.games_won - a.games_lost;
  const gdB = b.games_won - b.games_lost;
  if (gdA !== gdB) return gdB - gdA;
  if (a.games_won !== b.games_won) return b.games_won - a.games_won;
  return a.entrant.seed - b.entrant.seed;
}

export function rankSwiss(entrants: EntrantRow[], matches: MatchRow[], byeIsWin: boolean): StandingRow[] {
  const stats = collect(entrants, matches, byeIsWin);
  // opponent score: the opponent's current match points, or 0 for a bye
  for (const st of stats.values()) {
    for (const op of st.opponents) {
      op.points = op.id === null ? 0 : (stats.get(op.id)?.match_points ?? 0);
    }
    st.buchholz = st.opponents.reduce((s, o) => s + o.points, 0);
    const lowest = st.opponents.map((o) => o.points).sort((a, b) => a - b)[0] ?? 0;
    st.buchholz_cut_1 = st.buchholz - lowest;
    let sb = 0;
    for (const op of st.opponents) {
      if (op.result === "win") sb += op.points;
      else if (op.result === "draw") sb += op.points / 2;
    }
    st.sonneborn_berger = sb;
  }
  const rows = [...stats.values()];
  rows.sort(compareSwiss);
  const valueOf = (st: Stat): Record<string, number> => ({
    "Match points": st.match_points,
    "Buchholz cut 1": st.buchholz_cut_1,
    Buchholz: st.buchholz,
    "Sonneborn-Berger": st.sonneborn_berger,
    Seed: st.entrant.seed,
  });
  assignPlaces(rows, SWISS_KEYS, valueOf);
  return rows.map(toSwissRow);
}

function compareSwiss(a: Stat, b: Stat): number {
  if (a.match_points !== b.match_points) return b.match_points - a.match_points;
  if (a.buchholz_cut_1 !== b.buchholz_cut_1) return b.buchholz_cut_1 - a.buchholz_cut_1;
  if (a.buchholz !== b.buchholz) return b.buchholz - a.buchholz;
  if (a.sonneborn_berger !== b.sonneborn_berger) return b.sonneborn_berger - a.sonneborn_berger;
  return a.entrant.seed - b.entrant.seed;
}

function toRRRow(st: Stat): StandingRow {
  return {
    place: st.place,
    entrant_id: st.entrant.id,
    name: st.entrant.name,
    played: st.played,
    match_points: st.match_points,
    head_to_head: st.head_to_head,
    game_difference: st.games_won - st.games_lost,
    games_won: st.games_won,
    seed: st.entrant.seed,
    decided_by: st.decided_by,
  };
}

function toSwissRow(st: Stat): StandingRow {
  return {
    place: st.place,
    entrant_id: st.entrant.id,
    name: st.entrant.name,
    played: st.played,
    match_points: st.match_points,
    buchholz_cut_1: st.buchholz_cut_1,
    buchholz: st.buchholz,
    sonneborn_berger: st.sonneborn_berger,
    seed: st.entrant.seed,
    decided_by: st.decided_by,
  };
}

/**
 * `Decided by`: for each neighbouring row, the first column in tiebreak order
 * where the two rows differ; the row's deciding column is the later of these
 * columns for its neighbours above and below.
 */
function assignPlaces(rows: Stat[], keys: string[], valueOf: (st: Stat) => Record<string, number>): void {
  rows.forEach((st, i) => (st.place = i + 1));
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    const vals = valueOf(cur);
    let decided = keys[0]!;
    let decidedIdx = -1;
    for (const nb of [rows[i - 1], rows[i + 1]]) {
      if (!nb) continue;
      const nv = valueOf(nb);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]!;
        if (nv[key] !== vals[key]) {
          if (k > decidedIdx) {
            decidedIdx = k;
            decided = key;
          }
          break;
        }
      }
    }
    if (decidedIdx === -1) decided = keys[0]!;
    cur.decided_by = decided;
  }
}

/** Half values (e.g. Sonneborn-Berger) render with .5; whole numbers plain. */
export function formatHalf(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
