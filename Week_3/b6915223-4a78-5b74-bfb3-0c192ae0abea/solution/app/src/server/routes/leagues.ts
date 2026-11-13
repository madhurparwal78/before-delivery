import type { LeagueCreated, LeagueDetail, LeagueSummary } from "../../shared/api.ts";
import { type Db, pool, publish, tx } from "../db.ts";
import { ApiError, conflict, notFound } from "../errors.ts";
import { currentGameweek } from "../gameweeks.ts";
import { json, route } from "../http.ts";
import { newJoinCode } from "../rules/standings.ts";
import { gameweekParam, objectBody, trimmedText } from "../validate.ts";
import { historyView, leagueStandings } from "../views.ts";
import { snapshotDownload } from "./history.ts";

// Private mini leagues (brief: Mini leagues). Non-members get 404.

interface LeagueRow {
  id: number;
  name: string;
  code: string;
  admin_manager_id: string;
}

async function memberLeague(db: Db | typeof pool, leagueParam: string | undefined, managerId: string): Promise<LeagueRow> {
  const id = /^\d{1,15}$/.test(leagueParam ?? "") ? Number(leagueParam) : 0;
  const found = await db.query<LeagueRow>(
    `SELECT l.id, l.name, l.code, l.admin_manager_id FROM leagues l
     JOIN league_members lm ON lm.league_id = l.id AND lm.manager_id = $2 WHERE l.id = $1`,
    [id, managerId],
  );
  if (!found.rows[0]) throw notFound("No league of yours has that id.");
  return found.rows[0];
}

async function memberOf(leagueId: number, managerId: string | undefined): Promise<string> {
  const found = await pool.query("SELECT 1 FROM league_members WHERE league_id = $1 AND manager_id = $2", [leagueId, managerId ?? ""]);
  if (!found.rowCount) throw notFound("That manager is not in this league.");
  return managerId!;
}

// Codes are unique across leagues; a clash simply draws again.
async function withFreshCode<T>(db: Db, write: (code: string) => Promise<T>): Promise<T> {
  for (;;) {
    const code = newJoinCode();
    await db.query("SAVEPOINT code");
    try {
      return await write(code);
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      await db.query("ROLLBACK TO SAVEPOINT code");
    }
  }
}

export const leagueRoutes = [
  route("POST", "/api/leagues", "manager", async ({ session, body }) => {
    const name = trimmedText(objectBody(body).name, "name", 3, 40, "League name");
    return tx(async (db) => {
      const league = await withFreshCode(db, async (code) =>
        (
          await db.query<LeagueRow>("INSERT INTO leagues (name, code, admin_manager_id) VALUES ($1, $2, $3) RETURNING id, name, code, admin_manager_id", [
            name,
            code,
            session.managerId,
          ])
        ).rows[0]!,
      );
      await db.query("INSERT INTO league_members (league_id, manager_id) VALUES ($1, $2)", [league.id, session.managerId]);
      await publish(db, { t: "league" });
      const created: LeagueCreated = { ...league, is_admin: true };
      return json(201, created);
    });
  }),

  route("POST", "/api/leagues/join", "manager", async ({ session, body }) => {
    const input = objectBody(body);
    const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
    return tx(async (db) => {
      const found = await db.query<LeagueRow>("SELECT id, name, code, admin_manager_id FROM leagues WHERE code = $1", [code]);
      const league = found.rows[0];
      if (!league) throw notFound("No league uses that code.", "league_not_found");
      const joined = await db.query(
        "INSERT INTO league_members (league_id, manager_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [league.id, session.managerId],
      );
      if (!joined.rowCount) throw conflict("already_member", "You are already in this league.");
      await publish(db, { t: "league" });
      const result: LeagueCreated = { id: league.id, name: league.name, code: null, admin_manager_id: league.admin_manager_id, is_admin: false };
      return json(200, result);
    });
  }),

  route("GET", "/api/leagues", "manager", async ({ session }) => {
    const rows = await pool.query<{ id: number; name: string; admin_manager_id: string; members: number }>(
      `SELECT l.id, l.name, l.admin_manager_id, (SELECT count(*) FROM league_members x WHERE x.league_id = l.id)::int AS members
       FROM league_members lm JOIN leagues l ON l.id = lm.league_id WHERE lm.manager_id = $1 ORDER BY lm.joined_at, l.id`,
      [session.managerId],
    );
    const leagues: LeagueSummary[] = [];
    for (const row of rows.rows) {
      const standing = (await leagueStandings(pool, row.id)).find((entry) => entry.manager_id === session.managerId)!;
      leagues.push({ id: row.id, name: row.name, is_admin: row.admin_manager_id === session.managerId, rank: standing.rank, members: row.members });
    }
    return json(200, { leagues });
  }),

  route("GET", "/api/leagues/:id", "manager", async ({ session, params }) => {
    const league = await memberLeague(pool, params.id, session.managerId);
    const detail: LeagueDetail = {
      id: league.id,
      name: league.name,
      code: league.admin_manager_id === session.managerId ? league.code : null,
      gameweek: (await currentGameweek(pool)).number,
      standings: await leagueStandings(pool, league.id),
    };
    return json(200, detail);
  }),

  route("POST", "/api/leagues/:id/code", "manager", async ({ session, params }) =>
    tx(async (db) => {
      const league = await memberLeague(db, params.id, session.managerId);
      if (league.admin_manager_id !== session.managerId) throw new ApiError(403, "forbidden", "Only the league admin can replace the join code.");
      const code = await withFreshCode(db, async (fresh) => {
        await db.query("UPDATE leagues SET code = $2 WHERE id = $1", [league.id, fresh]);
        return fresh;
      });
      return json(200, { code });
    }),
  ),

  route("GET", "/api/leagues/:id/members/:manager/history", "manager", async ({ session, params }) => {
    const league = await memberLeague(pool, params.id, session.managerId);
    return json(200, await historyView(pool, await memberOf(league.id, params.manager)));
  }),

  route("GET", "/api/leagues/:id/members/:manager/snapshots/:gameweek", "manager", async ({ session, params }) => {
    const league = await memberLeague(pool, params.id, session.managerId);
    const member = await memberOf(league.id, params.manager);
    return snapshotDownload(member, gameweekParam(params.gameweek));
  }),
];
