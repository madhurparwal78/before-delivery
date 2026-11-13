import type {
  ChipCode,
  ConfirmedTransfer,
  DraftState,
  DraftView,
  ErrorBody,
  TransferConfirmation,
  TransferPreview,
} from "../../shared/api.ts";
import { fingerprint, IDEMPOTENCY_KEY } from "../canonical.ts";
import { type Db, pool, publish, tx } from "../db.ts";
import { ApiError, invalid, rulesBroken } from "../errors.ts";
import { assertWritable, currentGameweek, gameweekForShare, withLateNotice } from "../gameweeks.ts";
import { json, route } from "../http.ts";
import { transferHit } from "../rules/hits.ts";
import { sellingPrice } from "../rules/money.ts";
import { positionsMismatch, squadRuleBreaks, transfersOverBudget, type SquadMember } from "../rules/squad.ts";
import { gameweekField, hasDuplicates, idList, objectBody } from "../validate.ts";
import { clubList, playerIndex, type PlayerRow } from "../views.ts";
import { lockManager, requireSquad } from "./squad.ts";

// Transfer preview, the server draft and confirmation (brief: DP-16 to DP-20, DP-24).

interface Owned extends PlayerRow {
  purchase_price_tenths: number;
  eleven_index: number | null;
  bench_order: number | null;
}

interface TransferContext {
  bank: number;
  freeTransfers: number;
  chip: ChipCode | null;
  owned: Map<string, Owned>;
  players: Map<string, PlayerRow>;
  clubs: { code: string; name: string }[];
}

async function transferContext(db: Db | typeof pool, managerId: string, gameweek: number, freeTransfers: number): Promise<TransferContext> {
  // One query at a time: db may be a single transaction client, which runs queries in turn.
  const players = await playerIndex(db);
  const members = await db.query<{ player_id: string; purchase_price_tenths: number; eleven_index: number | null; bench_order: number | null }>(
    "SELECT player_id, purchase_price_tenths, eleven_index, bench_order FROM squad_players WHERE manager_id = $1",
    [managerId],
  );
  const bank = await db.query<{ bank: number }>("SELECT COALESCE(SUM(amount_tenths), 0)::int AS bank FROM ledger_entries WHERE manager_id = $1", [managerId]);
  const round = await db.query<{ chip: ChipCode | null }>("SELECT chip FROM manager_gameweeks WHERE manager_id = $1 AND gameweek = $2", [managerId, gameweek]);
  const clubs = await clubList(db);
  const owned = new Map(members.rows.map((m) => [m.player_id, { ...players.get(m.player_id)!, ...m }]));
  return { bank: bank.rows[0]!.bank, freeTransfers, chip: round.rows[0]?.chip ?? null, owned, players, clubs };
}

function checkLists(context: TransferContext, outs: readonly string[], ins: readonly string[]): void {
  const fields: Record<string, string> = {};
  if ([...outs, ...ins].some((id) => !context.players.has(id))) fields.players = "Every id must be a seeded player.";
  else if (outs.some((id) => !context.owned.has(id))) fields.out = "Every player out must be in your squad.";
  else if (ins.some((id) => context.owned.has(id))) fields.in = "A player in must not already be in your squad.";
  else if (ins.length > outs.length) fields.in = "There are more players in than players out.";
  else if (hasDuplicates(outs) || hasDuplicates(ins)) fields.players = "A player can only be named once.";
  if (Object.keys(fields).length > 0) throw invalid(fields);
}

