// Scouting, the raid lifecycle (lock → deploying → resolved | abandoned), resolution, snapshots and
// the operator re-run. The battle itself is the shared simulation module.
import { randomInt } from 'node:crypto';
import { simulateBattle, spawnOrder, LAST_DEPLOY_TICK, type BattleFrame, type Deploy, type LayoutBuilding } from '../shared/battle';
import { BUILDINGS, isUnitKey, RESOURCES, UNIT_KEYS, zeroAmounts, type Amounts, type ArmyCounts, type EndReason, type RaidRole, type RaidState } from '../shared/catalog';
import { onTidalRing } from '../shared/grid';
import { leagueFor } from './accounts';
import { iso, now } from './clock';
import { config } from './config';
import { tx, type Db } from './db';
import { fail } from './errors';
import { idempotent } from './idempotency';
import { parseId, sessionRoute, type Account } from './http';
import { army, creditCapped, isShielded, lockIsland, lockIslands, lootable, move, room, type Island } from './island';
import { Fields, isInteger, MESSAGES, REQUIRED, rejectField, UNKNOWN } from './validate';
import { localDay } from './zones';

const MAX_BATCH = 50;
const MAX_DEPLOYS = 200;
const STAR_BONUS_PER_STAR = 100;
export const STAR_BONUS_CAP = 5;

interface RaidResult {
  finalTick: number;
  destruction: number;
  stars: number;
  lootable: Amounts;
  loot: Amounts;
  transferred: Amounts;
  trophies: { attacker: number; defender: number };
  starBonus: number;
}

interface RaidRow {
  id: number;
  attacker_village_id: number;
  defender_village_id: number;
  state: RaidState;
  end_reason: EndReason | null;
  locked_at: number;
  finalize_by: number;
  seed: number;
  layout: LayoutBuilding[];
  army: ArmyCounts;
  lootable: Amounts;
  deploys: Deploy[];
  result: RaidResult | null;
  tick_hashes: string[] | null;
  resolved_at: number | null;
}

/** Abandons every raid whose finalize deadline has passed; runs before any raid or island read. */
export async function abandonOverdueRaids(db: Db, at: number): Promise<void> {
  await db.query(
    "UPDATE raids SET state = 'abandoned', end_reason = 'deadline_passed' WHERE state IN ('locked', 'deploying') AND finalize_by <= $1",
    [at],
  );
}

export async function underAttack(db: Db, villageId: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM raids WHERE defender_village_id = $1 AND state IN ('locked', 'deploying')", [villageId]);
  return (rowCount ?? 0) > 0;
}

async function attackingNow(db: Db, villageId: number): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM raids WHERE attacker_village_id = $1 AND state IN ('locked', 'deploying')", [villageId]);
  return (rowCount ?? 0) > 0;
}

/** True while the attacker's same-target cooldown runs: strictly before resolvedAt + the cooldown lifetime. */
async function inCooldown(db: Db, attackerVillage: number, defenderVillage: number, at: number): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM raids WHERE attacker_village_id = $1 AND defender_village_id = $2 AND state = 'resolved' AND $3 < resolved_at + $4",
    [attackerVillage, defenderVillage, at, config.cooldownMs],
  );
  return (rowCount ?? 0) > 0;
}

/** The scouting conflicts, in the published order. */
async function checkEligible(db: Db, attackerVillage: number, target: Island, at: number): Promise<void> {
  if (isShielded(target, at)) fail('village_shielded');
  if (await underAttack(db, target.villageId)) fail('already_under_attack');
  if (await inCooldown(db, attackerVillage, target.villageId, at)) fail('target_cooldown');
}

async function villageOwner(db: Db, villageId: number): Promise<{ accountId: number; displayName: string; trophies: number; timeZone: string } | null> {
  const { rows } = await db.query<{ account_id: number; display_name: string; trophies: number; time_zone: string }>(
    'SELECT v.account_id, a.display_name, a.trophies, a.time_zone FROM villages v JOIN accounts a ON a.id = v.account_id WHERE v.id = $1',
    [villageId],
  );
  const row = rows[0];
  return row ? { accountId: row.account_id, displayName: row.display_name, trophies: row.trophies, timeZone: row.time_zone } : null;
}

