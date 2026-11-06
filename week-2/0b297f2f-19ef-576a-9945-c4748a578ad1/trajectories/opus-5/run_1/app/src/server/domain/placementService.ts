import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { fieldMessages } from '../../shared/copy';
import type { Placement, Staff, UndoWindow, Wall } from '../../shared/types';
import { withTransaction } from '../db/pool';
import { openHours } from '../db/seed';
import { errors } from '../http/errors';
import { writeEvent } from './events';
import { checkHangRules, type Neighbour } from './hangRules';
import { computeLuxStatus, computePlannedLuxHours } from './lux';
import {
  getPlacementById,
  listWallNeighbours,
  rowToPlacement,
  rowToWall,
  placementSelect,
} from './repository';
import { assertMayMove, assertRole, assertTransition } from './transitions';

export const UNDO_WINDOW_SECONDS = 10;

interface PlacementWrite {
  wallId: string;
  offsetMm: number;
  centreHeightMm: number;
  heightOverride: boolean;
}

async function loadWall(client: PoolClient, wallId: string): Promise<Wall | null> {
  const row = (
    await client.query(
      'select id, name, length_mm, height_mm, planned_lux from walls where id = $1',
      [wallId],
    )
  ).rows[0];
  return row ? rowToWall(row) : null;
}

function requireString(value: unknown, field: string, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw errors.validationFailed({ [field]: message });
  }
  return value;
}

function requireWholeMm(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) {
    throw errors.validationFailed({ [field]: fieldMessages.millimetres });
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw errors.validationFailed({ [field]: 'Send true or false.' });
  }
  return value;
}

async function checkPlacementAgainstRules(
  client: PoolClient,
  write: PlacementWrite,
  object: { widthMm: number; heightMm: number; luxLimit: number },
  excludePlacementId: string | null,
): Promise<Wall> {
  const wall = await loadWall(client, write.wallId);
  if (!wall) throw errors.notFound();
  const neighbours: Neighbour[] = await listWallNeighbours(
    client,
    write.wallId,
    excludePlacementId,
  );
  const rejection = checkHangRules(
    {
      offsetMm: write.offsetMm,
      centreHeightMm: write.centreHeightMm,
      widthMm: object.widthMm,
      heightMm: object.heightMm,
      heightOverride: write.heightOverride,
      luxLimit: object.luxLimit,
    },
    wall,
    neighbours,
  );
  if (rejection) throw errors.placementRejected(rejection.reason, rejection.message);
  return wall;
}

function luxFieldsFor(
  wall: Wall,
  object: { luxLimit: number; luxHourBudget: number },
): { plannedLux: number; plannedLuxHours: number; luxStatus: 'within' | 'over' } {
  const plannedLux = wall.plannedLux;
  const plannedLuxHours = computePlannedLuxHours(plannedLux, openHours);
  return {
    plannedLux,
    plannedLuxHours,
    luxStatus: computeLuxStatus({
      plannedLux,
      plannedLuxHours,
      luxLimit: object.luxLimit,
      luxHourBudget: object.luxHourBudget,
    }),
  };
}

async function reloadPlacement(client: PoolClient, id: string): Promise<Placement> {
  const placement = await getPlacementById(client, id);
  if (!placement) throw errors.notFound();
  return placement;
}

async function recordUndo(
  client: PoolClient,
  kind: 'remove' | 'move',
  staffId: string,
  placement: Placement,
  previous: PlacementWrite,
): Promise<UndoWindow> {
  const actionId = randomUUID();
  const row = (
    await client.query(
      `insert into undo_actions (id, kind, staff_id, placement_id, undo_until, version_after, previous)
       values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6, $7::jsonb)
       returning undo_until, extract(epoch from (undo_until - now())) * 1000 as remaining_ms`,
      [
        actionId,
        kind,
        staffId,
        placement.id,
        String(UNDO_WINDOW_SECONDS),
        placement.version,
        JSON.stringify(previous),
      ],
    )
  ).rows[0] as { undo_until: Date; remaining_ms: string };
  return {
    actionId,
    kind,
    undoUntil: new Date(row.undo_until).toISOString(),
    remainingMs: Math.max(0, Math.round(Number(row.remaining_ms))),
  };
}

export interface PlaceInput {
  objectId: unknown;
  wallId: unknown;
  offsetMm: unknown;
  centreHeightMm: unknown;
  heightOverride: unknown;
}

