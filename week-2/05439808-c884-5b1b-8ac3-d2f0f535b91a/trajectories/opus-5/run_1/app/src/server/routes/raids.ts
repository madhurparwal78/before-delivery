import type { Queryable } from '../db.js';
import { config } from '../config.js';
import { takeIslandLocks, takeLock } from '../db.js';
import { fail, notFound } from '../http/errors.js';
import { checkFields, FieldErrors, parseBodyId, readIntegerQuery } from '../http/validate.js';
import { FIELD_MESSAGES } from '../../shared/messages.js';
import { keyedSessionRoute, sessionRoute, verifiedRoute, type Route } from '../http/route.js';
import { isOnDeployRing, LAST_DEPLOY_TICK } from '../../shared/catalog.js';
import { isUnitKey, leagueFor, UNIT_KEYS, type UnitKey } from '../../shared/types.js';
import type { SimDeploy } from '../../shared/sim.js';
import { clanIdOf, villageIdOf } from '../domain/accounts.js';
import { unitsOf } from '../domain/ledger.js';
import { loadIsland, type Island } from '../domain/village.js';
import {
  activeRaidOnIsland,
  applyLapsedRaids,
  attackerHasActiveRaid,
  createLock,
  deploysOf,
  inTargetCooldown,
  isShieldedVillage,
  layoutOf,
  loadRaid,
  lootableOf,
  raidView,
  resolveRaid,
  snapshotView,
  villagePublic,
  type RaidRow
} from '../domain/raids.js';

const MAX_DEPLOYS_PER_BATCH = 50;
const MAX_DEPLOYS_PER_RAID = 200;

async function ownVillageId(client: Queryable, accountId: number): Promise<number> {
  const villageId = await villageIdOf(client, accountId);
  if (villageId === null) notFound();
  return villageId;
}

function scoutView(island: Island, owner: { displayName: string; trophies: number }): Record<string, unknown> {
  return {
    villageId: island.villageId,
    displayName: owner.displayName,
    trophies: owner.trophies,
    league: leagueFor(owner.trophies),
    buildings: layoutOf(island).map((building) => ({
      id: building.id,
      type: building.type,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
      level: building.level
    })),
    lootable: lootableOf(island)
  };
}

async function loadParticipantRaid(
  client: Queryable,
  raidId: number,
  accountId: number,
  isOperator: boolean
): Promise<RaidRow> {
  const raid = await loadRaid(client, raidId);
  if (raid === null) notFound();
  if (isOperator) return raid;
  const villageId = await villageIdOf(client, accountId);
  if (villageId === null) notFound();
  if (raid.attackerVillageId !== villageId && raid.defenderVillageId !== villageId) notFound();
  return raid;
}

function readDeploys(
  body: Record<string, unknown>,
  lastStoredTick: number,
  storedCount: number
): SimDeploy[] {
  const errors = new FieldErrors();
  checkFields(body, ['deploys'], ['deploys'], errors);
  const raw = body.deploys;
  if (!Array.isArray(raw)) {
    errors.add('deploys', FIELD_MESSAGES.deploys);
    errors.throwIfAny();
    return [];
  }
  if (raw.length < 1 || raw.length > MAX_DEPLOYS_PER_BATCH) {
    errors.add('deploys', FIELD_MESSAGES.deploys);
  }
  if (storedCount + raw.length > MAX_DEPLOYS_PER_RAID) {
    errors.add('deploys', FIELD_MESSAGES.deploys);
  }
  const deploys: SimDeploy[] = [];
  let previousTick = lastStoredTick;
  for (const [index, entry] of raw.entries()) {
    const item =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    for (const key of Object.keys(item)) {
      if (!['tick', 'unit', 'x', 'y'].includes(key)) {
        errors.add(`deploys[${index}].${key}`, 'unknown field');
      }
    }
    const rawTick = item.tick;
    const tick =
      typeof rawTick === 'number' &&
      Number.isInteger(rawTick) &&
      rawTick >= 0 &&
      rawTick <= LAST_DEPLOY_TICK &&
      rawTick >= previousTick
        ? rawTick
        : null;
    if (tick === null) errors.add(`deploys[${index}].tick`, FIELD_MESSAGES.deployTick);
    const rawUnit = item.unit;
    const unit = typeof rawUnit === 'string' && isUnitKey(rawUnit) ? rawUnit : null;
    if (unit === null) errors.add(`deploys[${index}].unit`, FIELD_MESSAGES.unit);
    const rawX = item.x;
    const rawY = item.y;
    const x = typeof rawX === 'number' && Number.isInteger(rawX) ? rawX : null;
    const y = typeof rawY === 'number' && Number.isInteger(rawY) ? rawY : null;
    if (x === null || y === null || !isOnDeployRing(x, y)) {
      if (x === null || (y !== null && !isOnDeployRing(x, y))) {
        errors.add(`deploys[${index}].x`, FIELD_MESSAGES.deployCell);
      }
      if (y === null || (x !== null && !isOnDeployRing(x, y))) {
        errors.add(`deploys[${index}].y`, FIELD_MESSAGES.deployCell);
      }
    }
    if (tick !== null) previousTick = tick;
    if (tick !== null && unit !== null && x !== null && y !== null) {
      deploys.push({ tick, unit, x, y });
    }
  }
  errors.throwIfAny();
  return deploys;
}

