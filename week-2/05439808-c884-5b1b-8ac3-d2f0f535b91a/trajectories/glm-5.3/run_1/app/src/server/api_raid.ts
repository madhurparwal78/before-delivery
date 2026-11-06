// Raids: scouting, the single raid lock, deploy batches, resolution with loot, trophies, shield
// and cooldown, snapshots and the raid log.
import type { PoolClient } from 'pg';
import { errors } from './errors.ts';
import { pathId, route, type Ctx, type HandlerResult } from './http.ts';
import { getApp, withTransaction } from './runtime.ts';
import { abandonExpiredRaids, loadIsland, lockVillages, lootableOf, type IslandState } from './island.ts';
import { creditCapped, islandPair, tidePair } from './ledger.ts';
import { beginIdempotency, storeResponse } from './idempotency.ts';
import { buildingHp, leagueFor } from '../domain/catalog.ts';
import { dayStart, nextDayStart } from '../domain/localtime.ts';
import type { DeployEntry, LayoutBuilding, RaidState, ResourceAmounts } from '../domain/types.ts';
import { simulate } from '../sim/battle.ts';
import { exactFields, parseBodyId, requireObject, throwIfErrors } from './validate.ts';

const RAID_SELECT = `SELECT r.*, aa.display_name AS attacker_name, da.display_name AS defender_name,
  av.trophies AS attacker_trophies, dv.trophies AS defender_trophies
  FROM raids r
  JOIN villages av ON av.id = r.attacker_village_id JOIN accounts aa ON aa.id = av.account_id
  JOIN villages dv ON dv.id = r.defender_village_id JOIN accounts da ON da.id = dv.account_id`;

export { RAID_SELECT };

export interface RaidRow {
  id: number;
  attacker_village_id: number;
  defender_village_id: number;
  state: RaidState;
  end_reason: string | null;
  locked_at: number;
  finalize_by: number;
  seed: number;
  res_saltjack: number;
  res_peat_slinger: number;
  lootable_brine: number;
  lootable_peat: number;
  lootable_copper: number;
  final_tick: number | null;
  destruction: number | null;
  stars: number | null;
  transferred_brine: number | null;
  transferred_peat: number | null;
  transferred_copper: number | null;
  star_bonus: number | null;
  resolved_at: number | null;
  layout: LayoutBuilding[];
  deploys: DeployEntry[];
  hashes: string[] | null;
  result: Record<string, unknown> | null;
  attacker_name: string;
  defender_name: string;
}

export function mapRaidRow(row: Record<string, unknown>): RaidRow {
  return {
    id: Number(row.id),
    attacker_village_id: Number(row.attacker_village_id),
    defender_village_id: Number(row.defender_village_id),
    state: row.state as RaidState,
    end_reason: row.end_reason === null ? null : (row.end_reason as string),
    locked_at: Number(row.locked_at),
    finalize_by: Number(row.finalize_by),
    seed: Number(row.seed),
    res_saltjack: Number(row.res_saltjack),
    res_peat_slinger: Number(row.res_peat_slinger),
    lootable_brine: Number(row.lootable_brine),
    lootable_peat: Number(row.lootable_peat),
    lootable_copper: Number(row.lootable_copper),
    final_tick: row.final_tick === null ? null : Number(row.final_tick),
    destruction: row.destruction === null ? null : Number(row.destruction),
    stars: row.stars === null ? null : Number(row.stars),
    transferred_brine: row.transferred_brine === null ? null : Number(row.transferred_brine),
    transferred_peat: row.transferred_peat === null ? null : Number(row.transferred_peat),
    transferred_copper: row.transferred_copper === null ? null : Number(row.transferred_copper),
    star_bonus: row.star_bonus === null ? null : Number(row.star_bonus),
    resolved_at: row.resolved_at === null ? null : Number(row.resolved_at),
    layout: row.layout as LayoutBuilding[],
    deploys: row.deploys as DeployEntry[],
    hashes: row.hashes === null ? null : (row.hashes as string[]),
    result: row.result === null ? null : (row.result as Record<string, unknown>),
    attacker_name: row.attacker_name as string,
    defender_name: row.defender_name as string,
  };
}

