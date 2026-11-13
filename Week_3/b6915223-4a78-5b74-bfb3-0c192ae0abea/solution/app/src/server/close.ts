import type { ChipCode, GameweekStatus } from "../shared/api.ts";
import { publish, tx } from "./db.ts";
import { noticeText } from "./notices.ts";
import { assertStep, canStep } from "./rules/gameweek.ts";
import { netPoints } from "./rules/hits.ts";
import { closedTeamScore, playedPlayers, rawPoints } from "./rules/scoring.ts";
import { LAST_GAMEWEEK } from "./seed.ts";
import { countedEvents, leagueStandings, playerIndex } from "./views.ts";
import { writeEleven } from "./routes/squad.ts";

// Closing a live gameweek, in one step (brief: Close): auto-subs, captain fallback, fixed scores,
// Free Hit revert, the next gameweek opens, then the auto_sub notices.

interface FreeHitBackup {
  captain: string;
  vice_captain: string;
  players: { player_id: string; purchase_price_tenths: number; eleven_index: number | null; bench_order: number | null }[];
}

export async function closeGameweek(number: number): Promise<number | null> {
  return tx(async (db) => {
    const gameweek = await db.query<{ status: GameweekStatus }>("SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE", [number]);
    assertStep(number, gameweek.rows[0]!.status, "close");
    const players = await playerIndex(db);
    const positionOf = (id: string) => players.get(id)!.position;
    const events = await countedEvents(db, [number]);
    const raw = rawPoints(events, positionOf);
    const played = playedPlayers(events);
    const locked = await db.query<{ manager_id: string; starting: string[]; bench: string[]; captain: string; vice_captain: string; chip: ChipCode | null; hit_points: number }>(
      "SELECT manager_id, starting, bench, captain, vice_captain, chip, hit_points FROM locked_teams WHERE gameweek = $1",
      [number],
    );
    const scores = [];
    const notices = [];
    for (const team of locked.rows) {
      const score = closedTeamScore(team, raw, played, positionOf);
      scores.push({ manager_id: team.manager_id, points: score.points, net_points: netPoints(score.points, team.hit_points) });
      for (const sub of score.substitutions) {
        notices.push({ manager_id: team.manager_id, message: noticeText.autoSub(players.get(sub.in)!.name, players.get(sub.out)!.name, number) });
      }
      if (score.armbandFallback) {
        notices.push({ manager_id: team.manager_id, message: noticeText.armband(players.get(score.armbandFallback)!.name, number) });
      }
    }
    await db.query(
      `UPDATE locked_teams lt SET points = s.points, net_points = s.net_points
       FROM jsonb_to_recordset($1::jsonb) AS s(manager_id text, points integer, net_points integer)
       WHERE lt.gameweek = $2 AND lt.manager_id = s.manager_id`,
      [JSON.stringify(scores), number],
    );
    const freeHits = await db.query<{ manager_id: string; free_hit_backup: FreeHitBackup }>(
      "SELECT manager_id, free_hit_backup FROM manager_gameweeks WHERE gameweek = $1 AND chip = 'free_hit'",
      [number],
    );
    for (const { manager_id: managerId, free_hit_backup: backup } of freeHits.rows) {
      await db.query("DELETE FROM squad_players WHERE manager_id = $1", [managerId]);
      await db.query(
        `INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths)
         SELECT $1, b.player_id, b.purchase_price_tenths FROM jsonb_to_recordset($2::jsonb) AS b(player_id text, purchase_price_tenths integer)`,
        [managerId, JSON.stringify(backup.players)],
      );
      const order = (key: "eleven_index" | "bench_order") =>
        backup.players.filter((p) => p[key] !== null).sort((a, b) => a[key]! - b[key]!).map((p) => p.player_id);
      await writeEleven(db, managerId, order("eleven_index"), order("bench_order"));
      await db.query("UPDATE squads SET captain = $2, vice_captain = $3 WHERE manager_id = $1", [managerId, backup.captain, backup.vice_captain]);
      await db.query(
        `INSERT INTO ledger_entries (manager_id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek)
         SELECT le.manager_id, 'reversal', -le.amount_tenths, le.player_id, le.transfer_id, le.id, $2
         FROM ledger_entries le JOIN transfers t ON t.id = le.transfer_id
         WHERE le.manager_id = $1 AND t.gameweek = $2 AND t.free_hit AND le.kind IN ('sale', 'purchase')
         ORDER BY le.id`,
        [managerId, number],
      );
    }
    await db.query("UPDATE gameweeks SET status = 'closed', closed_at = now() WHERE number = $1", [number]);
    const next = number < LAST_GAMEWEEK ? number + 1 : null;
    if (next !== null) {
      const upcoming = await db.query<{ status: GameweekStatus }>("SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE", [next]);
      if (canStep(upcoming.rows[0]!.status, "open")) await db.query("UPDATE gameweeks SET status = 'open' WHERE number = $1", [next]);
    }
    const leagues = await db.query<{ id: number }>("SELECT id FROM leagues");
    for (const league of leagues.rows) {
      const standings = await leagueStandings(db, league.id);
      await db.query(
        `UPDATE league_members lm SET last_rank = s.rank FROM jsonb_to_recordset($2::jsonb) AS s(manager_id text, rank integer)
         WHERE lm.league_id = $1 AND lm.manager_id = s.manager_id`,
        [league.id, JSON.stringify(standings)],
      );
    }
    await db.query(
      `INSERT INTO notice_outbox (manager_id, kind, gameweek, message)
       SELECT n.manager_id, 'auto_sub', $2, n.message FROM jsonb_to_recordset($1::jsonb) AS n(manager_id text, message text)`,
      [JSON.stringify(notices), number],
    );
    await publish(db, { t: "gameweek" });
    await publish(db, { t: "outbox" });
    return next;
  });
}