// Only the first outs matched one for one with the ins count as transfers (brief: Squad rules).
function previewOf(context: TransferContext, outs: readonly string[], ins: readonly string[]): TransferPreview {
  const pairs = ins.map((id, index) => [context.owned.get(outs[index]!)!, context.players.get(id)!] as const);
  const pairedOut = new Set(pairs.map(([out]) => out.id));
  const resulting: SquadMember[] = [...[...context.owned.values()].filter((p) => !pairedOut.has(p.id)), ...pairs.map(([, incoming]) => incoming)];
  const sell = (id: string) => {
    const player = context.owned.get(id)!;
    return sellingPrice(player.purchase_price_tenths, player.price_tenths);
  };
  const { freeUsed, hit } = transferHit(pairs.length, context.freeTransfers, context.chip);
  const buying = ins.map((id) => context.players.get(id)!.price_tenths);
  return {
    count: pairs.length,
    free_transfers_used: freeUsed,
    hit_points: hit,
    // The bank afterwards counts every player out; the budget rule counts only the paired outs (brief: Squad rules).
    bank_after_tenths: context.bank + outs.reduce((sum, id) => sum + sell(id), 0) - buying.reduce((sum, price) => sum + price, 0),
    rules: squadRuleBreaks({
      members: resulting,
      clubs: context.clubs,
      overBudget: transfersOverBudget(context.bank, pairs.map(([out]) => sell(out.id)), buying),
      positionMismatch: positionsMismatch(pairs),
    }),
  };
}

const emptyPreview = (bank: number): TransferPreview => ({ count: 0, free_transfers_used: 0, hit_points: 0, bank_after_tenths: bank, rules: [] });

async function draftView(db: Db | typeof pool, managerId: string): Promise<DraftView> {
  const gameweek = await currentGameweek(db);
  const draft = await db.query<{ gameweek: number; state: DraftState; out_ids: string[]; in_ids: string[]; refusal: ErrorBody | null }>(
    "SELECT gameweek, state, out_ids, in_ids, refusal FROM drafts WHERE manager_id = $1",
    [managerId],
  );
  const squad = await db.query<{ free_transfers: number }>("SELECT free_transfers FROM squads WHERE manager_id = $1", [managerId]);
  const row = draft.rows[0]?.gameweek === gameweek.number ? draft.rows[0] : null;
  const view: DraftView = {
    gameweek: gameweek.number,
    state: row?.state ?? "clean",
    out: row?.out_ids ?? [],
    in: row?.in_ids ?? [],
    preview: emptyPreview(0),
    refusal: row?.refusal ?? null,
  };
  if (squad.rows[0]) {
    const context = await transferContext(db, managerId, gameweek.number, squad.rows[0].free_transfers);
    view.preview = emptyPreview(context.bank);
    try {
      checkLists(context, view.out, view.in);
      view.preview = previewOf(context, view.out, view.in);
    } catch {
      // A draft that no longer fits the squad shows no figures until it is edited.
    }
  }
  return view;
}

async function saveDraft(db: Db | typeof pool, managerId: string, gameweek: number, state: DraftState, outs: readonly string[], ins: readonly string[], refusal: ErrorBody | null) {
  await db.query(
    `INSERT INTO drafts (manager_id, gameweek, state, out_ids, in_ids, refusal) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (manager_id) DO UPDATE SET gameweek = EXCLUDED.gameweek, state = EXCLUDED.state, out_ids = EXCLUDED.out_ids,
       in_ids = EXCLUDED.in_ids, refusal = EXCLUDED.refusal`,
    [managerId, gameweek, state, JSON.stringify(outs), JSON.stringify(ins), refusal === null ? null : JSON.stringify(refusal)],
  );
}

// A refused confirmation while the gameweek is open keeps the draft lists and records the refusal.
async function recordRefusal(managerId: string, gameweek: number, refusal: ErrorBody): Promise<void> {
  await tx(async (db) => {
    const open = await db.query("SELECT 1 FROM gameweeks WHERE number = $1 AND status = 'open'", [gameweek]);
    if (!open.rowCount) return;
    const draft = await db.query<{ gameweek: number; out_ids: string[]; in_ids: string[] }>(
      "SELECT gameweek, out_ids, in_ids FROM drafts WHERE manager_id = $1 FOR UPDATE",
      [managerId],
    );
    const kept = draft.rows[0]?.gameweek === gameweek ? draft.rows[0] : null;
    await saveDraft(db, managerId, gameweek, "refused", kept?.out_ids ?? [], kept?.in_ids ?? [], refusal);
    await publish(db, { t: "squad", manager: managerId });
  });
}