export function raidJson(row: RaidRow): Record<string, unknown> {
  return {
    id: row.id,
    state: row.state,
    endReason: row.end_reason,
    attacker: { villageId: row.attacker_village_id, displayName: row.attacker_name },
    defender: { villageId: row.defender_village_id, displayName: row.defender_name },
    lockedAt: new Date(row.locked_at).toISOString(),
    finalizeBy: new Date(row.finalize_by).toISOString(),
    seed: row.seed,
    layout: row.layout,
    army: { saltjack: row.res_saltjack, peat_slinger: row.res_peat_slinger },
    lootable: { brine: row.lootable_brine, peat: row.lootable_peat, copper: row.lootable_copper },
    deploys: row.deploys,
    result: row.result,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
  };
}

function idempotencyKey(ctx: Ctx): string | undefined {
  const value = ctx.req.headers['idempotency-key'];
  return Array.isArray(value) ? value[0] : value;
}

function requireVillageId(ctx: Ctx): number {
  if (ctx.account!.villageId === null) throw errors.notFound();
  return ctx.account!.villageId;
}

async function fetchRaid(ctx: Ctx, raidId: number, opts: { attackerOnly?: boolean }): Promise<RaidRow> {
  const row = await withTransaction(async (client) => {
    await abandonExpiredRaids(client, ctx.now, { raidId });
    const result = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    return result.rows[0] ? mapRaidRow(result.rows[0]) : null;
  });
  if (!row) throw errors.notFound();
  if (opts.attackerOnly) {
    if (row.attacker_village_id !== ctx.account!.villageId) throw errors.notFound();
  } else {
    const mine = ctx.account!.villageId;
    const participant = mine !== null && (row.attacker_village_id === mine || row.defender_village_id === mine);
    if (!participant && ctx.account!.role !== 'operator') throw errors.notFound();
  }
  return row;
}

function scoutJson(villageId: number, displayName: string, trophies: number, state: IslandState): Record<string, unknown> {
  return {
    villageId,
    displayName,
    trophies,
    league: leagueFor(trophies),
    buildings: state.buildings
      .filter((b) => b.level >= 1)
      .map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level })),
    lootable: lootableOf(state.balances),
  };
}

async function readTargetState(client: PoolClient, targetVillageId: number, now: number): Promise<{ state: IslandState; displayName: string } | null> {
  const info = await client.query<{ display_name: string }>(
    'SELECT a.display_name FROM villages v JOIN accounts a ON a.id = v.account_id WHERE v.id = $1',
    [targetVillageId]
  );
  if (info.rows.length === 0) return null;
  const state = await loadIsland(client, targetVillageId, now);
  return { state, displayName: info.rows[0].display_name };
}

const CONFLICT_MESSAGES: Record<string, string> = {
  cannot_raid_self: 'That’s your own island.',
  village_shielded: 'That island is shielded.',
  already_under_attack: 'Another raider got there first.',
  target_cooldown: 'You raided this island recently.',
  raid_in_progress: 'Finish your current raid first.',
  no_army: 'Train some units first.',
  raid_not_active: 'This raid is already over.',
  raid_abandoned: 'The finalize window closed. The raid was abandoned and nothing moved.',
  nothing_deployed: 'Deploy at least one unit first.',
  units_unavailable: 'You have no more of that unit in this raid.',
};

route('GET', '/api/scout/next', 'session-verified', async (ctx) => {
  const mine = requireVillageId(ctx);
  const myClan = ctx.account!.clanId;
  const candidates = await withTransaction(async (client) => {
    await abandonExpiredRaids(client, ctx.now, {});
    const params: unknown[] = [mine];
    let clanFilter = '';
    if (myClan !== null) {
      params.push(myClan);
      clanFilter = `AND NOT EXISTS (SELECT 1 FROM clan_members m WHERE m.account_id = v.account_id AND m.clan_id = $${params.length})`;
    }
    params.push(ctx.now);
    const nowIdx = params.length;
    const rows = await client.query<{ id: string; trophies: number }>(
      `SELECT v.id, v.trophies FROM villages v
       JOIN accounts a ON a.id = v.account_id
       WHERE a.verified AND v.id <> $1 ${clanFilter}
       AND (v.shield_ends_at IS NULL OR v.shield_ends_at <= $${nowIdx})
       AND NOT EXISTS (SELECT 1 FROM raids r WHERE r.defender_village_id = v.id AND r.state IN ('locked', 'deploying'))
       AND NOT EXISTS (SELECT 1 FROM cooldowns c WHERE c.attacker_village_id = $1 AND c.defender_village_id = v.id AND c.until > $${nowIdx})
       ORDER BY ABS(v.trophies - (SELECT trophies FROM villages WHERE id = $1)) ASC, v.id ASC
       LIMIT 10`,
      params
    );
    return rows.rows.map((r) => ({ id: Number(r.id), trophies: Number(r.trophies) }));
  });
  if (candidates.length === 0) return { status: 200, body: { match: null } };
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const target = await withTransaction(async (client) => {
    const info = await readTargetState(client, chosen.id, ctx.now);
    if (!info) return null;
    return scoutJson(chosen.id, info.displayName, info.state.village.trophies, info.state);
  });
  return { status: 200, body: { match: target } };
});