async function ownVillageId(db: Db, account: Account): Promise<number> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM villages WHERE account_id = $1', [account.id]);
  return rows[0]?.id ?? fail('not_found');
}

async function scoutView(db: Db, island: Island): Promise<Record<string, unknown>> {
  const owner = (await villageOwner(db, island.villageId)) as { displayName: string; trophies: number };
  return {
    villageId: island.villageId,
    displayName: owner.displayName,
    trophies: owner.trophies,
    league: leagueFor(owner.trophies),
    buildings: island.buildings.map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level })),
    lootable: lootable(island),
  };
}

function requireVerified(account: Account): void {
  if (!account.verified) fail('email_not_verified');
}

sessionRoute('GET', '/api/scout/next', async (ctx) => {
  requireVerified(ctx.account);
  const match = await tx(async (db) => {
    const at = now();
    await abandonOverdueRaids(db, at);
    const mine = await ownVillageId(db, ctx.account);
    const { rows } = await db.query<{ id: number }>(
      `SELECT v.id FROM villages v JOIN accounts a ON a.id = v.account_id
        WHERE a.verified AND v.account_id <> $1
          AND NOT EXISTS (SELECT 1 FROM clan_members m1 JOIN clan_members m2 ON m2.clan_id = m1.clan_id
                           WHERE m1.account_id = $1 AND m2.account_id = v.account_id)
          AND NOT (v.shield_start IS NOT NULL AND $3 >= v.shield_start AND $3 < v.shield_end)
          AND NOT EXISTS (SELECT 1 FROM raids r WHERE r.defender_village_id = v.id AND r.state IN ('locked', 'deploying'))
          AND NOT EXISTS (SELECT 1 FROM raids r WHERE r.attacker_village_id = $2 AND r.defender_village_id = v.id
                           AND r.state = 'resolved' AND $3 < r.resolved_at + $4)
        ORDER BY abs(a.trophies - (SELECT trophies FROM accounts WHERE id = $1)), v.id
        LIMIT 10`,
      [ctx.account.id, mine, at, config.cooldownMs],
    );
    if (rows.length === 0) return null;
    const pick = (rows[randomInt(rows.length)] as { id: number }).id;
    return scoutView(db, await lockIsland(db, pick, at));
  });
  return { status: 200, body: { match } };
});

sessionRoute('GET', '/api/villages/:id/scout', async (ctx) => {
  const body = await tx(async (db) => {
    const target = ctx.params.id as number;
    if ((await villageOwner(db, target)) === null) fail('not_found');
    requireVerified(ctx.account);
    const at = now();
    await abandonOverdueRaids(db, at);
    const mine = await ownVillageId(db, ctx.account);
    if (mine === target) fail('cannot_raid_self');
    const island = await lockIsland(db, target, at);
    await checkEligible(db, mine, island, at);
    return scoutView(db, island);
  });
  return { status: 200, body };
});

async function raidView(db: Db, raid: RaidRow): Promise<Record<string, unknown>> {
  const attacker = (await villageOwner(db, raid.attacker_village_id)) as { displayName: string };
  const defender = (await villageOwner(db, raid.defender_village_id)) as { displayName: string };
  return {
    id: raid.id,
    state: raid.state,
    endReason: raid.end_reason,
    attacker: { villageId: raid.attacker_village_id, displayName: attacker.displayName },
    defender: { villageId: raid.defender_village_id, displayName: defender.displayName },
    lockedAt: iso(raid.locked_at),
    finalizeBy: iso(raid.finalize_by),
    seed: raid.seed,
    layout: raid.layout,
    army: raid.army,
    lootable: raid.lootable,
    deploys: raid.deploys,
    result: raid.result,
    resolvedAt: raid.resolved_at === null ? null : iso(raid.resolved_at),
  };
}

