// Truck visits: the log with gap flags and overdue state, arrivals and departures.
import { randomUUID } from "node:crypto";
import { pool, required, rows, tx, isUniqueViolation, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { json, type AuthedCtx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import { truckFor, visitFor, type TruckRow } from "./scope.ts";
import { isoInstant } from "../shared/time.ts";
import { SERVICE_LABELS, type InspectorVisit, type Service, type Visit } from "../shared/api.ts";

const HOUR_MS = 3_600_000;
/** Trucks must return to their commissary at least this often. */
const RETURN_INTERVAL_HOURS = 24;
const SERVICES = Object.keys(SERVICE_LABELS) as Service[];

interface VisitRow {
  id: string;
  truck_id: string;
  site_id: string;
  arrived_at: Date;
  departed_at: Date | null;
  services: Service[];
  operator_signature: string | null;
  arrived_by_name: string;
  departed_by_name: string | null;
}

/** Gap in hundredths of an hour, rounded half up from the two departures as the API returns them. */
function gapHundredths(previous: Date, current: Date): number {
  return Math.floor(((current.getTime() - previous.getTime()) * 100 + HOUR_MS / 2) / HOUR_MS);
}

/** A visit is flagged when its departure is more than the return interval after the previous one. */
function gapFlagged(hundredths: number): boolean {
  return hundredths > RETURN_INTERVAL_HOURS * 100;
}

interface TruckLog {
  visits: Visit[];
  lastDepartedAt: Date | null;
  overdue: boolean;
}

/** Every visit, newest first, each with its gap from the previous departure. */
export async function truckLog(db: Db | typeof pool, truckId: string, at: number): Promise<TruckLog> {
  const list = await rows<VisitRow>(
    db,
    `SELECT id, truck_id, site_id, arrived_at, departed_at, services, operator_signature, arrived_by_name, departed_by_name
       FROM visits WHERE truck_id = $1 ORDER BY arrived_at, seq`,
    [truckId],
  );
  let previous: Date | null = null;
  const visits: Visit[] = [];
  for (const v of list) {
    const hundredths = v.departed_at && previous ? gapHundredths(previous, v.departed_at) : null;
    visits.push({
      id: v.id,
      truck_id: v.truck_id,
      site_id: v.site_id,
      arrived_at: isoInstant(v.arrived_at.getTime()),
      departed_at: v.departed_at ? isoInstant(v.departed_at.getTime()) : null,
      services: SERVICES.filter((s) => v.services.includes(s)),
      operator_signature: v.operator_signature,
      manager_name: v.departed_by_name ?? v.arrived_by_name,
      gap_hours: hundredths === null ? null : hundredths / 100,
      gap_flagged: hundredths !== null && gapFlagged(hundredths),
    });
    if (v.departed_at) previous = v.departed_at;
  }
  return {
    visits: visits.reverse(),
    lastDepartedAt: previous,
    overdue: previous !== null && at - previous.getTime() > RETURN_INTERVAL_HOURS * HOUR_MS,
  };
}

/** The published fields of a visit an inspector copy may carry. */
export function inspectorVisit(v: Visit): InspectorVisit {
  return {
    arrived_at: v.arrived_at,
    departed_at: v.departed_at,
    services: v.services,
    operator_signature: v.operator_signature,
    manager_name: v.manager_name,
    gap_hours: v.gap_hours,
    gap_flagged: v.gap_flagged,
  };
}

function truckView(t: TruckRow): { id: string; name: string; permit_number: string; member_id: string; business_name: string } {
  return { id: t.id, name: t.name, permit_number: t.permit_number, member_id: t.member_id, business_name: t.business_name };
}

// GET /api/trucks/{truck_id}/visits
export async function listVisits(ctx: AuthedCtx): Promise<Reply> {
  const truck = await truckFor(pool, ctx.user, ctx.params.truck_id);
  const log = await truckLog(pool, truck.id, now());
  return json(200, {
    truck: truckView(truck),
    visits: log.visits,
    last_departed_at: log.lastDepartedAt ? isoInstant(log.lastDepartedAt.getTime()) : null,
    overdue: log.overdue,
  });
}

async function visitView(db: Db, truckId: string, visitId: string): Promise<Visit> {
  const visit = (await truckLog(db, truckId, now())).visits.find((v) => v.id === visitId);
  return required(visit);
}

// POST /api/trucks/{truck_id}/visits
export async function recordArrival(ctx: AuthedCtx): Promise<Reply> {
  const truck = await truckFor(pool, ctx.user, ctx.params.truck_id);
  const fields = new Fields(ctx.body, []);
  return tx(async (db) => {
    await db.query("SELECT 1 FROM trucks WHERE id = $1 FOR UPDATE", [truck.id]);
    const open = await rows(db, "SELECT 1 FROM visits WHERE truck_id = $1 AND departed_at IS NULL", [truck.id]);
    if (open.length > 0) throw new ApiError("visit_open");
    fields.raise();
    const id = randomUUID();
    try {
      await db.query("INSERT INTO visits (id, truck_id, site_id, arrived_at, arrived_by_name) VALUES ($1, $2, $3, $4, $5)", [
        id,
        truck.id,
        truck.site_id,
        new Date(now()),
        ctx.user.name,
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError("visit_open");
      throw error;
    }
    return json(201, { visit: await visitView(db, truck.id, id) });
  });
}

// POST /api/visits/{id}/depart
export async function recordDeparture(ctx: AuthedCtx): Promise<Reply> {
  const found = await visitFor(pool, ctx.user, ctx.params.id);
  const fields = new Fields(ctx.body, ["services", "operator_signature"]);
  return tx(async (db) => {
    const [visit] = await rows<{ departed_at: Date | null }>(db, "SELECT departed_at FROM visits WHERE id = $1 FOR UPDATE", [found.id]);
    if (visit?.departed_at) throw new ApiError("invalid_transition");
    const raw = fields.raw("services");
    const services =
      Array.isArray(raw) && raw.length > 0 && raw.every((s): s is Service => SERVICES.includes(s)) && new Set(raw).size === raw.length
        ? raw
        : fields.fail("services", "Choose at least one service.");
    const signature = fields.string("operator_signature", "Type the operator's name to sign.", 2, 80);
    if (services === undefined || signature === undefined) return fields.reject();
    fields.raise();
    await db.query("UPDATE visits SET departed_at = $2, services = $3, operator_signature = $4, departed_by_name = $5 WHERE id = $1", [
      found.id,
      new Date(now()),
      services,
      signature,
      ctx.user.name,
    ]);
    return json(200, { visit: await visitView(db, found.truck_id, found.id) });
  });
}
