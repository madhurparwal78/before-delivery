import { isChip, type ChipCode } from "../../shared/api.ts";
import { type Db, pool, publish, tx } from "../db.ts";
import { conflict, invalid, notFound, rulesBroken } from "../errors.ts";
import { assertWritable, currentGameweek, gameweekForShare, withLateNotice } from "../gameweeks.ts";
import { json, route } from "../http.ts";
import { chipCancellable, chipRefusal } from "../rules/chips.ts";
import { defaultEleven, elevenRuleBreaks, inElevenOrder } from "../rules/eleven.ts";
import { BUDGET_TENTHS, newSquadOverBudget, squadRuleBreaks } from "../rules/squad.ts";
import { gameweekField, gameweekParam, hasDuplicates, idList, objectBody } from "../validate.ts";
import { clubList, playerIndex, squadView } from "../views.ts";

// Squad, picks and chips (brief: Squad, picks, chips and transfers).

const CHIP_REFUSALS: Record<string, (chip: string) => string> = {
  chip_already_this_gameweek: () => "Only one chip can be played in a gameweek.",
  chip_used: (chip) => `${chip} has already been used in this half of the season.`,
  free_hit_back_to_back: () => "Free Hit cannot be played in two gameweeks in a row.",
  chip_after_transfers: (chip) => `${chip} must be played before making transfers this gameweek.`,
};
const CHIP_NAMES: Record<ChipCode, string> = {
  wildcard: "Wildcard",
  free_hit: "Free Hit",
  bench_boost: "Bench Boost",
  triple_captain: "Triple Captain",
};

// Serialises one manager's writes. Always taken after the gameweek row, never before it.
export async function lockManager(db: Db, managerId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('manager:' || $1))", [managerId]);
}

export async function requireSquad(db: Db, managerId: string): Promise<{ captain: string; vice_captain: string; free_transfers: number }> {
  const found = await db.query<{ captain: string; vice_captain: string; free_transfers: number }>(
    "SELECT captain, vice_captain, free_transfers FROM squads WHERE manager_id = $1",
    [managerId],
  );
  if (!found.rows[0]) throw notFound("You have no squad yet.", "no_squad");
  return found.rows[0];
}

export async function writeEleven(db: Db, managerId: string, starting: readonly string[], bench: readonly string[]): Promise<void> {
  await db.query(
    `UPDATE squad_players sp SET eleven_index = x.eleven_index, bench_order = x.bench_order
     FROM jsonb_to_recordset($2::jsonb) AS x(player_id text, eleven_index integer, bench_order integer)
     WHERE sp.manager_id = $1 AND sp.player_id = x.player_id`,
    [
      managerId,
      JSON.stringify([
        ...starting.map((id, index) => ({ player_id: id, eleven_index: index, bench_order: null })),
        ...bench.map((id, index) => ({ player_id: id, eleven_index: null, bench_order: index + 1 })),
      ]),
    ],
  );
}

async function chipsByGameweek(db: Db, managerId: string): Promise<Map<number, ChipCode>> {
  const rows = await db.query<{ gameweek: number; chip: ChipCode }>(
    "SELECT gameweek, chip FROM manager_gameweeks WHERE manager_id = $1 AND chip IS NOT NULL",
    [managerId],
  );
  return new Map(rows.rows.map((row) => [row.gameweek, row.chip]));
}