async function loadRaid(db: Db, id: number, lock: boolean): Promise<RaidRow | null> {
  const { rows } = await db.query<RaidRow>(`SELECT * FROM raids WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

/** The raid if the caller attacked or defended it (or is the operator); otherwise not_found. */
async function visibleRaid(db: Db, account: Account, id: number, lock: boolean): Promise<RaidRow> {
  const raid = await loadRaid(db, id, lock);
  if (!raid) return fail('not_found');
  if (account.role === 'operator') return raid;
  const mine = (await db.query<{ id: number }>('SELECT id FROM villages WHERE account_id = $1', [account.id])).rows[0]?.id;
  if (mine !== raid.attacker_village_id && mine !== raid.defender_village_id) fail('not_found');
  return raid;
}

/** The raid if the caller is its attacker; for anyone else it does not exist. */
async function attackerRaid(db: Db, account: Account, id: number, lock: boolean): Promise<RaidRow> {
  const raid = await loadRaid(db, id, lock);
  const mine = (await db.query<{ id: number }>('SELECT id FROM villages WHERE account_id = $1', [account.id])).rows[0]?.id;
  if (!raid || mine !== raid.attacker_village_id) return fail('not_found');
  return raid;
}

sessionRoute('POST', '/api/raids', async (ctx) =>
  idempotent(ctx, async () => requireVerified(ctx.account), async (db) => {
    const f = new Fields(ctx.body, ['villageId']);
    const target = f.take('villageId', (v): v is number | string => parseId(v) !== null, MESSAGES.villageId);
    f.done();
    const targetId = parseId(target) as number;
    if ((await villageOwner(db, targetId)) === null) fail('not_found');
    const at = now();
    await abandonOverdueRaids(db, at);
    const mine = await ownVillageId(db, ctx.account);
    if (mine === targetId) fail('cannot_raid_self');
    const [attacker, defender] = await lockIslands(db, mine, targetId, at);
    await checkEligible(db, mine, defender, at);
    if (await attackingNow(db, mine)) fail('raid_in_progress');
    const reserved = army(attacker);
    if (UNIT_KEYS.every((u) => reserved[u] === 0)) fail('no_army');
    const layout: LayoutBuilding[] = defender.buildings
      .filter((b) => b.level >= 1)
      .map((b, index) => ({ index, id: b.id, type: b.type, x: b.x, y: b.y, rotation: b.rotation, level: b.level, hp: BUILDINGS[b.type].hp[b.level - 1] as number }));
    const { rows } = await db.query<RaidRow>(
      `INSERT INTO raids (attacker_village_id, defender_village_id, state, locked_at, finalize_by, seed, layout, army, lootable)
       VALUES ($1, $2, 'locked', $3, $4, $5, $6, $7, $8) RETURNING *`,
      [mine, targetId, at, at + config.finalizeMs, randomInt(1, 4294967296), JSON.stringify(layout), JSON.stringify(reserved), JSON.stringify(lootable(defender))],
    );
    return { status: 201, body: await raidView(db, rows[0] as RaidRow) };
  }));

function readDeploys(body: unknown, stored: readonly Deploy[]): Deploy[] {
  const f = new Fields(body, ['deploys']);
  const list = f.take('deploys', (v): v is unknown[] => Array.isArray(v) && v.length >= 1 && v.length <= MAX_BATCH, MESSAGES.deploys);
  f.done();
  const entries = list as unknown[];
  if (stored.length + entries.length > MAX_DEPLOYS) rejectField('deploys', MESSAGES.deploys);
  const errors: Record<string, string> = {};
  const out: Deploy[] = [];
  let previous = stored.length > 0 ? (stored[stored.length - 1] as Deploy).tick : 0;
  entries.forEach((entry, i) => {
    const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const key = (name: string): string => `deploys[${i}].${name}`;
    for (const name of Object.keys(item)) if (!['tick', 'unit', 'x', 'y'].includes(name)) errors[key(name)] = UNKNOWN;
    for (const name of ['tick', 'unit', 'x', 'y']) if (!(name in item)) errors[key(name)] = REQUIRED;
    const { tick, unit, x, y } = item;
    if ('tick' in item && (!isInteger(tick) || tick < 0 || tick > LAST_DEPLOY_TICK || tick < previous)) errors[key('tick')] = MESSAGES.deployTick;
    if ('unit' in item && !isUnitKey(unit)) errors[key('unit')] = MESSAGES.unit;
    const cellOk = isInteger(x) && isInteger(y) && onTidalRing(x, y);
    if ('x' in item && !cellOk) errors[key('x')] = MESSAGES.deployCell;
    if ('y' in item && !cellOk) errors[key('y')] = MESSAGES.deployCell;
    if (isInteger(tick) && tick >= previous) previous = tick;
    out.push({ tick: tick as number, unit: unit as Deploy['unit'], x: x as number, y: y as number });
  });
  if (Object.keys(errors).length > 0) fail('validation_failed', { errors });
  return out;
}

function closedRaid(raid: RaidRow): void {
  if (raid.state === 'resolved') fail('raid_not_active');
  if (raid.state === 'abandoned') fail('raid_abandoned');
}

sessionRoute('POST', '/api/raids/:id/deploys', async (ctx) => {
  const id = ctx.params.id as number;
  return idempotent(ctx, async (db) => void (await attackerRaid(db, ctx.account, id, false)), async (db) => {
    await abandonOverdueRaids(db, now());
    const raid = await attackerRaid(db, ctx.account, id, true);
    const fresh = readDeploys(ctx.body, raid.deploys);
    closedRaid(raid);
    const all = [...raid.deploys, ...fresh];
    for (const unit of UNIT_KEYS) {
      if (all.filter((d) => d.unit === unit).length > raid.army[unit]) fail('units_unavailable');
    }
    const { rows } = await db.query<RaidRow>(
      "UPDATE raids SET deploys = $2, state = 'deploying' WHERE id = $1 RETURNING *",
      [raid.id, JSON.stringify(all)],
    );
    return { status: 200, body: await raidView(db, rows[0] as RaidRow) };
  });
});

/** Trophies: stars gain floor(destruction ÷ 4) and cost the defender half that; zero stars swap 3. */
function trophyChange(stars: number, destruction: number): { attacker: number; defender: number } {
  if (stars === 0) return { attacker: -3, defender: 3 };
  const gain = Math.floor(destruction / 4);
  return { attacker: gain, defender: -Math.floor(gain / 2) };
}

async function applyTrophies(db: Db, accountId: number, change: number): Promise<number> {
  const { rows } = await db.query<{ trophies: number }>('SELECT trophies FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  const before = (rows[0] as { trophies: number }).trophies;
  const after = Math.max(0, before + change);
  await db.query('UPDATE accounts SET trophies = $2 WHERE id = $1', [accountId, after]);
  return after - before;
}

function battleOf(raid: RaidRow, lootableAtResolution: Amounts): BattleFrame[] {
  return simulateBattle({ seed: raid.seed, layout: raid.layout, deploys: raid.deploys, lootable: lootableAtResolution });
}

/** Resolution, in one transaction holding both islands' locks, at the instant it commits. */
async function resolve(db: Db, raid: RaidRow): Promise<RaidRow> {
  const at = now();
  const [attacker, defender] = await lockIslands(db, raid.attacker_village_id, raid.defender_village_id, at);
  const resolutionLootable = lootable(defender);
  const frames = battleOf(raid, resolutionLootable);
  const final = frames[frames.length - 1] as BattleFrame;

  const transferred = zeroAmounts();
  const space = room(attacker);
  for (const r of RESOURCES) {
    transferred[r] = Math.max(0, Math.min(final.loot[r], space[r]));
    await move(db, defender, { kind: 'raid_loot', asset: r, amount: -transferred[r], other: attacker, raidId: raid.id, at });
  }
  for (const unit of UNIT_KEYS) {
    const used = raid.deploys.filter((d) => d.unit === unit).length;
    await move(db, attacker, { kind: 'raid_deploy', asset: unit, amount: -used, raidId: raid.id, at });
  }

  const change = trophyChange(final.stars, final.destruction);
  const trophies = {
    attacker: await applyTrophies(db, attacker.accountId, change.attacker),
    defender: await applyTrophies(db, defender.accountId, change.defender),
  };

  let starBonus = 0;
  if (final.stars > 0) {
    const owner = (await villageOwner(db, attacker.villageId)) as { timeZone: string };
    if ((await starredRaidsToday(db, attacker.villageId, owner.timeZone, at)) < STAR_BONUS_CAP) {
      const bonus = zeroAmounts();
      bonus.brine = STAR_BONUS_PER_STAR * final.stars;
      starBonus = (await creditCapped(db, attacker, bonus, 'star_bonus', at, raid.id)).credited.brine;
    }
  }

  if (final.stars >= 2) {
    const ends = at + config.shieldMs;
    if (defender.shieldEnd === null || ends > defender.shieldEnd) {
      await db.query('UPDATE villages SET shield_start = $2, shield_end = $3 WHERE id = $1', [defender.villageId, at, ends]);
    }
  }

  const result: RaidResult = {
    finalTick: final.tick, destruction: final.destruction, stars: final.stars, lootable: resolutionLootable,
    loot: final.loot, transferred, trophies, starBonus,
  };
  const { rows } = await db.query<RaidRow>(
    `UPDATE raids SET state = 'resolved', end_reason = 'finalized', result = $2, tick_hashes = $3, resolved_at = $4
      WHERE id = $1 RETURNING *`,
    [raid.id, JSON.stringify(result), JSON.stringify(frames.map((f) => f.hash)), at],
  );
  return rows[0] as RaidRow;
}

/** Starred raids the attacker resolved within the local day containing `at`. */
export async function starredRaidsToday(db: Db, attackerVillage: number, zone: string, at: number): Promise<number> {
  const day = localDay(at, zone);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::bigint AS n FROM raids WHERE attacker_village_id = $1 AND state = 'resolved'
        AND (result->>'stars')::int > 0 AND resolved_at >= $2 AND resolved_at < $3`,
    [attackerVillage, day.start, day.end],
  );
  return (rows[0] as { n: number }).n;
}

