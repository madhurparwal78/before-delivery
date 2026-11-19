import { makeId, query } from '../db.js';
import { Pennies, splitToPennies } from '../../domain/money.js';
import { adultsNeeded, isWheelchairSeat, nextEmptySeat, seatLabels, wheelchairSeatsOf } from '../../domain/seats.js';
import { foldName, readCsv } from '../../domain/text.js';
import { Size } from '../../domain/vehicles.js';
import { HireView } from './hires.js';

export type Passenger = {
  id: string;
  name: string;
  group: string;
  needs: string;
  position: number;
  listedTwice: boolean;
  wheelchair: boolean;
};

export const PASSENGER_MAX_ROWS = 500;

export function isWheelchairNeed(needs: string): boolean {
  return needs.trim().toLowerCase() === 'wheelchair';
}

export async function passengersOf(deskId: string, hireId: string): Promise<Passenger[]> {
  const rows = await query<{ id: string; name: string; group_name: string; needs: string; position: number }>(
    'select id, name, group_name, needs, position from passengers where desk_id = $1 and hire_id = $2 order by position, id',
    [deskId, hireId],
  );
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const folded = `${foldName(row.name)}|${foldName(row.group_name)}`;
    const count = (seen.get(folded) ?? 0) + 1;
    seen.set(folded, count);
    return {
      id: row.id,
      name: row.name,
      group: row.group_name,
      needs: row.needs,
      position: Number(row.position),
      listedTwice: count > 1,
      wheelchair: isWheelchairNeed(row.needs),
    };
  });
}

export async function addPassenger(
  deskId: string,
  hireId: string,
  passenger: { name: string; group: string; needs: string },
): Promise<Passenger> {
  const places = await query<{ next: string | null }>(
    'select max(position)::text as next from passengers where desk_id = $1 and hire_id = $2',
    [deskId, hireId],
  );
  const position = Number(places[0]?.next ?? -1) + 1;
  const id = makeId('PS');
  await query(
    'insert into passengers (desk_id, id, hire_id, name, group_name, needs, position) values ($1,$2,$3,$4,$5,$6,$7)',
    [deskId, id, hireId, passenger.name, passenger.group, passenger.needs, position],
  );
  return {
    id,
    name: passenger.name,
    group: passenger.group,
    needs: passenger.needs,
    position,
    listedTwice: false,
    wheelchair: isWheelchairNeed(passenger.needs),
  };
}

export type SheetReading =
  | { ok: false; message: string }
  | { ok: true; rows: { name: string; group: string; needs: string }[] };

/** A list is comma or semicolon as decided by the header row, with Name, Group and Needs in any order and case. */
export function readPassengerSheet(text: string): SheetReading {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  const separator = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const lines = readCsv(text, separator).filter((line) => line.cells.some((cell) => cell.trim() !== ''));
  const header = lines[0];
  if (!header) return { ok: false, message: 'The first line has to name the columns Name, Group and Needs.' };
  const names = header.cells.map((cell) => cell.trim().toLowerCase());
  const nameAt = names.indexOf('name');
  if (nameAt === -1) return { ok: false, message: 'The first line has to name the columns Name, Group and Needs.' };
  const groupAt = names.indexOf('group');
  const needsAt = names.indexOf('needs');
  const body = lines.slice(1);
  if (body.length > PASSENGER_MAX_ROWS) {
    return { ok: false, message: 'This file has more than 500 rows.' };
  }
  return {
    ok: true,
    rows: body
      .map((line) => ({
        name: (line.cells[nameAt] ?? '').trim(),
        group: groupAt === -1 ? '' : (line.cells[groupAt] ?? '').trim(),
        needs: needsAt === -1 ? '' : (line.cells[needsAt] ?? '').trim(),
      }))
      .filter((row) => row.name !== ''),
  };
}

export type SeatPlace = { vehicleId: string; seat: string; passengerId: string };

export async function seatPlacesOf(deskId: string, hireId: string): Promise<SeatPlace[]> {
  const rows = await query<{ vehicle_id: string; seat: string; passenger_id: string }>(
    'select vehicle_id, seat, passenger_id from seat_places where desk_id = $1 and hire_id = $2',
    [deskId, hireId],
  );
  return rows.map((row) => ({ vehicleId: row.vehicle_id, seat: row.seat, passengerId: row.passenger_id }));
}