export const squadRoutes = [
  route("GET", "/api/squad", "manager", async ({ session }) => json(200, await squadView(pool, session.managerId))),

  route("POST", "/api/squad", "manager", async ({ session, body }) => {
    const managerId = session.managerId;
    let gameweek: number | null = null;
    return withLateNotice(managerId, () => gameweek, () =>
      tx(async (db) => {
        const current = await currentGameweek(db, true);
        gameweek = current.number;
        await lockManager(db, managerId);
        if ((await db.query("SELECT 1 FROM squads WHERE manager_id = $1", [managerId])).rowCount) {
          throw conflict("squad_exists", "You already have a squad.");
        }
        assertWritable(current);
        const ids = idList(objectBody(body).players, "players");
        const players = await playerIndex(db);
        const unknown = ids.filter((id) => !players.has(id));
        if (unknown.length > 0) throw invalid({ players: `Unknown player ids: ${unknown.join(", ")}.` });
        const members = ids.map((id) => players.get(id)!);
        const rules = squadRuleBreaks({
          members,
          clubs: await clubList(db),
          overBudget: newSquadOverBudget(members.map((member) => member.price_tenths)),
          positionMismatch: false,
        });
        if (rules.length > 0) throw rulesBroken(rules, "Squad refused");
        const eleven = defaultEleven(members);
        await db.query("INSERT INTO squads (manager_id, captain, vice_captain, free_transfers) VALUES ($1, $2, $3, 1)", [
          managerId,
          eleven.captain,
          eleven.viceCaptain,
        ]);
        await db.query(
          `INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths)
           SELECT $1, p.id, p.price_tenths FROM players p WHERE p.id = ANY($2::text[])`,
          [managerId, ids],
        );
        await writeEleven(db, managerId, eleven.starting, eleven.bench);
        await db.query(
          "INSERT INTO ledger_entries (manager_id, kind, amount_tenths, gameweek) VALUES ($1, 'opening_budget', $2, $3)",
          [managerId, BUDGET_TENTHS, current.number],
        );
        await db.query(
          `INSERT INTO ledger_entries (manager_id, kind, amount_tenths, player_id, gameweek)
           SELECT $1, 'purchase', -p.price_tenths, p.id, $3 FROM unnest($2::text[]) WITH ORDINALITY AS u(id, n)
           JOIN players p ON p.id = u.id ORDER BY u.n`,
          [managerId, ids, current.number],
        );
        await db.query("INSERT INTO manager_gameweeks (manager_id, gameweek) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
          managerId,
          current.number,
        ]);
        await publish(db, { t: "squad", manager: managerId });
        return json(201, await squadView(db, managerId));
      }),
    );
  }),

  route("PUT", "/api/picks", "manager", async ({ session, body }) => {
    const managerId = session.managerId;
    const input = objectBody(body);
    const number = gameweekField(input.gameweek);
    return withLateNotice(managerId, () => number, () =>
      tx(async (db) => {
        const gameweek = await gameweekForShare(db, number);
        await lockManager(db, managerId);
        await requireSquad(db, managerId);
        assertWritable(gameweek);
        const starting = idList(input.starting, "starting");
        const bench = idList(input.bench, "bench");
        const { captain, vice_captain: viceCaptain } = input;
        if (typeof captain !== "string" || typeof viceCaptain !== "string") {
          throw invalid({ captain: "captain and vice_captain must be player ids." });
        }
        const owned = await db.query<{ player_id: string }>("SELECT player_id FROM squad_players WHERE manager_id = $1", [managerId]);
        const squad = new Set(owned.rows.map((row) => row.player_id));
        const named = [...starting, ...bench];
        if (hasDuplicates(named) || named.length !== squad.size || !named.every((id) => squad.has(id))) {
          throw invalid({ starting: "starting and bench must name exactly the fifteen squad players." });
        }
        const players = await playerIndex(db);
        const place = (id: string) => ({ id, position: players.get(id)!.position });
        const rules = elevenRuleBreaks(starting.map(place), bench.map(place), captain, viceCaptain);
        if (rules.length > 0) throw rulesBroken(rules, "Lineup refused");
        await writeEleven(db, managerId, inElevenOrder(starting.map(place)).map((p) => p.id), bench);
        await db.query("UPDATE squads SET captain = $2, vice_captain = $3 WHERE manager_id = $1", [managerId, captain, viceCaptain]);
        await publish(db, { t: "squad", manager: managerId });
        return json(200, await squadView(db, managerId));
      }),
    );
  }),

  route("POST", "/api/chips", "manager", async ({ session, body }) => {
    const managerId = session.managerId;
    const input = objectBody(body);
    const number = gameweekField(input.gameweek);
    return withLateNotice(managerId, () => number, () =>
      tx(async (db) => {
        const gameweek = await gameweekForShare(db, number);
        await lockManager(db, managerId);
        const squad = await requireSquad(db, managerId);
        assertWritable(gameweek);
        const chip = input.chip;
        if (!isChip(chip)) throw invalid({ chip: "chip is wildcard, free_hit, bench_boost or triple_captain." });
        const round = await db.query<{ transfers_made: number }>(
          "SELECT transfers_made FROM manager_gameweeks WHERE manager_id = $1 AND gameweek = $2",
          [managerId, number],
        );
        const refusal = chipRefusal({
          chip,
          gameweek: number,
          chipsByGameweek: await chipsByGameweek(db, managerId),
          transfersMade: round.rows[0]?.transfers_made ?? 0,
        });
        if (refusal) throw conflict(refusal, CHIP_REFUSALS[refusal]!(CHIP_NAMES[chip]));
        // Free Hit keeps the squad as it was, so close can put it back (brief: Free Hit revert).
        const backup =
          chip === "free_hit"
            ? {
                captain: squad.captain,
                vice_captain: squad.vice_captain,
                players: (
                  await db.query("SELECT player_id, purchase_price_tenths, eleven_index, bench_order FROM squad_players WHERE manager_id = $1", [
                    managerId,
                  ])
                ).rows,
              }
            : null;
        await db.query(
          `INSERT INTO manager_gameweeks (manager_id, gameweek, chip, free_hit_backup) VALUES ($1, $2, $3, $4)
           ON CONFLICT (manager_id, gameweek) DO UPDATE SET chip = EXCLUDED.chip, free_hit_backup = EXCLUDED.free_hit_backup`,
          [managerId, number, chip, backup === null ? null : JSON.stringify(backup)],
        );
        await publish(db, { t: "squad", manager: managerId });
        return json(201, await squadView(db, managerId));
      }),
    );
  }),

  route("DELETE", "/api/chips/:gameweek", "manager", async ({ session, params }) => {
    const managerId = session.managerId;
    const number = gameweekParam(params.gameweek);
    return withLateNotice(managerId, () => number, () =>
      tx(async (db) => {
        const gameweek = await gameweekForShare(db, number);
        await lockManager(db, managerId);
        const played = await db.query<{ chip: ChipCode | null }>(
          "SELECT chip FROM manager_gameweeks WHERE manager_id = $1 AND gameweek = $2",
          [managerId, number],
        );
        const chip = played.rows[0]?.chip;
        if (!chip) throw notFound(`No chip is played for gameweek ${number}.`);
        assertWritable(gameweek);
        if (!chipCancellable(chip)) throw conflict("chip_locked_in", `${CHIP_NAMES[chip]} cannot be cancelled once played.`);
        await db.query("UPDATE manager_gameweeks SET chip = NULL, free_hit_backup = NULL WHERE manager_id = $1 AND gameweek = $2", [
          managerId,
          number,
        ]);
        await publish(db, { t: "squad", manager: managerId });
        return json(200, await squadView(db, managerId));
      }),
    );
  }),
];