sessionRoute('POST', '/api/raids/:id/finalize', async (ctx) => {
  const id = ctx.params.id as number;
  return idempotent(
    ctx,
    async (db) => {
      // Locked on receipt, so a read arriving while this finalize resolves waits for the resolved raid.
      await attackerRaid(db, ctx.account, id, true);
      await abandonOverdueRaids(db, ctx.receivedAt);
    },
    async (db) => {
      new Fields(ctx.body, []).done();
      const raid = await attackerRaid(db, ctx.account, id, true);
      closedRaid(raid);
      if (raid.deploys.length === 0) fail('nothing_deployed');
      return { status: 200, body: await raidView(db, await resolve(db, raid)) };
    },
  );
});

sessionRoute('GET', '/api/raids', async (ctx) => {
  const role = ctx.query.get('role');
  if (role === null) rejectField('role', REQUIRED);
  if (role !== 'attack' && role !== 'defence') rejectField('role', MESSAGES.raidRole);
  const raids = await tx(async (db) => {
    await abandonOverdueRaids(db, now());
    const mine = (await db.query<{ id: number }>('SELECT id FROM villages WHERE account_id = $1', [ctx.account.id])).rows[0]?.id ?? null;
    return raidList(db, mine, role as RaidRole);
  });
  return { status: 200, body: { raids } };
});