export async function seatPassenger(
  deskId: string,
  hireId: string,
  vehicleId: string,
  seat: string,
  passengerId: string,
): Promise<void> {
  await query('delete from seat_places where desk_id = $1 and hire_id = $2 and passenger_id = $3', [
    deskId,
    hireId,
    passengerId,
  ]);
  await query(
    `insert into seat_places (desk_id, hire_id, vehicle_id, seat, passenger_id) values ($1,$2,$3,$4,$5)
     on conflict (desk_id, vehicle_id, seat) do update set passenger_id = excluded.passenger_id,
       hire_id = excluded.hire_id`,
    [deskId, hireId, vehicleId, seat, passengerId],
  );
}

export async function clearSeat(deskId: string, vehicleId: string, seat: string): Promise<void> {
  await query('delete from seat_places where desk_id = $1 and vehicle_id = $2 and seat = $3', [
    deskId,
    vehicleId,
    seat,
  ]);
}

/** Each new name takes the next empty seat, wheelchair users 2A then 2B. */
export async function seatNewPassengers(deskId: string, hire: HireView): Promise<void> {
  const passengers = await passengersOf(deskId, hire.id);
  const places = await seatPlacesOf(deskId, hire.id);
  const seatedIds = new Set(places.map((place) => place.passengerId));
  for (const passenger of passengers) {
    if (seatedIds.has(passenger.id)) continue;
    for (const vehicle of hire.vehicles) {
      const taken = new Set(
        [...places, ...(await seatPlacesOf(deskId, hire.id))]
          .filter((place) => place.vehicleId === vehicle.id)
          .map((place) => place.seat),
      );
      const seat = nextEmptySeat(vehicle.seats, taken, passenger.wheelchair);
      if (!seat) continue;
      await seatPassenger(deskId, hire.id, vehicle.id, seat, passenger.id);
      places.push({ vehicleId: vehicle.id, seat, passengerId: passenger.id });
      break;
    }
  }
}

export type SeatGridCell = { seat: string; passengerId: string | null };

export function gridOf(seats: Size, places: SeatPlace[], vehicleId: string): SeatGridCell[] {
  const taken = new Map(places.filter((place) => place.vehicleId === vehicleId).map((place) => [place.seat, place.passengerId]));
  return seatLabels(seats).map((seat) => ({ seat, passengerId: taken.get(seat) ?? null }));
}

export type SplitLine = { passengerId: string; name: string; amount: Pennies };

/** A per-head split sums to the vehicle's total, with earlier names taking the extra pennies. */
export function splitOf(total: Pennies, seated: { passengerId: string; name: string }[]): SplitLine[] {
  const amounts = splitToPennies(total, seated.length);
  return seated.map((person, index) => ({ ...person, amount: amounts[index] }));
}

export type AdultsCount = { adultsNeeded: number; adultsShort: number };

/** On a school hire a person whose group is Adult is an adult and everyone else a pupil. */
export function adultsOf(hire: HireView, passengers: Passenger[]): AdultsCount {
  if (hire.occasion !== 'school') return { adultsNeeded: 0, adultsShort: 0 };
  const adults = passengers.filter((person) => person.group.trim().toLowerCase() === 'adult').length;
  const pupils = passengers.length - adults;
  const needed = adultsNeeded(pupils);
  return { adultsNeeded: needed, adultsShort: Math.max(0, needed - adults) };
}

export function seatAllowed(seats: Size, seat: string, wheelchair: boolean): 'ok' | 'unknownSeat' | 'wheelchairSeat' {
  if (!seatLabels(seats).includes(seat)) return 'unknownSeat';
  if (wheelchair && !wheelchairSeatsOf(seats).includes(seat)) return 'wheelchairSeat';
  if (!wheelchair && isWheelchairSeat(seat) && wheelchairSeatsOf(seats).includes(seat)) return 'ok';
  return 'ok';
}

export async function savePassengerList(
  deskId: string,
  hireId: string,
  listId: string,
  objectKey: string,
): Promise<void> {
  await query('insert into passenger_lists (desk_id, id, hire_id, object_key) values ($1,$2,$3,$4)', [
    deskId,
    listId,
    hireId,
    objectKey,
  ]);
}

export function passengerListKey(deskId: string, hireId: string, listId: string): string {
  return `desks/${deskId}/passengers/${hireId}/${listId}.csv`;
}
