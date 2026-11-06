// Event writing (brief: Business rules, Events): exactly one event per state change, in the change's
// transaction. The advisory lock is held to commit, so seq values follow commit order.
import type { Db } from "./db.js";
import type { Staff } from "./model.js";

export const EVENT_KINDS = [
  "placement.placed",
  "placement.moved",
  "placement.removed",
  "placement.restored",
  "placement.claimed",
  "placement.released",
  "placement.hung",
  "placement.signed_off",
  "object.created",
  "object.updated",
  "photo.attached",
  "wall.lux_changed",
  "preview.scheduled",
  "preview.cancelled",
  "preview.published",
  "preview.withdrawn",
] as const;
type EventKind = (typeof EVENT_KINDS)[number];

interface EventFields {
  placementId?: string;
  objectId?: string;
  wallId?: string;
  previewId?: string;
  title?: string;
  wallName?: string;
  offsetMm?: number;
  plannedLux?: number;
  publishAtDisplay?: string;
  recipientCount?: number;
}

const EVENT_ORDER_LOCK = 72_034_116;

/** An events row joined with its actor's name, typed by the schema's columns and checks. */
interface EventRow {
  seq: string;
  kind: EventKind;
  at: Date;
  actor_id: string | null;
  actor_name: string | null;
  placement_id: string | null;
  object_id: string | null;
  wall_id: string | null;
  preview_id: string | null;
  title: string | null;
  wall_name: string | null;
  offset_mm: number | null;
  planned_lux: number | null;
  publish_at_display: string | null;
  recipient_count: number | null;
}

/** Writes the event as the last statement of the change's transaction and returns its seq. */
export async function writeEvent(db: Db, kind: EventKind, actor: Staff | null, f: EventFields): Promise<number> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [EVENT_ORDER_LOCK]);
  const { rows } = await db.query(
    `INSERT INTO events (kind, actor_id, placement_id, object_id, wall_id, preview_id, title, wall_name, offset_mm,
       planned_lux, publish_at_display, recipient_count, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, clock_timestamp()) RETURNING seq`,
    [
      kind,
      actor?.id ?? null,
      f.placementId ?? null,
      f.objectId ?? null,
      f.wallId ?? null,
      f.previewId ?? null,
      f.title ?? null,
      f.wallName ?? null,
      f.offsetMm ?? null,
      f.plannedLux ?? null,
      f.publishAtDisplay ?? null,
      f.recipientCount ?? null,
    ],
  );
  return Number(rows[0].seq);
}

export async function eventsAfter(db: Db, after: number) {
  const { rows } = await db.query<EventRow>(
    `SELECT e.*, s.name AS actor_name FROM events e LEFT JOIN staff s ON s.id = e.actor_id
     WHERE e.seq > $1 ORDER BY e.seq LIMIT 200`,
    [after],
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    kind: r.kind,
    at: r.at.toISOString(),
    actor: r.actor_id && r.actor_name ? { id: r.actor_id, name: r.actor_name } : null,
    placementId: r.placement_id,
    objectId: r.object_id,
    wallId: r.wall_id,
    previewId: r.preview_id,
    title: r.title,
    wallName: r.wall_name,
    offsetMm: r.offset_mm,
    plannedLux: r.planned_lux,
    publishAtDisplay: r.publish_at_display,
    recipientCount: r.recipient_count,
  }));
}

export async function latestSeq(db: Db): Promise<number> {
  const { rows } = await db.query("SELECT coalesce(max(seq), 0) AS seq FROM events");
  return Number(rows[0].seq);
}
