import type { PoolClient } from 'pg';
import type {
  Firing,
  FiringLayer,
  FiringStatus,
  KilnProfile,
  LayerPlacement,
  Rotation,
  Shape,
} from '../../shared/types';
import { FIRING_STATUS_LABELS } from '../../shared/labels';
import { query, queryOne } from '../db/pool';
import { env } from '../env';
import { fillPercent, layerHeightIn, type PlacedPiece } from '../domain/load';
import { firingStatusOf, scheduleOf } from '../domain/schedule';
import { footprintOf, footprintSpan, type Footprint } from '../../shared/placement';
import { halfUnitsToInches } from '../domain/measure';
import { studioLabel } from '../domain/time';
import type { KilnRecord } from './catalog';

export interface FiringRow {
  id: string;
  kiln_id: string;
  profile: KilnProfile;
  started_at: Date | null;
  firing_ends_at: Date | null;
  cool_until: Date | null;
  unloaded_at: Date | null;
  pickup_shelf: string | null;
  created_at: Date;
}

export interface PlacementRow {
  firing_id: string;
  piece_number: string;
  layer: number;
  x_half: number;
  y_half: number;
  rotation: Rotation;
  shape: Shape;
  width_half: number;
  depth_half: number;
  height_half: number;
  cubic_milli: number;
}

export function statusOf(row: FiringRow, now: Date): FiringStatus {
  return firingStatusOf(
    {
      startedAt: row.started_at,
      firingEndsAt: row.firing_ends_at,
      coolUntil: row.cool_until,
      unloadedAt: row.unloaded_at,
    },
    now,
  );
}

export async function findFiring(id: unknown): Promise<FiringRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<FiringRow>('select * from firings where id = $1', [id]);
}

export async function openFiringFor(kilnId: string): Promise<FiringRow | null> {
  return queryOne<FiringRow>(
    'select * from firings where kiln_id = $1 and unloaded_at is null',
    [kilnId],
  );
}

export async function createFiring(
  kilnId: string,
  profile: KilnProfile,
): Promise<FiringRow | 'kiln_busy'> {
  const row = await queryOne<FiringRow>(
    `insert into firings (kiln_id, profile) values ($1, $2::jsonb)
     on conflict do nothing returning *`,
    [kilnId, JSON.stringify(profile)],
  );
  return row ?? 'kiln_busy';
}

export async function placementsOf(firingId: string): Promise<PlacementRow[]> {
  return query<PlacementRow>(
    `select pl.*, p.shape, p.width_half, p.depth_half, p.height_half, p.cubic_milli
     from placements pl join pieces p on p.number = pl.piece_number
     where pl.firing_id = $1 order by pl.piece_number`,
    [firingId],
  );
}

export function footprintsOnLayer(
  placements: PlacementRow[],
  layer: number,
  exceptPiece?: string,
): { pieceNumber: string; footprint: Footprint }[] {
  return placements
    .filter((row) => row.layer === layer && row.piece_number !== exceptPiece)
    .map((row) => ({
      pieceNumber: row.piece_number,
      footprint: footprintOf(
        { shape: row.shape, width: row.width_half, depth: row.depth_half },
        row.x_half,
        row.y_half,
        row.rotation,
      ),
    }));
}

function placedPieces(placements: PlacementRow[]): PlacedPiece[] {
  return placements.map((row) => ({
    pieceNumber: row.piece_number,
    layer: row.layer,
    height: row.height_half,
    cubicMilli: row.cubic_milli,
  }));
}

export function fillOf(placements: PlacementRow[], kiln: KilnRecord): number {
  return fillPercent(placedPieces(placements), kiln.usable_cubic_inches);
}

export function layerHeightOf(placements: PlacementRow[], layer: number): string | null {
  return layerHeightIn(placedPieces(placements).filter((piece) => piece.layer === layer));
}

function toLayerPlacement(row: PlacementRow): LayerPlacement {
  const span = footprintSpan(
    { shape: row.shape, width: row.width_half, depth: row.depth_half },
    row.rotation,
  );
  return {
    piece_number: row.piece_number,
    shape: row.shape,
    x: halfUnitsToInches(row.x_half),
    y: halfUnitsToInches(row.y_half),
    rotation: row.rotation,
    width_in: halfUnitsToInches(span.width),
    depth_in: halfUnitsToInches(span.depth),
    height_in: halfUnitsToInches(row.height_half),
  };
}

