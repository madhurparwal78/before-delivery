import { makeId, one, query } from '../db.js';
import { kmToMiles, Party, Size, largerThanNeeded, suggestPlan } from '../../domain/vehicles.js';
import { RouteLeg, readRoute } from '../providers/wiremock.js';
import { Stop, stopsOf } from './hires.js';

export type TripLeg = { km: string; minutes: number; miles: string };

export type TripView = {
  stops: Stop[];
  legs: TripLeg[];
  planOutOfDate: boolean;
  plan: { sizes: Size[] | null; suggested: Size[]; largerThanNeeded: boolean };
};

type TripRow = { legs: TripLeg[] | null; plan_sizes: Size[] | null; plan_out_of_date: boolean; routed: boolean };

async function tripRow(deskId: string, enquiryId: string): Promise<TripRow> {
  const row = await one<TripRow>(
    'select legs, plan_sizes, plan_out_of_date, routed from trips where desk_id = $1 and enquiry_id = $2',
    [deskId, enquiryId],
  );
  if (row) return row;
  await query('insert into trips (desk_id, enquiry_id) values ($1, $2) on conflict do nothing', [deskId, enquiryId]);
  return { legs: null, plan_sizes: null, plan_out_of_date: false, routed: false };
}

export function vehicleClassFor(plan: Size[]): 'coach' | 'minibus' {
  return plan.every((size) => size <= 16) ? 'minibus' : 'coach';
}

function legsWithMiles(legs: RouteLeg[]): TripLeg[] {
  return legs.map((leg) => ({ km: leg.km, minutes: leg.minutes, miles: kmToMiles(leg.km) }));
}

export async function readTrip(deskId: string, enquiryId: string, party: Party): Promise<TripView> {
  const row = await tripRow(deskId, enquiryId);
  const stops = await stopsOf(deskId, enquiryId);
  const suggested = suggestPlan(party);
  const saved = row.plan_sizes;
  return {
    stops,
    legs: row.legs ?? [],
    planOutOfDate: row.plan_out_of_date,
    plan: {
      sizes: saved,
      suggested,
      largerThanNeeded: saved ? largerThanNeeded(saved, suggested) : false,
    },
  };
}

/** One call makes one route call. A failure keeps the order and the last good legs. */
export async function routeTrip(deskId: string, enquiryId: string, party: Party): Promise<TripView> {
  const stops = await stopsOf(deskId, enquiryId);
  const row = await tripRow(deskId, enquiryId);
  const plan = row.plan_sizes ?? suggestPlan(party);
  try {
    const legs = legsWithMiles(await readRoute(vehicleClassFor(plan), stops.map((stop) => stop.text)));
    await query(
      'update trips set legs = $3, plan_out_of_date = false, routed = true where desk_id = $1 and enquiry_id = $2',
      [deskId, enquiryId, JSON.stringify(legs)],
    );
  } catch (trouble) {
    await query('update trips set plan_out_of_date = true, routed = true where desk_id = $1 and enquiry_id = $2', [
      deskId,
      enquiryId,
    ]);
    throw trouble;
  }
  return readTrip(deskId, enquiryId, party);
}

export async function tripNeedsFirstRoute(deskId: string, enquiryId: string): Promise<boolean> {
  const row = await tripRow(deskId, enquiryId);
  return !row.routed && row.legs === null;
}

export async function reorderStops(deskId: string, enquiryId: string, order: string[]): Promise<boolean> {
  const stops = await stopsOf(deskId, enquiryId);
  if (order.length !== stops.length) return false;
  const known = new Set(stops.map((stop) => stop.id));
  for (const id of order) {
    if (!known.has(id)) return false;
  }
  for (let index = 0; index < order.length; index += 1) {
    await query('update stops set position = $3 where desk_id = $1 and id = $2', [deskId, order[index], index]);
  }
  return true;
}

export async function savePlan(deskId: string, enquiryId: string, sizes: Size[]): Promise<void> {
  await query('update trips set plan_sizes = $3 where desk_id = $1 and enquiry_id = $2', [
    deskId,
    enquiryId,
    JSON.stringify(sizes),
  ]);
}

export async function savedPlan(deskId: string, enquiryId: string): Promise<Size[] | null> {
  const row = await tripRow(deskId, enquiryId);
  return row.plan_sizes;
}

export async function addStop(deskId: string, enquiryId: string, text: string, position: number): Promise<string> {
  const id = makeId('ST');
  await query('insert into stops (desk_id, id, enquiry_id, position, text, checked) values ($1,$2,$3,$4,$5,$6)', [
    deskId,
    id,
    enquiryId,
    position,
    text,
    false,
  ]);
  return id;
}

export async function replaceStops(deskId: string, enquiryId: string, texts: string[]): Promise<void> {
  await query('delete from stops where desk_id = $1 and enquiry_id = $2', [deskId, enquiryId]);
  for (let index = 0; index < texts.length; index += 1) {
    await query('insert into stops (desk_id, id, enquiry_id, position, text, checked) values ($1,$2,$3,$4,$5,$6)', [
      deskId,
      makeId('ST'),
      enquiryId,
      index,
      texts[index],
      false,
    ]);
  }
}