function transferLists(input: Record<string, unknown>): { outs: string[]; ins: string[] } {
  return { outs: idList(input.out, "out"), ins: idList(input.in, "in") };
}

export const transferRoutes = [
  route("POST", "/api/transfers/preview", "manager", async ({ session, body }) => {
    const input = objectBody(body);
    const number = gameweekField(input.gameweek);
    return tx(async (db) => {
      const gameweek = await gameweekForShare(db, number);
      const squad = await requireSquad(db, session.managerId);
      assertWritable(gameweek);
      const { outs, ins } = transferLists(input);
      const context = await transferContext(db, session.managerId, number, squad.free_transfers);
      checkLists(context, outs, ins);
      return json(200, previewOf(context, outs, ins));
    });
  }),

  route("GET", "/api/transfers/draft", "manager", async ({ session }) => json(200, await draftView(pool, session.managerId))),

  route("PUT", "/api/transfers/draft", "manager", async ({ session, body }) => {
    const input = objectBody(body);
    const number = gameweekField(input.gameweek);
    return tx(async (db) => {
      const gameweek = await gameweekForShare(db, number);
      await lockManager(db, session.managerId);
      const squad = await requireSquad(db, session.managerId);
      assertWritable(gameweek);
      const { outs, ins } = transferLists(input);
      checkLists(await transferContext(db, session.managerId, number, squad.free_transfers), outs, ins);
      await saveDraft(db, session.managerId, number, outs.length + ins.length === 0 ? "clean" : "drafting", outs, ins, null);
      await publish(db, { t: "squad", manager: session.managerId });
      return json(200, await draftView(db, session.managerId));
    });
  }),

  route("DELETE", "/api/transfers/draft", "manager", async ({ session }) =>
    tx(async (db) => {
      const gameweek = await currentGameweek(db, true);
      await lockManager(db, session.managerId);
      await saveDraft(db, session.managerId, gameweek.number, "clean", [], [], null);
      await publish(db, { t: "squad", manager: session.managerId });
      return json(200, await draftView(db, session.managerId));
    }),
  ),

  route("POST", "/api/transfers", "manager", async ({ session, body, headers }) => {
    const managerId = session.managerId;
    const input = objectBody(body);
    const number = gameweekField(input.gameweek);
    const key = headers["idempotency-key"];
    try {
      return await withLateNotice(managerId, () => number, () =>
        tx(async (db) => {
          const gameweek = await gameweekForShare(db, number);
          await lockManager(db, managerId);
          const squad = await requireSquad(db, managerId);
          if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
            throw invalid({ "Idempotency-Key": "Send an Idempotency-Key of 1 to 64 letters, digits, - or _." });
          }
          const print = fingerprint(input);
          const stored = await db.query<{ fingerprint: string; status: number; response: string }>(
            "SELECT fingerprint, status, response FROM idempotency_keys WHERE manager_id = $1 AND key = $2",
            [managerId, key],
          );
          const earlier = stored.rows[0];
          if (earlier) {
            if (earlier.fingerprint !== print) {
              throw new ApiError(422, "idempotency_key_reused", "This Idempotency-Key was already used for different transfers.");
            }
            return {
              status: earlier.status,
              raw: Buffer.from(earlier.response),
              headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
            };
          }
          assertWritable(gameweek);
          const { outs, ins } = transferLists(input);
          if (outs.length !== ins.length) throw invalid({ in: "Name one player in for every player out." });
          const context = await transferContext(db, managerId, number, squad.free_transfers);
          checkLists(context, outs, ins);
          const preview = previewOf(context, outs, ins);
          if (preview.rules.length > 0) throw rulesBroken(preview.rules, "Transfers refused");
          if (typeof input.hit_points !== "number" || !Number.isInteger(input.hit_points)) {
            throw invalid({ hit_points: "hit_points must be the hit you were shown." });
          }
          if (input.hit_points !== preview.hit_points) {
            throw new ApiError(409, "hit_changed", `The hit is now ${preview.hit_points} points. Check it and confirm again.`, {
              hit_points: preview.hit_points,
            });
          }
          let { captain, vice_captain: viceCaptain } = squad;
          const made: ConfirmedTransfer[] = [];
          for (const [index, outId] of outs.entries()) {
            const out = context.owned.get(outId)!;
            const incoming = context.players.get(ins[index]!)!;
            const sell = sellingPrice(out.purchase_price_tenths, out.price_tenths);
            const transfer = await db.query<{ id: number }>(
              `INSERT INTO transfers (manager_id, gameweek, out_player_id, sell_price_tenths, in_player_id, price_tenths, free_hit)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [managerId, number, out.id, sell, incoming.id, incoming.price_tenths, context.chip === "free_hit"],
            );
            const transferId = transfer.rows[0]!.id;
            await db.query(
              `INSERT INTO ledger_entries (manager_id, kind, amount_tenths, player_id, transfer_id, gameweek)
               VALUES ($1, 'sale', $2, $3, $6, $7), ($1, 'purchase', $4, $5, $6, $7)`,
              [managerId, sell, out.id, -incoming.price_tenths, incoming.id, transferId, number],
            );
            // The incoming player takes the outgoing player's place and any armband (brief: Eleven order, Armbands).
            await db.query("DELETE FROM squad_players WHERE manager_id = $1 AND player_id = $2", [managerId, out.id]);
            await db.query(
              "INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths, eleven_index, bench_order) VALUES ($1, $2, $3, $4, $5)",
              [managerId, incoming.id, incoming.price_tenths, out.eleven_index, out.bench_order],
            );
            if (captain === out.id) captain = incoming.id;
            if (viceCaptain === out.id) viceCaptain = incoming.id;
            made.push({ id: transferId, out: out.id, in: incoming.id, sell_price_tenths: sell, price_tenths: incoming.price_tenths });
          }
          const updated = await db.query<{ free_transfers: number }>(
            "UPDATE squads SET captain = $2, vice_captain = $3, free_transfers = free_transfers - $4 WHERE manager_id = $1 RETURNING free_transfers",
            [managerId, captain, viceCaptain, preview.free_transfers_used],
          );
          const round = await db.query<{ hit_points: number }>(
            `INSERT INTO manager_gameweeks (manager_id, gameweek, transfers_made, hit_points) VALUES ($1, $2, $3, $4)
             ON CONFLICT (manager_id, gameweek) DO UPDATE SET transfers_made = manager_gameweeks.transfers_made + EXCLUDED.transfers_made,
               hit_points = manager_gameweeks.hit_points + EXCLUDED.hit_points
             RETURNING hit_points`,
            [managerId, number, made.length, preview.hit_points],
          );
          const confirmation: TransferConfirmation = {
            transfers: made,
            hit_points: preview.hit_points,
            gameweek_hit_points: round.rows[0]!.hit_points,
            bank_tenths: preview.bank_after_tenths,
            free_transfers: updated.rows[0]!.free_transfers,
          };
          await db.query("INSERT INTO idempotency_keys (manager_id, key, fingerprint, status, response) VALUES ($1, $2, $3, 201, $4)", [
            managerId,
            key,
            print,
            JSON.stringify(confirmation),
          ]);
          await saveDraft(db, managerId, number, "confirmed", [], [], null);
          await publish(db, { t: "squad", manager: managerId });
          return json(201, confirmation);
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && ["hit_changed", "rules_broken", "validation"].includes(error.code)) {
        await recordRefusal(managerId, number, error.body());
      }
      throw error;
    }
  }),
];