export async function placeWork(
  staff: Staff,
  input: PlaceInput,
): Promise<{ placement: Placement; seq: number }> {
  const objectId = requireString(input.objectId, 'objectId', 'Choose an object.');
  const wallId = requireString(input.wallId, 'wallId', 'Choose a wall.');
  return withTransaction(async (client) => {
    const objectRow = (
      await client.query(
        `select id, title, width_mm, height_mm, lux_limit, lux_hour_budget
         from loan_objects where id = $1`,
        [objectId],
      )
    ).rows[0];
    if (!objectRow) throw errors.notFound();
    const wallExists = await loadWall(client, wallId);
    if (!wallExists) throw errors.notFound();
    assertRole(staff, 'curator');

    const existing = (
      await client.query(
        `select id from placements where object_id = $1 and status <> 'removed'`,
        [objectId],
      )
    ).rows[0];
    if (existing) {
      throw errors.conflict('already_placed', 'That work is already on a wall.');
    }

    const write: PlacementWrite = {
      wallId,
      offsetMm: requireWholeMm(input.offsetMm, 'offsetMm'),
      centreHeightMm: requireWholeMm(input.centreHeightMm, 'centreHeightMm'),
      heightOverride: requireBoolean(input.heightOverride, 'heightOverride'),
    };
    const object = {
      widthMm: Number(objectRow['width_mm']),
      heightMm: Number(objectRow['height_mm']),
      luxLimit: Number(objectRow['lux_limit']),
      luxHourBudget: Number(objectRow['lux_hour_budget']),
    };
    const wall = await checkPlacementAgainstRules(client, write, object, null);
    const lux = luxFieldsFor(wall, object);

    const id = `pl-${randomUUID()}`;
    await client.query(
      `insert into placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override,
         status, claimed_by, planned_lux, planned_lux_hours, lux_status, version)
       values ($1, $2, $3, $4, $5, $6, 'proposed', null, $7, $8, $9, 1)`,
      [
        id,
        objectId,
        write.wallId,
        write.offsetMm,
        write.centreHeightMm,
        write.heightOverride,
        lux.plannedLux,
        lux.plannedLuxHours,
        lux.luxStatus,
      ],
    );
    const placement = await reloadPlacement(client, id);
    const seq = await writeEvent(client, {
      kind: 'placement.placed',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
    });
    return { placement, seq };
  });
}

export interface MoveInput {
  version: unknown;
  offsetMm?: unknown;
  centreHeightMm?: unknown;
  heightOverride?: unknown;
  wallId?: unknown;
}

export async function movePlacement(
  staff: Staff,
  id: string,
  input: MoveInput,
): Promise<{ placement: Placement; undo: UndoWindow; seq: number }> {
  return withTransaction(async (client) => {
    const current = await getPlacementById(client, id, true);
    if (!current) throw errors.notFound();
    const requestedWallId = typeof input.wallId === 'string' ? input.wallId : undefined;
    assertMayMove(staff, current, requestedWallId);

    if (typeof input.version !== 'number' || !Number.isInteger(input.version)) {
      throw errors.validationFailed({ version: 'Send the placement version you are editing.' });
    }
    if (input.version !== current.version) throw errors.staleVersion(current);

    const write: PlacementWrite = {
      wallId: requestedWallId ?? current.wallId,
      offsetMm:
        input.offsetMm === undefined
          ? current.offsetMm
          : requireWholeMm(input.offsetMm, 'offsetMm'),
      centreHeightMm:
        input.centreHeightMm === undefined
          ? current.centreHeightMm
          : requireWholeMm(input.centreHeightMm, 'centreHeightMm'),
      heightOverride:
        input.heightOverride === undefined
          ? current.heightOverride
          : requireBoolean(input.heightOverride, 'heightOverride'),
    };
    const object = {
      widthMm: current.widthMm,
      heightMm: current.heightMm,
      luxLimit: current.luxLimit,
      luxHourBudget: current.luxHourBudget,
    };
    const wall = await checkPlacementAgainstRules(client, write, object, current.id);
    const lux = luxFieldsFor(wall, object);

    await client.query(
      `update placements set wall_id = $2, offset_mm = $3, centre_height_mm = $4,
         height_override = $5, planned_lux = $6, planned_lux_hours = $7, lux_status = $8,
         version = version + 1
       where id = $1`,
      [
        current.id,
        write.wallId,
        write.offsetMm,
        write.centreHeightMm,
        write.heightOverride,
        lux.plannedLux,
        lux.plannedLuxHours,
        lux.luxStatus,
      ],
    );
    const placement = await reloadPlacement(client, current.id);
    const undo = await recordUndo(client, 'move', staff.id, placement, {
      wallId: current.wallId,
      offsetMm: current.offsetMm,
      centreHeightMm: current.centreHeightMm,
      heightOverride: current.heightOverride,
    });
    const seq = await writeEvent(client, {
      kind: 'placement.moved',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
      offsetMm: placement.offsetMm,
    });
    return { placement, undo, seq };
  });
}

