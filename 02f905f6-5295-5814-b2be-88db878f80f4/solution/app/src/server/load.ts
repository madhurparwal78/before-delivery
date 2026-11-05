// Kilns, profiles and firings as stored, and the load values derived from placements at every read.
import type { Firing, Kiln, Layer, Profile, Segment } from "../shared/api";
import { footprintOf, LAYER_CLEARANCE_HALVES, type Cone, type Post, type Rotation, type Shape, type Shelf, type Stage } from "../shared/rules";
import { FIRING_LABELS, firingHoursText, firingStatus, studioLabel, timeFields } from "./clock";
import type { Db } from "./db";
import { formatHalves } from "./measure";
import { pieceNumberText } from "./pieces";

export interface KilnRow {
  id: string;
  name: string;
  shelf_diameter_halves: number;
  layers: number;
  post_height_halves: number;
  usable_cubic_inches: number;
  posts: Post[];
}

export interface ProfileRow {
  id: string;
  kiln_id: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: Segment[];
  cool_down_hours: number;
}

export interface FiringRow {
  id: number;
  kiln_id: string;
  profile_id: string;
  stage: Stage;
  cone: Cone;
  status: "building" | "started" | "unloaded";
  profile_snapshot: ProfileRow | null;
  started_at: Date | null;
  firing_ends_at: Date | null;
  cool_until: Date | null;
}

export const shelfOf = (kiln: KilnRow): Shelf => ({
  diameter: kiln.shelf_diameter_halves,
  posts: kiln.posts,
  postHeight: kiln.post_height_halves,
});

export function profileOut(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    cone: row.cone,
    segments: row.segments,
    cool_down_hours: row.cool_down_hours,
    firing_hours: firingHoursText(row.segments),
  };
}

export async function kilnRows(db: Db): Promise<KilnRow[]> {
  return (await db.query<KilnRow>("SELECT * FROM kilns ORDER BY position")).rows;
}

export async function kilnRow(db: Db, id: string): Promise<KilnRow | undefined> {
  return (await db.query<KilnRow>("SELECT * FROM kilns WHERE id = $1", [id])).rows[0];
}

async function profileRows(db: Db): Promise<ProfileRow[]> {
  return (await db.query<ProfileRow>("SELECT * FROM profiles ORDER BY position")).rows;
}

/** The tallest piece any kiln takes: the tallest post height less the layer clearance, in halves. */
export async function heightLimitHalves(db: Db): Promise<number> {
  const found = await db.query<{ max: number }>("SELECT max(post_height_halves) AS max FROM kilns");
  return (found.rows[0]?.max ?? 0) - LAYER_CLEARANCE_HALVES;
}

export async function kilnsOut(db: Db): Promise<Kiln[]> {
  const [kilns, profiles, open] = await Promise.all([
    kilnRows(db),
    profileRows(db),
    db.query<{ id: number; kiln_id: string }>("SELECT id, kiln_id FROM firings WHERE status <> 'unloaded'"),
  ]);
  return kilns.map((kiln) => ({
    id: kiln.id,
    name: kiln.name,
    shelf_diameter_in: formatHalves(kiln.shelf_diameter_halves),
    layers: kiln.layers,
    post_height_in: formatHalves(kiln.post_height_halves),
    usable_cubic_inches: kiln.usable_cubic_inches,
    posts: kiln.posts.map((p) => ({ x: formatHalves(p.x), y: formatHalves(p.y), size_in: formatHalves(p.size) })),
    profiles: profiles.filter((p) => p.kiln_id === kiln.id).map(profileOut),
    current_firing_id: open.rows.find((f) => f.kiln_id === kiln.id)?.id ?? null,
  }));
}

interface PlacedRow {
  piece_number: number;
  layer: number;
  x_halves: number;
  y_halves: number;
  rotation: Rotation;
  shape: Shape;
  length_halves: number | null;
  width_halves: number | null;
  diameter_halves: number | null;
  height_halves: number;
  cubic_eighths: number;
}

