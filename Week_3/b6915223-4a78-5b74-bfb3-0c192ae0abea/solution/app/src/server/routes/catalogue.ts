import { isPosition, isSortOrder, type CataloguePlayer, type GameweekSummary, type SortOrder } from "../../shared/api.ts";
import { pool } from "../db.ts";
import { invalid } from "../errors.ts";
import { currentGameweek, describeGameweek } from "../gameweeks.ts";
import { json, route } from "../http.ts";
import { rawPoints } from "../rules/scoring.ts";
import { clubList, countedEvents, playerIndex } from "../views.ts";

// The player catalogue and the gameweek calendar (brief: Accounts and catalogue).

const compareNames = (a: CataloguePlayer, b: CataloguePlayer) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const ORDER: Record<SortOrder, (a: CataloguePlayer, b: CataloguePlayer) => number> = {
  price_desc: (a, b) => b.price_tenths - a.price_tenths || compareNames(a, b),
  price_asc: (a, b) => a.price_tenths - b.price_tenths || compareNames(a, b),
  points_desc: (a, b) => b.total_points - a.total_points || compareNames(a, b),
  name_asc: compareNames,
};

export const catalogueRoutes = [
  route("GET", "/api/clubs", "signed-in", async () => json(200, { clubs: await clubList(pool) })),

  route("GET", "/api/players", "signed-in", async ({ query }) => {
    const position = query.get("position") || null;
    const club = query.get("club") || null;
    const maxPrice = query.get("max_price") || null;
    const sort = query.get("sort") || "price_desc";
    const clubs = await clubList(pool);
    const fields: Record<string, string> = {};
    if (position && !isPosition(position)) fields.position = "position is GK, DEF, MID or FWD.";
    if (club && !clubs.some((known) => known.code === club)) fields.club = "club is a three-letter club code.";
    const price = maxPrice?.match(/^(\d{1,3})(?:\.(\d))?$/);
    if (maxPrice && !price) fields.max_price = "max_price is millions with one decimal, such as 6.5.";
    if (!isSortOrder(sort)) fields.sort = "sort is price_desc, price_asc, points_desc or name_asc.";
    if (Object.keys(fields).length > 0 || !isSortOrder(sort)) throw invalid(fields);
    const capTenths = price ? Number(price[1]) * 10 + Number(price[2] ?? "0") : null;
    const [players, gameweek, statuses] = await Promise.all([
      playerIndex(pool),
      currentGameweek(pool),
      pool.query<{ number: number }>("SELECT number FROM gameweeks WHERE status IN ('closed', 'live')"),
    ]);
    const events = await countedEvents(pool, statuses.rows.map((row) => row.number));
    const positionOf = (id: string) => players.get(id)!.position;
    const total = rawPoints(events, positionOf);
    const thisWeek = gameweek.status === "open" ? new Map<string, number>() : rawPoints(events.filter((e) => e.gameweek === gameweek.number), positionOf);
    const rows = [...players.values()]
      .filter((p) => (!position || p.position === position) && (!club || p.club === club) && (capTenths === null || p.price_tenths <= capTenths))
      .map((p): CataloguePlayer => ({ ...p, total_points: total.get(p.id) ?? 0, gameweek_points: thisWeek.get(p.id) ?? 0 }))
      .sort(ORDER[sort]);
    return json(200, { players: rows });
  }),

  route("GET", "/api/gameweeks", "signed-in", async () => {
    const rows = await pool.query<Omit<GameweekSummary, "deadline"> & { deadline: Date | null }>(
      "SELECT number, status, deadline FROM gameweeks ORDER BY number",
    );
    const gameweeks: GameweekSummary[] = rows.rows.map((row) => ({ ...row, deadline: row.deadline?.toISOString() ?? null }));
    return json(200, { gameweeks });
  }),

  route("GET", "/api/gameweeks/current", "signed-in", async () => json(200, await describeGameweek(pool, await currentGameweek(pool)))),
];