export async function removePlacement(
  staff: Staff,
  id: string,
): Promise<{ placement: Placement; undo: UndoWindow; seq: number }> {
  return withTransaction(async (client) => {
    const current = await getPlacementById(client, id, true);
    if (!current) throw errors.notFound();
    assertRole(staff, 'curator');
    assertTransition(current.status, 'removed');

    await client.query(
      `update placements set status = 'removed', claimed_by = null, version = version + 1
       where id = $1`,
      [current.id],
    );
    const placement = await reloadPlacement(client, current.id);
    const undo = await recordUndo(client, 'remove', staff.id, placement, {
      wallId: current.wallId,
      offsetMm: current.offsetMm,
      centreHeightMm: current.centreHeightMm,
      heightOverride: current.heightOverride,
    });
    const seq = await writeEvent(client, {
      kind: 'placement.removed',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
    });
    return { placement, undo, seq };
  });
}

export async function undoAction(
  staff: Staff,
  actionId: string,
): Promise<{ placement: Placement; seq: number }> {
  return withTransaction(async (client) => {
    const row = (
      await client.query(
        `select id, kind, staff_id, placement_id, undone, version_after, previous,
                (now() >= undo_until) as expired
         from undo_actions where id = $1 for update`,
        [actionId],
      )
    ).rows[0] as
      | {
          kind: 'remove' | 'move';
          staff_id: string;
          placement_id: string;
          undone: boolean;
          version_after: number;
          previous: PlacementWrite;
          expired: boolean;
        }
      | undefined;
    if (!row) throw errors.notFound();
    if (row.staff_id !== staff.id) throw errors.forbidden();
    if (row.undone) {
      throw errors.conflict('already_undone', 'That action has already been undone.');
    }
    if (row.expired) throw errors.undoExpired();

    const current = await getPlacementById(client, row.placement_id, true);
    if (!current) throw errors.notFound();
    if (current.version !== row.version_after) {
      throw errors.conflict('undo_conflict', 'That work has changed since.');
    }
    if (row.kind === 'remove') {
      const other = (
        await client.query(
          `select id from placements where object_id = $1 and status <> 'removed' and id <> $2`,
          [current.objectId, current.id],
        )
      ).rows[0];
      if (other) throw errors.conflict('undo_conflict', 'That work has changed since.');
    }

    const write = row.previous;
    const object = {
      widthMm: current.widthMm,
      heightMm: current.heightMm,
      luxLimit: current.luxLimit,
      luxHourBudget: current.luxHourBudget,
    };
    const wall = await checkPlacementAgainstRules(client, write, object, current.id);
    const lux = luxFieldsFor(wall, object);
    const status = row.kind === 'remove' ? 'proposed' : current.status;

    await client.query(
      `update placements set wall_id = $2, offset_mm = $3, centre_height_mm = $4,
         height_override = $5, planned_lux = $6, planned_lux_hours = $7, lux_status = $8,
         status = $9, version = version + 1
       where id = $1`,
      [
        current.id,
        write.wallId,
        write.offsetMm,
        write.centreHeightMm,
        write.heightOverride,
        lux.plannedLux,
        lux.plannedLuxHours,
        lux.luxStatus,
        status,
      ],
    );
    await client.query('update undo_actions set undone = true where id = $1', [actionId]);
    const placement = await reloadPlacement(client, current.id);
    const seq = await writeEvent(client, {
      kind: row.kind === 'remove' ? 'placement.restored' : 'placement.moved',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
      offsetMm: row.kind === 'move' ? placement.offsetMm : null,
    });
    return { placement, seq };
  });
}

export async function claimPlacement(
  staff: Staff,
  id: string,
): Promise<{ placement: Placement; seq: number | null }> {
  return withTransaction(async (client) => {
    const current = await getPlacementById(client, id, true);
    if (!current) throw errors.notFound();
    assertRole(staff, 'preparator');
    if (current.status === 'claimed' && current.claimedBy?.id === staff.id) {
      return { placement: current, seq: null };
    }
    if (current.status === 'claimed' && current.claimedBy) {
      throw errors.alreadyClaimed(current.claimedBy);
    }
    assertTransition(current.status, 'claimed');
    await client.query(
      `update placements set status = 'claimed', claimed_by = $2, version = version + 1 where id = $1`,
      [current.id, staff.id],
    );
    const placement = await reloadPlacement(client, current.id);
    const seq = await writeEvent(client, {
      kind: 'placement.claimed',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
    });
    return { placement, seq };
  });
}