route('GET', '/api/villages/:id/scout', 'session-verified', async (ctx) => {
  const targetId = pathId(ctx, 'id');
  const mine = requireVillageId(ctx);
  const result = await withTransaction(async (client) => {
    const locks = await lockVillages(client, [mine, targetId]);
    if (!locks.get(targetId)) return null;
    const info = await readTargetState(client, targetId, ctx.now);
    if (!info) return null;
    if (targetId === mine) return { conflict: 'cannot_raid_self' as const };
    if (info.state.shieldEndsAt !== null) return { conflict: 'village_shielded' as const };
    if (info.state.underAttack) return { conflict: 'already_under_attack' as const };
    const cooldown = await client.query<{ until: string }>(
      'SELECT until FROM cooldowns WHERE attacker_village_id = $1 AND defender_village_id = $2',
      [mine, targetId]
    );
    if (cooldown.rows.length > 0 && ctx.now < Number(cooldown.rows[0].until)) return { conflict: 'target_cooldown' as const };
    return { scout: scoutJson(targetId, info.displayName, info.state.village.trophies, info.state) };
  });
  if (!result) throw errors.notFound();
  if ('conflict' in result && result.conflict !== undefined) throw errors.conflict(result.conflict, CONFLICT_MESSAGES[result.conflict]);
  if ('scout' in result) return { status: 200, body: result.scout };
  throw errors.notFound();
});

route('POST', '/api/raids', 'session-verified', async (ctx): Promise<HandlerResult | undefined> => {
  const app = getApp();
  const mine = requireVillageId(ctx);
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['villageId']);
  const targetId = parseBodyId(body.villageId);
  if (targetId === null) fieldErrors.villageId = 'Use a village ID.';

  if (targetId !== null && Object.keys(fieldErrors).length === 0) {
    const exists = await withTransaction((client) => client.query('SELECT id FROM villages WHERE id = $1', [targetId]));
    if (exists.rows.length === 0) throw errors.notFound();
  }

  const key = idempotencyKey(ctx);
  return withTransaction(async (client): Promise<HandlerResult> => {
    const stored = await beginIdempotency(client, ctx.account!.id, 'POST', ctx.path, key, ctx.body);
    if (stored) return { status: stored.status, body: stored.body, headers: { 'Idempotent-Replayed': 'true' } };
    throwIfErrors(fieldErrors);

    const locks = await lockVillages(client, [mine, targetId!]);
    if (!locks.get(targetId!)) throw errors.notFound();
    const myState = await loadIsland(client, mine, ctx.now);
    const targetInfo = await readTargetState(client, targetId!, ctx.now);
    if (!targetInfo) throw errors.notFound();
    const targetState = targetInfo.state;

    if (targetId === mine) throw errors.conflict('cannot_raid_self', CONFLICT_MESSAGES.cannot_raid_self);
    if (targetState.shieldEndsAt !== null) throw errors.conflict('village_shielded', CONFLICT_MESSAGES.village_shielded);
    if (targetState.underAttack) throw errors.conflict('already_under_attack', CONFLICT_MESSAGES.already_under_attack);
    const cooldown = await client.query<{ until: string }>(
      'SELECT until FROM cooldowns WHERE attacker_village_id = $1 AND defender_village_id = $2',
      [mine, targetId!]
    );
    if (cooldown.rows.length > 0 && ctx.now < Number(cooldown.rows[0].until)) {
      throw errors.conflict('target_cooldown', CONFLICT_MESSAGES.target_cooldown);
    }
    const myActive = await client.query(
      `SELECT 1 FROM raids WHERE attacker_village_id = $1 AND state IN ('locked', 'deploying') LIMIT 1`,
      [mine]
    );
    if (myActive.rows.length > 0) throw errors.conflict('raid_in_progress', CONFLICT_MESSAGES.raid_in_progress);
    if (myState.balances.saltjack + myState.balances.peat_slinger === 0) throw errors.conflict('no_army', CONFLICT_MESSAGES.no_army);

    const layout: LayoutBuilding[] = targetState.buildings
      .filter((b) => b.level >= 1)
      .map((b, index) => ({ index, id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level, hp: buildingHp(b.type, b.level) }));
    const lootable = lootableOf(targetState.balances);
    const seed = 1 + Math.floor(Math.random() * 4294967294);
    const finalizeBy = ctx.now + app.env.raidFinalizeSeconds * 1000;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO raids (attacker_village_id, defender_village_id, state, locked_at, finalize_by, seed,
       res_saltjack, res_peat_slinger, lootable_brine, lootable_peat, lootable_copper, layout, deploys)
       VALUES ($1, $2, 'locked', $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]'::jsonb) RETURNING id`,
      [
        mine, targetId!, ctx.now, finalizeBy, seed,
        myState.balances.saltjack, myState.balances.peat_slinger,
        lootable.brine, lootable.peat, lootable.copper,
        JSON.stringify(layout),
      ]
    );
    const raidId = Number(inserted.rows[0].id);
    const row = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const json = raidJson(mapRaidRow(row.rows[0]));
    await storeResponse(client, ctx.account!.id, 'POST', ctx.path, key!, ctx.body, 201, json);
    return { status: 201, body: json };
  });
});