export async function raidList(db: Db, villageId: number | null, role: RaidRole): Promise<Record<string, unknown>[]> {
  if (villageId === null) return [];
  const column = role === 'attack' ? 'attacker_village_id' : 'defender_village_id';
  const other = role === 'attack' ? 'defender_village_id' : 'attacker_village_id';
  const { rows } = await db.query<RaidRow & { opponent_village: number; opponent_name: string }>(
    `SELECT r.*, r.${other} AS opponent_village, a.display_name AS opponent_name
       FROM raids r JOIN villages v ON v.id = r.${other} JOIN accounts a ON a.id = v.account_id
      WHERE r.${column} = $1 ORDER BY r.id DESC LIMIT 50`,
    [villageId],
  );
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    endReason: r.end_reason,
    role,
    opponent: { villageId: r.opponent_village, displayName: r.opponent_name },
    lockedAt: iso(r.locked_at),
    resolvedAt: r.resolved_at === null ? null : iso(r.resolved_at),
    stars: r.result?.stars ?? null,
    destruction: r.result?.destruction ?? null,
    transferred: r.result?.transferred ?? null,
  }));
}

sessionRoute('GET', '/api/raids/:id', async (ctx) => {
  const body = await tx(async (db) => {
    await abandonOverdueRaids(db, now());
    // Locked, so a read that arrives during a resolution sees the whole resolved raid.
    return raidView(db, await visibleRaid(db, ctx.account, ctx.params.id as number, true));
  });
  return { status: 200, body };
});