export async function placedRows(db: Db, firingId: number): Promise<PlacedRow[]> {
  const found = await db.query<PlacedRow>(
    `SELECT pl.piece_number, pl.layer, pl.x_halves, pl.y_halves, pl.rotation,
            p.shape, p.length_halves, p.width_halves, p.diameter_halves, p.height_halves, p.cubic_eighths
       FROM placements pl JOIN pieces p ON p.number = pl.piece_number
      WHERE pl.firing_id = $1 ORDER BY pl.piece_number`,
    [firingId],
  );
  return found.rows;
}

export function footprintOfRow(row: PlacedRow) {
  const sides = {
    length: row.length_halves ?? undefined,
    width: row.width_halves ?? undefined,
    diameter: row.diameter_halves ?? undefined,
    height: row.height_halves,
  };
  return footprintOf(row.shape, sides, row.rotation, row.x_halves, row.y_halves);
}

/** Sum of placed cubic inches ÷ usable cubic inches × 100, rounded half up to a whole percent. */
export function fillPercent(placed: readonly PlacedRow[], usableCubicInches: number): number {
  const eighths = placed.reduce((sum, row) => sum + row.cubic_eighths, 0);
  const numerator = eighths * 100;
  const denominator = usableCubicInches * 8;
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Tallest placed piece on the layer plus 1.0 in, or null for an empty layer. */
export function layerHeight(placed: readonly PlacedRow[], layer: number): string | null {
  const heights = placed.filter((row) => row.layer === layer).map((row) => row.height_halves);
  return heights.length === 0 ? null : formatHalves(Math.max(...heights) + LAYER_CLEARANCE_HALVES);
}

export async function firingRow(db: Db, id: number): Promise<FiringRow | undefined> {
  return (await db.query<FiringRow>("SELECT * FROM firings WHERE id = $1", [id])).rows[0];
}

/** Locks a firing that is known to exist; placements, start and unload on one firing are serialised by it. */
export async function lockedFiring(db: Db, id: number): Promise<FiringRow> {
  return (await db.query<FiringRow>("SELECT * FROM firings WHERE id = $1 FOR UPDATE", [id])).rows[0];
}

/** The kiln a firing belongs to. */
export async function kilnOf(db: Db, firing: FiringRow): Promise<KilnRow> {
  return (await db.query<KilnRow>("SELECT * FROM kilns WHERE id = $1", [firing.kiln_id])).rows[0];
}

export async function firingOut(db: Db, firing: FiringRow, now = new Date()): Promise<Firing> {
  const kiln = await kilnOf(db, firing);
  const profile = firing.profile_snapshot ?? (await db.query<ProfileRow>("SELECT * FROM profiles WHERE id = $1", [firing.profile_id])).rows[0];
  const placed = await placedRows(db, firing.id);
  const status = firingStatus(firing, now);
  const layers: Layer[] = Array.from({ length: kiln.layers }, (_unused, index) => {
    const layer = index + 1;
    return {
      layer,
      height_in: layerHeight(placed, layer),
      placements: placed
        .filter((row) => row.layer === layer)
        .map((row) => {
          const footprint = footprintOfRow(row);
          return {
            piece_number: pieceNumberText(row.piece_number),
            shape: row.shape,
            x: formatHalves(row.x_halves),
            y: formatHalves(row.y_halves),
            rotation: row.rotation,
            width_in: formatHalves(footprint.w),
            depth_in: formatHalves(footprint.d),
            height_in: formatHalves(row.height_halves),
          };
        }),
    };
  });
  return {
    id: firing.id,
    kiln_id: firing.kiln_id,
    profile: profileOut(profile),
    status,
    status_label: FIRING_LABELS[status],
    ...timeFields("started_at", firing.started_at),
    ...timeFields("firing_ends_at", firing.firing_ends_at),
    ...timeFields("cool_until", firing.cool_until),
    server_now: now.toISOString(),
    server_now_label: studioLabel(now),
    fill_percent: fillPercent(placed, kiln.usable_cubic_inches),
    layers,
  };
}
