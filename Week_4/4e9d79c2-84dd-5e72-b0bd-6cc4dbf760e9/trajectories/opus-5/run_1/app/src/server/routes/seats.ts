import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { PASSENGER_FILE_LIMIT, conflict, invalid, providerUnavailable, unsupportedMediaType } from '../errors.js';
import { copy, seatMoved } from '../copy.js';
import { makeId } from '../db.js';
import { requireDesk } from '../session.js';
import { hasContentType } from '../http.js';
import { moneyString } from '../../domain/money.js';
import { contentDisposition, writeCsv } from '../../domain/text.js';
import { loadHire } from '../data/hires.js';
import {
  addPassenger,
  adultsOf,
  gridOf,
  isWheelchairNeed,
  passengerListKey,
  passengersOf,
  readPassengerSheet,
  savePassengerList,
  seatAllowed,
  seatNewPassengers,
  seatPassenger,
  seatPlacesOf,
  splitOf,
} from '../data/passengers.js';
import { StorageDown, putObject } from '../providers/storage.js';

export const seatRoutes: Route[] = [
  route(
    'POST',
    '/api/hires/:id/passengers/import',
    'session',
    async (ctx) => {
      const desk = requireDesk(ctx);
      const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
      const raw = await ctx.body(PASSENGER_FILE_LIMIT);
      if (!hasContentType(ctx, 'text/csv')) throw unsupportedMediaType();
      const reading = readPassengerSheet(raw.toString('utf8'));
      if (!reading.ok) throw invalid(reading.message);
      const listId = makeId('PL');
      const objectKey = passengerListKey(desk.id, hire.id, listId);
      try {
        await putObject(objectKey, raw, 'text/csv');
      } catch (trouble) {
        if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
        throw trouble;
      }
      await savePassengerList(desk.id, hire.id, listId, objectKey);
      for (const row of reading.rows) {
        await addPassenger(desk.id, hire.id, row);
      }
      await seatNewPassengers(desk.id, hire);
      const passengers = await passengersOf(desk.id, hire.id);
      ctx.json(201, {
        listId,
        objectKey,
        passengers: passengers.map(passengerJson),
      });
    },
    { limit: PASSENGER_FILE_LIMIT },
  ),

  route('POST', '/api/hires/:id/passengers', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') throw invalid(copy.enterName, { name: copy.enterName });
    const passenger = await addPassenger(desk.id, hire.id, {
      name,
      group: typeof body.group === 'string' ? body.group.trim() : '',
      needs: typeof body.needs === 'string' ? body.needs.trim() : '',
    });
    await seatNewPassengers(desk.id, hire);
    ctx.json(201, passengerJson({ ...passenger, listedTwice: false }));
  }),

  route('GET', '/api/hires/:id/passengers', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const passengers = await passengersOf(desk.id, hire.id);
    const adults = adultsOf(hire, passengers);
    ctx.json(200, {
      passengers: passengers.map(passengerJson),
      adultsNeeded: adults.adultsNeeded,
      adultsShort: adults.adultsShort,
    });
  }),

  route('GET', '/api/hires/:id/seats', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    ctx.json(200, await seatsAnswer(desk.id, hire));
  }),

  route('PUT', '/api/hires/:id/seats', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
    const vehicle = hire.vehicles.find((held) => held.id === vehicleId);
    if (!vehicle) throw invalid('Choose a vehicle.', { vehicleId: 'Choose a vehicle.' });
    const passengerId = typeof body.passengerId === 'string' ? body.passengerId : '';
    const passengers = await passengersOf(desk.id, hire.id);
    const passenger = passengers.find((held) => held.id === passengerId);
    if (!passenger) throw invalid('Choose a passenger.', { passengerId: 'Choose a passenger.' });
    const seat = typeof body.seat === 'string' ? body.seat.toUpperCase() : '';
    const allowed = seatAllowed(vehicle.seats, seat, passenger.wheelchair);
    if (allowed === 'unknownSeat') throw invalid('That seat is not on this vehicle.', { seat: 'That seat is not on this vehicle.' });
    if (allowed === 'wheelchairSeat') throw conflict('wheelchairSeat', copy.wheelchairSeats);
    const places = await seatPlacesOf(desk.id, hire.id);
    const sitting = places.find((place) => place.vehicleId === vehicleId && place.seat === seat);
    const mine = places.find((place) => place.passengerId === passengerId);
    if (sitting && sitting.passengerId !== passengerId) {
      const other = passengers.find((held) => held.id === sitting.passengerId);
      if (other && mine) {
        await seatPassenger(desk.id, hire.id, mine.vehicleId, mine.seat, other.id);
      }
      await seatPassenger(desk.id, hire.id, vehicleId, seat, passengerId);
      ctx.json(200, {
        ...(await seatsAnswer(desk.id, hire)),
        announcement: other && mine ? seatMoved(passenger.name, seat, other.name, mine.seat) : seatMoved(passenger.name, seat),
      });
      return;
    }
    await seatPassenger(desk.id, hire.id, vehicleId, seat, passengerId);
    ctx.json(200, { ...(await seatsAnswer(desk.id, hire)), announcement: seatMoved(passenger.name, seat) });
  }),

  route('GET', '/api/hires/:id/passengers/download', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const passengers = await passengersOf(desk.id, hire.id);
    const places = await seatPlacesOf(desk.id, hire.id);
    const rows = passengers.map((passenger) => {
      const place = places.find((held) => held.passengerId === passenger.id);
      const vehicle = hire.vehicles.find((held) => held.id === place?.vehicleId);
      return [
        passenger.name,
        passenger.group,
        passenger.needs,
        vehicle ? String(vehicle.seats) : '',
        place ? place.seat : '',
      ];
    });
    ctx.send(200, writeCsv(['Name', 'Group', 'Needs', 'Vehicle', 'Seat'], rows), {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition(`${hire.customer.name} passengers.csv`),
    });
  }),
];

function passengerJson(passenger: {
  id: string;
  name: string;
  group: string;
  needs: string;
  listedTwice: boolean;
}): Record<string, unknown> {
  return {
    id: passenger.id,
    name: passenger.name,
    group: passenger.group,
    needs: passenger.needs,
    listedTwice: passenger.listedTwice,
    wheelchair: isWheelchairNeed(passenger.needs),
  };
}

async function seatsAnswer(deskId: string, hire: Awaited<ReturnType<typeof loadHire>>): Promise<Record<string, unknown>> {
  const held = assertKnown(hire);
  const passengers = await passengersOf(deskId, held.id);
  const places = await seatPlacesOf(deskId, held.id);
  return {
    vehicles: held.vehicles.map((vehicle) => {
      const grid = gridOf(vehicle.seats, places, vehicle.id);
      const seated = grid
        .filter((cell) => cell.passengerId)
        .map((cell) => {
          const passenger = passengers.find((person) => person.id === cell.passengerId);
          return { passengerId: cell.passengerId as string, name: passenger?.name ?? '' };
        });
      return {
        id: vehicle.id,
        seats: vehicle.seats,
        grid,
        split: splitOf(vehicle.total, seated).map((line) => ({
          passengerId: line.passengerId,
          name: line.name,
          amount: moneyString(line.amount),
        })),
      };
    }),
  };
}