export function toFiring(
  row: FiringRow,
  kiln: KilnRecord,
  placements: PlacementRow[],
  now: Date,
): Firing {
  const status = statusOf(row, now);
  const layers: FiringLayer[] = [];
  for (let layer = 1; layer <= kiln.layers; layer += 1) {
    layers.push({
      layer,
      height_in: layerHeightOf(placements, layer),
      placements: placements.filter((item) => item.layer === layer).map(toLayerPlacement),
    });
  }
  return {
    id: row.id,
    kiln_id: row.kiln_id,
    profile: row.profile,
    status,
    status_label: FIRING_STATUS_LABELS[status],
    started_at: row.started_at ? row.started_at.toISOString() : null,
    started_at_label: row.started_at ? studioLabel(row.started_at) : null,
    firing_ends_at: row.firing_ends_at ? row.firing_ends_at.toISOString() : null,
    firing_ends_at_label: row.firing_ends_at ? studioLabel(row.firing_ends_at) : null,
    cool_until: row.cool_until ? row.cool_until.toISOString() : null,
    cool_until_label: row.cool_until ? studioLabel(row.cool_until) : null,
    server_now: now.toISOString(),
    server_now_label: studioLabel(now),
    fill_percent: fillOf(placements, kiln),
    layers,
  };
}

/** Holds the firing row so placements on one load are decided one at a time. */
export async function lockFiring(client: PoolClient, id: string): Promise<FiringRow | null> {
  const result = await client.query<FiringRow>('select * from firings where id = $1 for update', [
    id,
  ]);
  return result.rows[0] ?? null;
}

export async function placementsOfLocked(
  client: PoolClient,
  firingId: string,
): Promise<PlacementRow[]> {
  const result = await client.query<PlacementRow>(
    `select pl.*, p.shape, p.width_half, p.depth_half, p.height_half, p.cubic_milli
     from placements pl join pieces p on p.number = pl.piece_number
     where pl.firing_id = $1 order by pl.piece_number`,
    [firingId],
  );
  return result.rows;
}

export async function insertPlacement(
  client: PoolClient,
  args: {
    firingId: string;
    pieceNumber: string;
    layer: number;
    xHalf: number;
    yHalf: number;
    rotation: Rotation;
  },
): Promise<void> {
  await client.query(
    `insert into placements (firing_id, piece_number, layer, x_half, y_half, rotation)
     values ($1, $2, $3, $4, $5, $6)`,
    [args.firingId, args.pieceNumber, args.layer, args.xHalf, args.yHalf, args.rotation],
  );
  await client.query("update pieces set status = 'loaded' where number = $1", [args.pieceNumber]);
}

export async function movePlacement(
  client: PoolClient,
  args: {
    firingId: string;
    pieceNumber: string;
    layer: number;
    xHalf: number;
    yHalf: number;
    rotation: Rotation;
  },
): Promise<void> {
  await client.query(
    `update placements set layer = $3, x_half = $4, y_half = $5, rotation = $6
     where firing_id = $1 and piece_number = $2`,
    [args.firingId, args.pieceNumber, args.layer, args.xHalf, args.yHalf, args.rotation],
  );
}

export async function deletePlacement(
  client: PoolClient,
  firingId: string,
  pieceNumber: string,
): Promise<boolean> {
  const result = await client.query(
    'delete from placements where firing_id = $1 and piece_number = $2',
    [firingId, pieceNumber],
  );
  if (result.rowCount !== 1) return false;
  await client.query("update pieces set status = 'queued' where number = $1 and status = 'loaded'", [
    pieceNumber,
  ]);
  return true;
}

/**
 * Starts a firing. The profile is snapshotted here, so a profile edited while
 * the load was being built still counts, and the schedule comes from that
 * snapshot and the server's clock.
 */
export async function startFiring(
  client: PoolClient,
  firing: FiringRow,
  profile: KilnProfile,
  now: Date,
): Promise<FiringRow | null> {
  const { firingEndsAt, coolUntil } = scheduleOf({
    startedAt: now,
    segments: profile.segments,
    coolDownHours: profile.cool_down_hours,
    firingHourSeconds: env.firingHourSeconds,
  });
  const result = await client.query<FiringRow>(
    `update firings set profile = $5::jsonb, started_at = $2, firing_ends_at = $3, cool_until = $4
     where id = $1 and started_at is null and unloaded_at is null
     returning *`,
    [firing.id, now, firingEndsAt, coolUntil, JSON.stringify(profile)],
  );
  return result.rows[0] ?? null;
}

export async function finishUnload(
  client: PoolClient,
  firingId: string,
  pickupShelf: string | null,
  now: Date,
): Promise<FiringRow | null> {
  const result = await client.query<FiringRow>(
    `update firings set unloaded_at = $2, pickup_shelf = $3
     where id = $1 and unloaded_at is null and cool_until is not null and cool_until <= $2
     returning *`,
    [firingId, now, pickupShelf],
  );
  return result.rows[0] ?? null;
}