sessionRoute('GET', '/api/raids/:id/snapshot', async (ctx) => {
  const body = await tx(async (db) => {
    await abandonOverdueRaids(db, now());
    const raid = await visibleRaid(db, ctx.account, ctx.params.id as number, false);
    const raw = ctx.query.get('tick');
    if (raw === null) rejectField('tick', REQUIRED);
    if (!/^[0-9]+$/.test(raw as string)) rejectField('tick', MESSAGES.snapshotTick);
    if (raid.state !== 'resolved') fail('raid_not_resolved');
    const result = raid.result as RaidResult;
    const tick = Number(raw);
    if (tick > result.finalTick) rejectField('tick', MESSAGES.snapshotTick);
    return snapshot(raid, battleOf(raid, result.lootable), tick);
  });
  return { status: 200, body };
});

function snapshot(raid: RaidRow, frames: BattleFrame[], tick: number): Record<string, unknown> {
  const frame = frames[tick] as BattleFrame;
  const kinds = spawnOrder(raid.deploys);
  return {
    raidId: raid.id,
    tick,
    finalTick: frames.length - 1,
    destruction: frame.destruction,
    stars: frame.stars,
    loot: frame.loot,
    hash: frame.hash,
    buildings: raid.layout.map((b, i) => ({ index: b.index, id: b.id, hp: frame.buildingHp[i], destroyed: frame.buildingHp[i] === 0 })),
    units: frame.unitHp.map((hp, i) => ({ index: i, unit: kinds[i], x: frame.unitX[i], y: frame.unitY[i], hp, alive: hp > 0 })),
  };
}

sessionRoute('POST', '/api/ops/raids/:id/rerun', async (ctx) => {
  const body = await tx(async (db) => {
    const raid = await loadRaid(db, ctx.params.id as number, false);
    if (!raid) return fail('not_found');
    new Fields(ctx.body, []).done();
    if (raid.state !== 'resolved') fail('raid_not_resolved');
    const result = raid.result as RaidResult;
    const frames = battleOf(raid, result.lootable);
    const stored = raid.tick_hashes ?? [];
    const length = Math.max(frames.length, stored.length);
    let firstMismatchTick: number | null = null;
    for (let t = 0; t < length; t += 1) {
      if (frames[t]?.hash !== stored[t]) {
        firstMismatchTick = t;
        break;
      }
    }
    const final = frames[frames.length - 1] as BattleFrame;
    return {
      raidId: raid.id,
      seed: raid.seed,
      finalTick: final.tick,
      match: firstMismatchTick === null,
      firstMismatchTick,
      result: { finalTick: final.tick, destruction: final.destruction, stars: final.stars, loot: final.loot },
    };
  });
  return { status: 200, body };
}, { operator: true });

