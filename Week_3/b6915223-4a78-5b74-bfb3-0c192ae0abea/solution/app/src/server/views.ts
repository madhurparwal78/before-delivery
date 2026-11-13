import type {
  ChipCode,
  HistoryRow,
  HistoryView,
  Position,
  SquadPlayer,
  SquadView,
  Standing,
} from "../shared/api.ts";
import type { Db } from "./db.ts";
import { pool } from "./db.ts";
import { notFound } from "./errors.ts";
import { currentGameweek } from "./gameweeks.ts";
import { chipStates } from "./rules/chips.ts";
import { netPoints } from "./rules/hits.ts";
import { sellingPrice } from "./rules/money.ts";
import { liveTeamPoints, rawPoints, type CountedEvent, type LockedTeam } from "./rules/scoring.ts";
import { rankStandings } from "./rules/standings.ts";

// Read models built from the stored records at read time (derived values are never stored ahead of time).

type Queryable = Db | typeof pool;

export interface PlayerRow {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export async function playerIndex(db: Queryable): Promise<Map<string, PlayerRow>> {
  const rows = await db.query<PlayerRow>("SELECT id, name, club, position, price_tenths FROM players");
  return new Map(rows.rows.map((row) => [row.id, row]));
}

export async function clubList(db: Queryable): Promise<{ code: string; name: string }[]> {
  return (await db.query<{ code: string; name: string }>("SELECT code, name FROM clubs ORDER BY sort_order")).rows;
}

export async function countedEvents(db: Queryable, gameweeks: readonly number[]): Promise<(CountedEvent & { gameweek: number })[]> {
  const rows = await db.query<CountedEvent & { gameweek: number }>(
    "SELECT gameweek, player_id, fixture_id, type, value FROM match_events WHERE NOT voided AND gameweek = ANY($1::int[]) ORDER BY seq",
    [gameweeks],
  );
  return rows.rows;
}

async function gameweekRawPoints(db: Queryable, gameweek: number, players: Map<string, PlayerRow>): Promise<Map<string, number>> {
  return rawPoints(await countedEvents(db, [gameweek]), (id) => players.get(id)!.position);
}

interface LockedRow {
  manager_id: string;
  gameweek: number;
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
  chip: ChipCode | null;
  hit_points: number;
  transfers_made: number;
  receipt: "pending" | "stored";
  points: number | null;
  net_points: number | null;
}

const LOCKED_COLUMNS =
  "manager_id, gameweek, starting, bench, captain, vice_captain, chip, hit_points, transfers_made, receipt, points, net_points";

const livePoints = (team: LockedTeam, raw: ReadonlyMap<string, number>) =>
  [...liveTeamPoints(team, raw).values()].reduce((sum, points) => sum + points, 0);

export async function squadView(db: Queryable, managerId: string): Promise<SquadView> {
  const gameweek = await currentGameweek(db);
  const squad = await db.query<{ captain: string; vice_captain: string; free_transfers: number }>(
    "SELECT captain, vice_captain, free_transfers FROM squads WHERE manager_id = $1",
    [managerId],
  );
  const head = squad.rows[0];
  if (!head) throw notFound("You have no squad yet.", "no_squad");
  // One query at a time: db may be a single transaction client, which runs queries in turn.
  const members = await db.query<{ player_id: string; purchase_price_tenths: number; eleven_index: number | null; bench_order: number | null }>(
    "SELECT player_id, purchase_price_tenths, eleven_index, bench_order FROM squad_players WHERE manager_id = $1",
    [managerId],
  );
  const rounds = await db.query<{ gameweek: number; transfers_made: number; hit_points: number; chip: ChipCode | null }>(
    "SELECT gameweek, transfers_made, hit_points, chip FROM manager_gameweeks WHERE manager_id = $1",
    [managerId],
  );
  const bank = await db.query<{ bank: number }>("SELECT COALESCE(SUM(amount_tenths), 0)::int AS bank FROM ledger_entries WHERE manager_id = $1", [managerId]);
  const players = await playerIndex(db);
  const round = rounds.rows.find((row) => row.gameweek === gameweek.number);
  const chipsByGameweek = new Map(rounds.rows.filter((row) => row.chip).map((row) => [row.gameweek, row.chip as ChipCode]));
  const starting = members.rows.filter((m) => m.eleven_index !== null).sort((a, b) => a.eleven_index! - b.eleven_index!);
  const bench = members.rows.filter((m) => m.bench_order !== null).sort((a, b) => a.bench_order! - b.bench_order!);
  const chip = round?.chip ?? null;
  let team = new Map<string, number>();
  let raw = new Map<string, number>();
  if (gameweek.status === "live" || gameweek.status === "closed") {
    raw = await gameweekRawPoints(db, gameweek.number, players);
    const locked = await db.query<LockedRow>(`SELECT ${LOCKED_COLUMNS} FROM locked_teams WHERE manager_id = $1 AND gameweek = $2`, [
      managerId,
      gameweek.number,
    ]);
    // Every squad that exists at the deadline has a locked team for the gameweek.
    team = liveTeamPoints(locked.rows[0]!, raw);
  }
  const view: SquadPlayer[] = [...starting, ...bench].map((member) => {
    const player = players.get(member.player_id)!;
    return {
      id: player.id,
      name: player.name,
      club: player.club,
      position: player.position,
      purchase_price_tenths: member.purchase_price_tenths,
      price_tenths: player.price_tenths,
      selling_price_tenths: sellingPrice(member.purchase_price_tenths, player.price_tenths),
      slot: member.eleven_index !== null ? "starting" : "bench",
      bench_order: member.bench_order,
      captain: player.id === head.captain,
      vice_captain: player.id === head.vice_captain,
      raw_points: raw.get(player.id) ?? 0,
      team_points: team.get(player.id) ?? 0,
    };
  });
  const hit = round?.hit_points ?? 0;
  return {
    gameweek: gameweek.number,
    gameweek_status: gameweek.status,
    editable: gameweek.status === "open",
    players: view,
    bank_tenths: bank.rows[0]!.bank,
    squad_value_tenths: view.reduce((sum, player) => sum + player.selling_price_tenths, 0),
    free_transfers: head.free_transfers,
    transfers_made: round?.transfers_made ?? 0,
    hit_points: hit,
    chip,
    chips: chipStates(gameweek.number, chipsByGameweek),
    gameweek_total: netPoints([...team.values()].reduce((sum, points) => sum + points, 0), hit),
  };
}

interface Totals {
  season_total: number;
  gameweek_points: number;
  live: Map<number, { points: number; net: number }>;
}

// Season totals: closed gameweek net scores, plus the live net while a gameweek is live (brief: Standings and totals).
async function seasonTotals(db: Queryable, managerIds: readonly string[]): Promise<Map<string, Totals>> {
  const locked = await db.query<LockedRow>(`SELECT ${LOCKED_COLUMNS} FROM locked_teams WHERE manager_id = ANY($1::text[])`, [managerIds]);
  const statuses = await db.query<{ number: number; status: string }>("SELECT number, status FROM gameweeks WHERE status IN ('live', 'closed')");
  const closed = new Set(statuses.rows.filter((row) => row.status === "closed").map((row) => row.number));
  const live = statuses.rows.find((row) => row.status === "live")?.number ?? null;
  const lastClosed = Math.max(0, ...closed);
  const raw = live === null ? new Map<string, number>() : await gameweekRawPoints(db, live, await playerIndex(db));
  const totals = new Map<string, Totals>(managerIds.map((id) => [id, { season_total: 0, gameweek_points: 0, live: new Map() }]));
  for (const row of locked.rows) {
    const total = totals.get(row.manager_id)!;
    if (closed.has(row.gameweek)) {
      total.season_total += row.net_points!;
      if (live === null && row.gameweek === lastClosed) total.gameweek_points = row.net_points!;
    } else if (row.gameweek === live) {
      const points = livePoints(row, raw);
      const net = netPoints(points, row.hit_points);
      total.live.set(row.gameweek, { points, net });
      total.season_total += net;
      total.gameweek_points = net;
    }
  }
  return totals;
}

export async function historyView(db: Queryable, managerId: string): Promise<HistoryView> {
  const manager = await db.query<{ team_name: string }>("SELECT team_name FROM managers WHERE id = $1", [managerId]);
  const locked = await db.query<LockedRow>(`SELECT ${LOCKED_COLUMNS} FROM locked_teams WHERE manager_id = $1 ORDER BY gameweek`, [managerId]);
  const statuses = await db.query<{ number: number; status: HistoryRow["status"] }>("SELECT number, status FROM gameweeks");
  const totals = await seasonTotals(db, [managerId]);
  const statusOf = new Map(statuses.rows.map((row) => [row.number, row.status]));
  const total = totals.get(managerId)!;
  let running = 0;
  const rows = locked.rows.map((row): HistoryRow => {
    const status = statusOf.get(row.gameweek)!;
    const closed = status === "closed";
    const live = total.live.get(row.gameweek);
    const points = closed ? row.points! : live?.points ?? 0;
    const net = closed ? row.net_points! : netPoints(points, row.hit_points);
    if (closed) running += net;
    return {
      gameweek: row.gameweek,
      status,
      points,
      hit_points: row.hit_points,
      net_points: net,
      running_total: closed ? running : null,
      chip: row.chip,
      captain: row.captain,
      vice_captain: row.vice_captain,
      transfers_made: row.transfers_made,
      receipt: row.receipt,
    };
  });
  return { manager_id: managerId, team_name: manager.rows[0]!.team_name, season_total: total.season_total, rows };
}

export async function leagueStandings(db: Queryable, leagueId: number): Promise<Standing[]> {
  const members = await db.query<{ manager_id: string; team_name: string; last_rank: number | null }>(
    "SELECT lm.manager_id, m.team_name, lm.last_rank FROM league_members lm JOIN managers m ON m.id = lm.manager_id WHERE lm.league_id = $1",
    [leagueId],
  );
  const totals = await seasonTotals(db, members.rows.map((row) => row.manager_id));
  return rankStandings(
    members.rows.map((row) => {
      const total = totals.get(row.manager_id)!;
      return { ...row, season_total: total.season_total, gameweek_points: total.gameweek_points };
    }),
  ).map((row) => ({
    rank: row.rank,
    last_rank: row.last_rank,
    manager_id: row.manager_id,
    team_name: row.team_name,
    gameweek_points: row.gameweek_points,
    season_total: row.season_total,
  }));
}