const DEPLOYS_MESSAGE = 'Send 1 to 50 deploys, and at most 200 in one raid.';
const TICK_MESSAGE = 'Use a tick from 0 to 1,799, never earlier than the one before.';
const RING_MESSAGE = 'Deploy on the tidal ring.';

function isRingCell(x: number, y: number): boolean {
  return x >= 0 && x <= 39 && y >= 0 && y <= 39 && (x <= 1 || x >= 38 || y <= 1 || y >= 38);
}

route('POST', '/api/raids/:id/deploys', 'session', async (ctx): Promise<HandlerResult | undefined> => {
  const raidId = pathId(ctx, 'id');
  await fetchRaid(ctx, raidId, { attackerOnly: true });

  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['deploys']);
  const deploysRaw = body.deploys;
  const entries = Array.isArray(deploysRaw) ? deploysRaw : null;
  if (entries === null || entries.length < 1 || entries.length > 50) {
    fieldErrors.deploys = DEPLOYS_MESSAGE;
    throwIfErrors(fieldErrors);
  }

  const key = idempotencyKey(ctx);
  return withTransaction(async (client): Promise<HandlerResult> => {
    const stored = await beginIdempotency(client, ctx.account!.id, 'POST', ctx.path, key, ctx.body);
    if (stored) return { status: stored.status, body: stored.body, headers: { 'Idempotent-Replayed': 'true' } };

    // per-entry validation, keyed by deploy position
    const entryErrors: Record<string, string> = {};
    const validated: { tick: number; unit: 'saltjack' | 'peat_slinger'; x: number; y: number }[] = [];
    let lastTick = -1;
    for (let i = 0; i < entries!.length; i++) {
      const entry = entries![i];
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        entryErrors[`deploys[${i}].tick`] = TICK_MESSAGE;
        continue;
      }
      const record = entry as Record<string, unknown>;
      for (const field of Object.keys(record)) {
        if (!['tick', 'unit', 'x', 'y'].includes(field)) entryErrors[`deploys[${i}].${field}`] = 'unknown field';
      }
      const tick = record.tick;
      if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0 || tick > 1799 || tick < lastTick) {
        entryErrors[`deploys[${i}].tick`] = TICK_MESSAGE;
      } else {
        lastTick = tick;
      }
      const unit = record.unit;
      if (unit !== 'saltjack' && unit !== 'peat_slinger') entryErrors[`deploys[${i}].unit`] = 'Choose Saltjack or Peat Slinger.';
      const x = record.x;
      const y = record.y;
      if (typeof x !== 'number' || !Number.isInteger(x)) entryErrors[`deploys[${i}].x`] = RING_MESSAGE;
      if (typeof y !== 'number' || !Number.isInteger(y)) entryErrors[`deploys[${i}].y`] = RING_MESSAGE;
      if (typeof x === 'number' && Number.isInteger(x) && typeof y === 'number' && Number.isInteger(y) && !isRingCell(x, y)) {
        entryErrors[`deploys[${i}].x`] = RING_MESSAGE;
        entryErrors[`deploys[${i}].y`] = RING_MESSAGE;
      }
      validated.push({ tick: typeof tick === 'number' && Number.isInteger(tick) ? tick : -1, unit: unit === 'peat_slinger' ? 'peat_slinger' : 'saltjack', x: typeof x === 'number' ? x : -1, y: typeof y === 'number' ? y : -1 });
    }
    throwIfErrors(entryErrors);

    const raidResult = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const raid = mapRaidRow(raidResult.rows[0]);
    if (raid.deploys.length + validated.length > 200) throw errors.validation({ deploys: DEPLOYS_MESSAGE });
    if (raid.state === 'resolved') throw errors.conflict('raid_not_active', CONFLICT_MESSAGES.raid_not_active);
    if (raid.state === 'abandoned') throw errors.conflict('raid_abandoned', CONFLICT_MESSAGES.raid_abandoned);
    if (validated[0].tick < (raid.deploys.length > 0 ? raid.deploys[raid.deploys.length - 1].tick : 0)) {
      throw errors.validation({ [`deploys[0].tick`]: TICK_MESSAGE });
    }

    const deployed = { saltjack: 0, peat_slinger: 0 };
    for (const d of raid.deploys) deployed[d.unit]++;
    for (const v of validated) deployed[v.unit]++;
    if (deployed.saltjack > raid.res_saltjack || deployed.peat_slinger > raid.res_peat_slinger) {
      throw errors.conflict('units_unavailable', CONFLICT_MESSAGES.units_unavailable);
    }

    const deploys = [...raid.deploys, ...validated.map((v) => ({ tick: v.tick, unit: v.unit, x: v.x, y: v.y }))];
    await client.query(`UPDATE raids SET deploys = $2, state = CASE WHEN state = 'locked' THEN 'deploying' ELSE state END WHERE id = $1`, [
      raidId,
      JSON.stringify(deploys),
    ]);
    const updated = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const json = raidJson(mapRaidRow(updated.rows[0]));
    await storeResponse(client, ctx.account!.id, 'POST', ctx.path, key!, ctx.body, 200, json);
    return { status: 200, body: json };
  });
});