async function holderAction(
  staff: Staff,
  id: string,
  next: 'proposed' | 'hung',
): Promise<{ placement: Placement; seq: number }> {
  return withTransaction(async (client) => {
    const current = await getPlacementById(client, id, true);
    if (!current) throw errors.notFound();
    assertTransition(current.status, next);
    if (current.claimedBy?.id !== staff.id) throw errors.forbidden();
    await client.query(
      `update placements set status = $2, claimed_by = $3, version = version + 1 where id = $1`,
      [current.id, next, next === 'proposed' ? null : staff.id],
    );
    const placement = await reloadPlacement(client, current.id);
    const seq = await writeEvent(client, {
      kind: next === 'proposed' ? 'placement.released' : 'placement.hung',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
    });
    return { placement, seq };
  });
}

export async function releasePlacement(
  staff: Staff,
  id: string,
): Promise<{ placement: Placement; seq: number }> {
  return holderAction(staff, id, 'proposed');
}

export async function hangPlacement(
  staff: Staff,
  id: string,
): Promise<{ placement: Placement; seq: number }> {
  return holderAction(staff, id, 'hung');
}

export async function signOffPlacement(
  staff: Staff,
  id: string,
): Promise<{ placement: Placement; seq: number }> {
  return withTransaction(async (client) => {
    const current = await getPlacementById(client, id, true);
    if (!current) throw errors.notFound();
    assertRole(staff, 'registrar');
    assertTransition(current.status, 'signed_off');
    const photoRow = (
      await client.query('select 1 from condition_photos where object_id = $1 limit 1', [
        current.objectId,
      ])
    ).rows[0];
    if (!photoRow) {
      throw errors.conflict('condition_not_recorded', 'Add a condition photo before signing off.');
    }
    if (current.luxStatus === 'over') {
      throw errors.conflict('over_budget', 'That work is over its light budget.');
    }
    await client.query(
      `update placements set status = 'signed_off', version = version + 1 where id = $1`,
      [current.id],
    );
    const placement = await reloadPlacement(client, current.id);
    const seq = await writeEvent(client, {
      kind: 'placement.signed_off',
      actorId: staff.id,
      placementId: placement.id,
      objectId: placement.objectId,
      wallId: placement.wallId,
      title: placement.objectTitle,
      wallName: placement.wallName,
    });
    return { placement, seq };
  });
}

export async function setWallLux(
  staff: Staff,
  wallId: string,
  plannedLux: unknown,
): Promise<{ wall: Wall; placements: Placement[]; seq: number }> {
  return withTransaction(async (client) => {
    const wall = await loadWall(client, wallId);
    if (!wall) throw errors.notFound();
    assertRole(staff, 'curator');
    if (
      typeof plannedLux !== 'number' ||
      !Number.isInteger(plannedLux) ||
      plannedLux < 1 ||
      plannedLux > 1000
    ) {
      throw errors.validationFailed({ plannedLux: fieldMessages.plannedLux });
    }
    await client.query('update walls set planned_lux = $2 where id = $1', [wallId, plannedLux]);
    const plannedLuxHours = computePlannedLuxHours(plannedLux, openHours);
    await client.query(
      `update placements p set planned_lux = $2, planned_lux_hours = $3,
         lux_status = case
           when $2 > o.lux_limit or $3 > o.lux_hour_budget then 'over' else 'within' end
       from loan_objects o
       where o.id = p.object_id and p.wall_id = $1`,
      [wallId, plannedLux, plannedLuxHours],
    );
    const updatedWall = await loadWall(client, wallId);
    const rows = (
      await client.query(
        `${placementSelect} where p.wall_id = $1 and p.status <> 'removed' order by p.offset_mm, p.id`,
        [wallId],
      )
    ).rows;
    const seq = await writeEvent(client, {
      kind: 'wall.lux_changed',
      actorId: staff.id,
      wallId,
      wallName: wall.name,
      plannedLux,
    });
    return {
      wall: updatedWall ?? wall,
      placements: rows.map(rowToPlacement),
      seq,
    };
  });
}

/** Recomputes the lux fields of an object's placement after its limits change. */
export async function recomputeObjectPlacements(
  client: PoolClient,
  objectId: string,
): Promise<Placement[]> {
  await client.query(
    `update placements p set lux_status = case
       when p.planned_lux > o.lux_limit or p.planned_lux_hours > o.lux_hour_budget
         then 'over' else 'within' end
     from loan_objects o
     where o.id = p.object_id and p.object_id = $1`,
    [objectId],
  );
  const rows = (
    await client.query(`${placementSelect} where p.object_id = $1 and p.status <> 'removed'`, [
      objectId,
    ])
  ).rows;
  return rows.map(rowToPlacement);
}