export const raidRoutes: Route[] = [
  verifiedRoute('GET', '/api/scout/next', async (ctx, client) => {
    const attackerVillageId = await ownVillageId(client, ctx.account.id);
    await applyLapsedRaids(client, ctx.now);
    const clanId = await clanIdOf(client, ctx.account.id);
    const { rows } = await client.query<{ id: number }>(
      `SELECT v.id
         FROM villages v
         JOIN accounts a ON a.id = v.account_id
        WHERE a.verified = true
          AND v.id <> $1
          AND (v.shield_ends_at IS NULL OR v.shield_ends_at <= $2)
          AND ($4::bigint IS NULL OR NOT EXISTS (
                SELECT 1 FROM clan_members cm
                 WHERE cm.account_id = v.account_id AND cm.clan_id = $4))
          AND NOT EXISTS (
                SELECT 1 FROM raids r
                 WHERE r.defender_village_id = v.id AND r.state IN ('locked', 'deploying'))
          AND NOT EXISTS (
                SELECT 1 FROM raids r
                 WHERE r.attacker_village_id = $1 AND r.defender_village_id = v.id
                   AND r.state = 'resolved' AND r.resolved_at > $5)
        ORDER BY ABS(a.trophies - $3) ASC, v.id ASC
        LIMIT 10`,
      [
        attackerVillageId,
        ctx.now.toISOString(),
        ctx.account.trophies,
        clanId,
        new Date(ctx.now.getTime() - config.targetCooldownSeconds * 1000).toISOString()
      ]
    );
    if (rows.length === 0) return { status: 200, body: { match: null } };
    const picked = rows[Math.floor(Math.random() * rows.length)];
    if (!picked) return { status: 200, body: { match: null } };
    const defenderVillageId = Number(picked.id);
    await takeLock(client, 'village', defenderVillageId);
    const island = await loadIsland(client, defenderVillageId, ctx.now);
    const owner = await villagePublic(client, defenderVillageId);
    if (island === null || owner === null) return { status: 200, body: { match: null } };
    return { status: 200, body: { match: scoutView(island, owner) } };
  }),

  verifiedRoute('GET', '/api/villages/:id/scout', async (ctx, client) => {
    const attackerVillageId = await ownVillageId(client, ctx.account.id);
    const defenderVillageId = Number(ctx.params.id);
    await applyLapsedRaids(client, ctx.now);
    const owner = await villagePublic(client, defenderVillageId);
    if (owner === null) notFound();
    if (defenderVillageId === attackerVillageId) fail('cannot_raid_self');
    await takeLock(client, 'village', defenderVillageId);
    const island = await loadIsland(client, defenderVillageId, ctx.now);
    if (island === null) notFound();
    if (isShieldedVillage(island, ctx.now)) fail('village_shielded');
    if (await activeRaidOnIsland(client, defenderVillageId)) fail('already_under_attack');
    if (await inTargetCooldown(client, attackerVillageId, defenderVillageId, ctx.now)) {
      fail('target_cooldown');
    }
    return { status: 200, body: scoutView(island, owner) };
  }),

  verifiedRoute(
    'POST',
    '/api/raids',
    async (ctx, client) => {
      const attackerVillageId = await ownVillageId(client, ctx.account.id);
      const errors = new FieldErrors();
      checkFields(ctx.body, ['villageId'], ['villageId'], errors);
      const defenderVillageId = parseBodyId(ctx.body.villageId);
      if (defenderVillageId === null && ctx.body.villageId !== undefined) {
        errors.add('villageId', FIELD_MESSAGES.villageId);
      }
      errors.throwIfAny();
      if (defenderVillageId === null) notFound();
      if (defenderVillageId === attackerVillageId) fail('cannot_raid_self');

      await takeIslandLocks(client, [attackerVillageId, defenderVillageId]);
      await applyLapsedRaids(client, ctx.now);
      const defender = await loadIsland(client, defenderVillageId, ctx.now);
      if (defender === null) notFound();
      const attacker = await loadIsland(client, attackerVillageId, ctx.now);
      if (attacker === null) notFound();

      if (isShieldedVillage(defender, ctx.now)) fail('village_shielded');
      if (await activeRaidOnIsland(client, defenderVillageId)) fail('already_under_attack');
      if (await inTargetCooldown(client, attackerVillageId, defenderVillageId, ctx.now)) {
        fail('target_cooldown');
      }
      if (await attackerHasActiveRaid(client, attackerVillageId)) fail('raid_in_progress');
      const army = unitsOf(attacker.balances);
      if (UNIT_KEYS.every((unit) => army[unit] === 0)) fail('no_army');

      const raid = await createLock(client, attacker, defender, ctx.now);
      return { status: 201, body: await raidView(client, raid) };
    },
    true
  ),

  keyedSessionRoute('POST', '/api/raids/:id/deploys', async (ctx, client) => {
    const attackerVillageId = await ownVillageId(client, ctx.account.id);
    await applyLapsedRaids(client, ctx.now);
    const raid = await loadRaid(client, Number(ctx.params.id));
    if (raid === null || raid.attackerVillageId !== attackerVillageId) notFound();
    if (raid.state === 'resolved') fail('raid_not_active');
    if (raid.state === 'abandoned') fail('raid_abandoned');

    const stored = await deploysOf(client, raid.id);
    const lastTick = stored.length === 0 ? 0 : (stored[stored.length - 1]?.tick ?? 0);
    const deploys = readDeploys(ctx.body, lastTick, stored.length);

    const counts: Record<UnitKey, number> = { saltjack: 0, peat_slinger: 0 };
    for (const deploy of [...stored, ...deploys]) counts[deploy.unit] += 1;
    for (const unit of UNIT_KEYS) {
      if (counts[unit] > raid.reservedArmy[unit]) fail('units_unavailable');
    }

    for (const [index, deploy] of deploys.entries()) {
      await client.query(
        'INSERT INTO raid_deploys (raid_id, seq, tick, unit, x, y) VALUES ($1, $2, $3, $4, $5, $6)',
        [raid.id, stored.length + index, deploy.tick, deploy.unit, deploy.x, deploy.y]
      );
    }
    await client.query("UPDATE raids SET state = 'deploying' WHERE id = $1 AND state = 'locked'", [
      raid.id
    ]);
    const reloaded = await loadRaid(client, raid.id);
    if (reloaded === null) notFound();
    return { status: 200, body: await raidView(client, reloaded) };
  }),

  keyedSessionRoute('POST', '/api/raids/:id/finalize', async (ctx, client) => {
    const attackerVillageId = await ownVillageId(client, ctx.account.id);
    await applyLapsedRaids(client, ctx.now);
    const raid = await loadRaid(client, Number(ctx.params.id));
    if (raid === null || raid.attackerVillageId !== attackerVillageId) notFound();
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    if (raid.state === 'resolved') fail('raid_not_active');
    if (raid.state === 'abandoned') fail('raid_abandoned');
    const deploys = await deploysOf(client, raid.id);
    if (deploys.length === 0) fail('nothing_deployed');
    const resolved = await resolveRaid(client, raid, deploys, ctx.now);
    return { status: 200, body: await raidView(client, resolved) };
  }),

  sessionRoute('GET', '/api/raids', async (ctx, client) => {
    const errors = new FieldErrors();
    const role = ctx.query.get('role');
    if (role !== null && role !== 'attack' && role !== 'defence') {
      errors.add('role', FIELD_MESSAGES.raidRole);
    }
    errors.throwIfAny();
    const villageId = await villageIdOf(client, ctx.account.id);
    if (villageId === null) return { status: 200, body: { raids: [] } };
    await applyLapsedRaids(client, ctx.now);
    const { rows } = await client.query<{
      id: number;
      state: string;
      end_reason: string | null;
      attacker_village_id: number;
      defender_village_id: number;
      locked_at: Date;
      resolved_at: Date | null;
      stars: number | null;
      destruction: number | null;
      result: { transferred: Record<string, number> } | null;
      opponent_village_id: number;
      opponent_name: string;
    }>(
      `SELECT r.id, r.state, r.end_reason, r.attacker_village_id, r.defender_village_id,
              r.locked_at, r.resolved_at, r.stars, r.destruction, r.result,
              CASE WHEN r.attacker_village_id = $1 THEN r.defender_village_id
                   ELSE r.attacker_village_id END AS opponent_village_id,
              opponent.display_name AS opponent_name
         FROM raids r
         JOIN villages ov ON ov.id = CASE WHEN r.attacker_village_id = $1
                                          THEN r.defender_village_id
                                          ELSE r.attacker_village_id END
         JOIN accounts opponent ON opponent.id = ov.account_id
        WHERE (($2::text IS NULL OR $2 = 'attack') AND r.attacker_village_id = $1)
           OR (($2::text IS NULL OR $2 = 'defence') AND r.defender_village_id = $1)
        ORDER BY r.id DESC
        LIMIT 50`,
      [villageId, role]
    );
    return {
      status: 200,
      body: {
        raids: rows.map((row) => ({
          id: Number(row.id),
          state: row.state,
          endReason: row.end_reason,
          role: Number(row.attacker_village_id) === villageId ? 'attack' : 'defence',
          opponent: {
            villageId: Number(row.opponent_village_id),
            displayName: row.opponent_name
          },
          lockedAt: row.locked_at.toISOString(),
          resolvedAt: row.resolved_at === null ? null : row.resolved_at.toISOString(),
          stars: row.stars,
          destruction: row.destruction,
          transferred: row.result === null ? null : row.result.transferred
        }))
      }
    };
  }),

  sessionRoute('GET', '/api/raids/:id', async (ctx, client) => {
    await applyLapsedRaids(client, ctx.now);
    const raid = await loadParticipantRaid(
      client,
      Number(ctx.params.id),
      ctx.account.id,
      ctx.account.role === 'operator'
    );
    return { status: 200, body: await raidView(client, raid) };
  }),

  sessionRoute('GET', '/api/raids/:id/snapshot', async (ctx, client) => {
    await applyLapsedRaids(client, ctx.now);
    const raid = await loadParticipantRaid(
      client,
      Number(ctx.params.id),
      ctx.account.id,
      ctx.account.role === 'operator'
    );
    const raw = ctx.query.get('tick');
    const tick = readIntegerQuery(raw, { min: -1_000_000, max: 1_000_000 });
    if (raw === null || tick === null) {
      fail('validation_failed', { errors: { tick: FIELD_MESSAGES.snapshotTick } });
    }
    if (raid.state !== 'resolved' || raid.result === null) fail('raid_not_resolved');
    if (tick < 0 || tick > raid.result.finalTick) {
      fail('validation_failed', { errors: { tick: FIELD_MESSAGES.snapshotTick } });
    }
    const deploys = await deploysOf(client, raid.id);
    return { status: 200, body: snapshotView(raid, deploys, tick) };
  })
];