route('POST', '/api/raids/:id/finalize', 'session', async (ctx): Promise<HandlerResult | undefined> => {
  const raidId = pathId(ctx, 'id');
  await fetchRaid(ctx, raidId, { attackerOnly: true });

  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const app = getApp();
  const key = idempotencyKey(ctx);
  return withTransaction(async (client): Promise<HandlerResult> => {
    const stored = await beginIdempotency(client, ctx.account!.id, 'POST', ctx.path, key, ctx.body);
    if (stored) return { status: stored.status, body: stored.body, headers: { 'Idempotent-Replayed': 'true' } };

    // Lock both islands first: the resolution commits holding both island locks.
    const raidResult = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const raid = mapRaidRow(raidResult.rows[0]);
    const locks = await lockVillages(client, [raid.attacker_village_id, raid.defender_village_id]);
    if (!locks.get(raid.attacker_village_id) || !locks.get(raid.defender_village_id)) throw errors.notFound();
    await abandonExpiredRaids(client, ctx.now, { raidId });

    const fresh = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const row = mapRaidRow(fresh.rows[0]);
    if (row.state === 'resolved') throw errors.conflict('raid_not_active', CONFLICT_MESSAGES.raid_not_active);
    if (row.state === 'abandoned') throw errors.conflict('raid_abandoned', CONFLICT_MESSAGES.raid_abandoned);
    if (row.deploys.length === 0) throw errors.conflict('nothing_deployed', CONFLICT_MESSAGES.nothing_deployed);

    const attackerState = await loadIsland(client, row.attacker_village_id, ctx.now);
    const defenderState = await loadIsland(client, row.defender_village_id, ctx.now);

    // 1. Resolution lootable amounts, from the defender's balances at this instant.
    const resLootable = lootableOf(defenderState.balances);
    // 2. The battle simulation on the stored seed, layout, deploy list and lootable amounts.
    const sim = simulate({ seed: row.seed, layout: row.layout, deploys: row.deploys, lootable: resLootable });
    const hashes = sim.ticks.map((t) => t.hash);

    // 3. Loot transfer, capped by the attacker's storage room.
    const transferred: ResourceAmounts = { brine: 0, peat: 0, copper: 0 };
    for (const resource of ['brine', 'peat', 'copper'] as const) {
      const loot = sim.loot[resource];
      const room = Math.max(0, attackerState.caps[resource] - attackerState.balances[resource]);
      const amount = Math.min(loot, room);
      if (amount > 0) {
        await islandPair(client, row.defender_village_id, row.attacker_village_id, 'raid_loot', resource, amount, ctx.now, row.id);
        transferred[resource] = amount;
        attackerState.balances[resource] += amount;
      }
    }

    // 4. Every deployed unit is debited from the attacker to the tide.
    const deployedCount = { saltjack: 0, peat_slinger: 0 };
    for (const d of row.deploys) deployedCount[d.unit]++;
    for (const unit of ['saltjack', 'peat_slinger'] as const) {
      if (deployedCount[unit] > 0) await tidePair(client, row.attacker_village_id, 'raid_deploy', unit, -deployedCount[unit], ctx.now, row.id);
    }

    // 5. Trophies.
    let trophAtt = 0;
    let trophDef = 0;
    if (sim.stars >= 1) {
      const gain = Math.floor(sim.destruction / 4);
      trophAtt = gain;
      trophDef = -Math.min(Math.floor(gain / 2), defenderState.village.trophies);
    } else {
      trophAtt = -Math.min(3, attackerState.village.trophies);
      trophDef = 3;
    }
    await client.query('UPDATE villages SET trophies = GREATEST(0, trophies + $2) WHERE id = $1', [row.attacker_village_id, trophAtt]);
    await client.query('UPDATE villages SET trophies = GREATEST(0, trophies + $2) WHERE id = $1', [row.defender_village_id, trophDef]);

    // 6. Star bonus, within the attacker's daily cap of 5 starred raids in their local day.
    const zone = ctx.account!.timeZone;
    const dayLo = dayStart(ctx.now, zone);
    const dayHi = nextDayStart(ctx.now, zone);
    const prior = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM raids
       WHERE attacker_village_id = $1 AND stars >= 1 AND resolved_at >= $2 AND resolved_at < $3`,
      [row.attacker_village_id, dayLo, dayHi]
    );
    let starBonus = 0;
    if (sim.stars >= 1 && Number(prior.rows[0].count) < 5) {
      const bonus: ResourceAmounts = { brine: 100 * sim.stars, peat: 0, copper: 0 };
      const { credited } = await creditCapped(client, row.attacker_village_id, 'star_bonus', bonus, attackerState.balances, attackerState.caps, ctx.now, row.id);
      starBonus = credited.brine;
    }

    // 7. Shield.
    if (sim.stars >= 2) {
      const until = ctx.now + app.env.shieldSeconds * 1000;
      if (defenderState.village.shield_ends_at === null || until > defenderState.village.shield_ends_at) {
        await client.query('UPDATE villages SET shield_ends_at = $2 WHERE id = $1', [row.defender_village_id, until]);
      }
    }

    // 8. Same-target cooldown.
    await client.query(
      `INSERT INTO cooldowns (attacker_village_id, defender_village_id, until) VALUES ($1, $2, $3)
       ON CONFLICT (attacker_village_id, defender_village_id) DO UPDATE SET until = EXCLUDED.until`,
      [row.attacker_village_id, row.defender_village_id, ctx.now + app.env.targetCooldownSeconds * 1000]
    );

    const result = {
      finalTick: sim.finalTick,
      destruction: sim.destruction,
      stars: sim.stars,
      lootable: resLootable,
      loot: sim.loot,
      transferred,
      trophies: { attacker: trophAtt, defender: trophDef },
      starBonus,
    };
    await client.query(
      `UPDATE raids SET state = 'resolved', end_reason = 'finalized', res_lootable_brine = $2, res_lootable_peat = $3,
       res_lootable_copper = $4, final_tick = $5, destruction = $6, stars = $7, loot_brine = $8, loot_peat = $9, loot_copper = $10,
       transferred_brine = $11, transferred_peat = $12, transferred_copper = $13, trophies_attacker = $14, trophies_defender = $15,
       star_bonus = $16, resolved_at = $17, hashes = $18, result = $19 WHERE id = $1`,
      [
        row.id, resLootable.brine, resLootable.peat, resLootable.copper,
        sim.finalTick, sim.destruction, sim.stars, sim.loot.brine, sim.loot.peat, sim.loot.copper,
        transferred.brine, transferred.peat, transferred.copper, trophAtt, trophDef, starBonus,
        ctx.now, JSON.stringify(hashes), JSON.stringify(result),
      ]
    );
    const updated = await client.query(`${RAID_SELECT} WHERE r.id = $1`, [raidId]);
    const json = raidJson(mapRaidRow(updated.rows[0]));
    await storeResponse(client, ctx.account!.id, 'POST', ctx.path, key!, ctx.body, 200, json);
    return { status: 200, body: json };
  });
});

route('GET', '/api/raids', 'session', async (ctx) => {
  const mine = requireVillageId(ctx);
  const role = ctx.query.get('role');
  if (role !== 'attack' && role !== 'defence') throw errors.validation({ role: 'Use attack or defence.' });
  const rows = await withTransaction(async (client) => {
    await abandonExpiredRaids(client, ctx.now, {});
    const column = role === 'attack' ? 'attacker_village_id' : 'defender_village_id';
    const result = await client.query(`${RAID_SELECT} WHERE r.${column} = $1 ORDER BY r.id DESC LIMIT 50`, [mine]);
    return result.rows.map((r) => {
      const row = mapRaidRow(r);
      return {
        id: row.id,
        state: row.state,
        endReason: row.end_reason,
        role,
        opponent: {
          villageId: role === 'attack' ? row.defender_village_id : row.attacker_village_id,
          displayName: role === 'attack' ? row.defender_name : row.attacker_name,
        },
        lockedAt: new Date(row.locked_at).toISOString(),
        resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
        stars: row.stars,
        destruction: row.destruction,
        transferred:
          row.transferred_brine === null
            ? null
            : { brine: row.transferred_brine, peat: row.transferred_peat, copper: row.transferred_copper },
      };
    });
  });
  return { status: 200, body: { raids: rows } };
});

route('GET', '/api/raids/:id', 'session', async (ctx) => {
  const raidId = pathId(ctx, 'id');
  const row = await fetchRaid(ctx, raidId, {});
  return { status: 200, body: raidJson(row) };
});

route('GET', '/api/raids/:id/snapshot', 'session', async (ctx) => {
  const raidId = pathId(ctx, 'id');
  const row = await fetchRaid(ctx, raidId, {});

  const tickRaw = ctx.query.get('tick');
  if (tickRaw === null || !/^-?[0-9]+$/.test(tickRaw)) {
    throw errors.validation({ tick: 'Use a tick from 0 to the raid’s final tick.' });
  }
  const tick = Number(tickRaw);
  if (row.state !== 'resolved') throw errors.conflict('raid_not_resolved', 'This raid has no replay yet.');
  const finalTick = row.final_tick!;
  if (tick < 0 || tick > finalTick) throw errors.validation({ tick: 'Use a tick from 0 to the raid’s final tick.' });

  const resLootable = row.result!.lootable as ResourceAmounts;
  const sim = simulate({ seed: row.seed, layout: row.layout, deploys: row.deploys, lootable: resLootable }, tick);
  const state = sim.ticks[tick];
  return {
    status: 200,
    body: {
      raidId: row.id,
      tick,
      finalTick,
      destruction: state.destruction,
      stars: state.stars,
      loot: state.loot,
      hash: state.hash,
      buildings: state.buildings.map((b, i) => ({ index: b.index, id: row.layout[i].id, hp: b.hp, destroyed: b.destroyed })),
      units: state.units,
    },
  };
});
