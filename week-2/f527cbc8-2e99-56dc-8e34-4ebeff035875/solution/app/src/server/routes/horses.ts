// Horses, their visits, their live stream and the hoof comparison (brief: API, Horses; Comparison; DP-26, DP-32).
import { db } from "../db.js";
import { type Alignment, type Hoof, type Line, compareSides, isHoof } from "../domain/hoofMarks.js";
import { ApiError, conflict, forbidden, notFound } from "../errors.js";
import { json, route } from "../http.js";
import { signer } from "../signedPaths.js";
import { serveStream, horseStream } from "../streams.js";
import {
  CURRENT_MARKS,
  HORSE_SELECT,
  type HorseRecord,
  type MarksRecord,
  type PhotoRecord,
  VISIT_SELECT,
  type VisitRecord,
  horseJson,
  horseVisibility,
  photoJson,
  visibleHorse,
  visitsJson,
} from "../views.js";

const READERS = ["farrier", "apprentice", "owner"] as const;

route("GET", "/api/horses", READERS, async ({ caller, now }) => {
  const visibility = horseVisibility(caller);
  const { rows } = await db.query<HorseRecord>(`${HORSE_SELECT} WHERE ${visibility.sql} ORDER BY lower(h.name), h.id`, visibility.params);
  return json(200, rows.map((horse) => horseJson(horse, caller, now)));
});

route("GET", "/api/horses/:id", READERS, async ({ caller, params, now }) => json(200, horseJson(await visibleHorse(db, caller, params.id ?? ""), caller, now)));

route("GET", "/api/horses/:id/visits", READERS, async ({ caller, params, now }) => {
  const horse = await visibleHorse(db, caller, params.id ?? "");
  const ownerFilter = caller.role === "owner" ? `AND v.status <> 'open'` : "";
  const { rows } = await db.query<VisitRecord>(`${VISIT_SELECT} WHERE v.horse_id = $1 ${ownerFilter} ORDER BY v.business_date DESC, v.created_at DESC`, [
    horse.id,
  ]);
  return json(200, await visitsJson(db, rows, caller, now));
});

route("GET", "/api/horses/:id/events", READERS, async ({ caller, params, req, res, requestId }) => {
  const horse = await visibleHorse(db, caller, params.id ?? "");
  if (!caller.sessionHash) throw forbidden();
  return serveStream(req, res, horseStream(horse.id, caller.role === "owner" ? "owner" : "staff"), caller.sessionHash, requestId);
});

// ---- Comparison ----

interface MarkedSide {
  visit_id: string;
  business_date: string;
  created_at: Date;
  marks: MarksRecord;
  photo: PhotoRecord;
}

/** Visits of a horse with marks and an after photo on `hoof`, oldest first; open visits only when `withOpen`. */
export async function markedSides(horseId: string, hoof: Hoof, withOpen: boolean, only?: readonly string[]): Promise<MarkedSide[]> {
  const { rows: visits } = await db.query<{ id: string; business_date: string; created_at: Date }>(
    `SELECT v.id, v.business_date, v.created_at FROM visits v
      WHERE v.horse_id = $1 ${withOpen ? "" : "AND v.status <> 'open'"} ${only ? "AND v.id = ANY($2)" : ""}
      ORDER BY v.business_date, v.created_at`,
    only ? [horseId, only] : [horseId],
  );
  if (!visits.length) return [];
  const ids = visits.map((visit) => visit.id);
  const [marks, photos] = await Promise.all([
    db.query<MarksRecord>(CURRENT_MARKS, [ids]),
    db.query<PhotoRecord>(`SELECT * FROM photos WHERE visit_id = ANY($1) AND hoof = $2 AND phase = 'after'`, [ids, hoof]),
  ]);
  return visits.flatMap((visit) => {
    const mark = marks.rows.find((row) => row.visit_id === visit.id && row.hoof === hoof);
    const photo = photos.rows.find((row) => row.visit_id === visit.id);
    return mark && photo ? [{ visit_id: visit.id, business_date: visit.business_date, created_at: visit.created_at, marks: mark, photo }] : [];
  });
}

const sideLines = (marks: MarksRecord): { hoof_wall: Line & { angle: number }; pastern: Line & { angle: number }; alignment: Alignment } => ({
  hoof_wall: { ...marks.hoof_wall, angle: marks.wall_tenths / 10 },
  pastern: { ...marks.pastern, angle: marks.pastern_tenths / 10 },
  alignment: marks.alignment,
});

/** Signed differences and the three readout lines, from the stored angles and labels. */
export const comparisonOf = (previous: MarksRecord, current: MarksRecord): ReturnType<typeof compareSides> =>
  compareSides(
    { wallTenths: previous.wall_tenths, pasternTenths: previous.pastern_tenths, alignment: previous.alignment },
    { wallTenths: current.wall_tenths, pasternTenths: current.pastern_tenths, alignment: current.alignment },
  );

const earlier = (a: MarkedSide, b: MarkedSide): boolean =>
  a.business_date < b.business_date || (a.business_date === b.business_date && a.created_at < b.created_at);

route("GET", "/api/horses/:id/comparison", READERS, async ({ caller, params, query, now }) => {
  const horse = await visibleHorse(db, caller, params.id ?? "");
  const hoof = query.get("hoof");
  if (!isHoof(hoof)) throw new ApiError(422, "validation", { errors: { hoof: "Choose LF, RF, LH or RH." } });
  const withOpen = caller.role !== "owner";
  const marked = await markedSides(horse.id, hoof, withOpen);
  const requested = [query.get("previous"), query.get("current")].filter((id): id is string => Boolean(id));
  if (requested.length) {
    const visible = await db.query<{ id: string }>(
      `SELECT v.id FROM visits v WHERE v.horse_id = $1 AND v.id = ANY($2) ${withOpen ? "" : "AND v.status <> 'open'"}`,
      [horse.id, requested],
    );
    if (visible.rowCount !== new Set(requested).size) throw notFound();
  }
  if (marked.length < 2) throw conflict("not_enough_marked_visits");
  const pick = (id: string | null, fallback: MarkedSide | undefined): MarkedSide | undefined =>
    id ? marked.find((side) => side.visit_id === id) : fallback;
  const previous = pick(query.get("previous"), marked[marked.length - 2]);
  const current = pick(query.get("current"), marked[marked.length - 1]);
  if (!previous || !current || !earlier(previous, current)) {
    throw new ApiError(422, "validation", { errors: { previous: "Pick an earlier marked visit than the current one." } });
  }
  const { difference, readout } = comparisonOf(previous.marks, current.marks);
  const sign = await signer(db, now);
  const side = (entry: MarkedSide): Record<string, unknown> => ({
    visit_id: entry.visit_id,
    business_date: entry.business_date,
    photo: photoJson(entry.photo, sign),
    ...sideLines(entry.marks),
  });
  return json(200, {
    horse: { id: horse.id, name: horse.name },
    hoof,
    previous: side(previous),
    current: side(current),
    difference,
    readout,
    marked_visits: marked.map((entry) => ({ visit_id: entry.visit_id, business_date: entry.business_date })),
  });
});

export { sideLines };
