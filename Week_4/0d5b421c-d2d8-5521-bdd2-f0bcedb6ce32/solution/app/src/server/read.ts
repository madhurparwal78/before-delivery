// Read models: the slot list, the plan, tonight's captions and the host floor. All derive from one occupancy read.
import type {
  AvailabilityResponse, HostFloorResponse, HostTable, PlanResponse, TonightResponse,
} from "../shared/api.js";
import { catalog, type Room } from "./catalog.js";
import { addMinutes, instantIso, now } from "./clock.js";
import { pool, rows } from "./db.js";
import { fitsParty, eligibleTargets, planStatuses } from "./domain/fit.js";
import { coversFree, loadOccupancy, type Occupancy } from "./domain/occupancy.js";
import { currentSlot, nextBookableSlot, slotAvailability, slotTimes } from "./domain/slots.js";
import { SLOT_MINUTES, turnWindow } from "./domain/turn.js";
import { isoWithLisbonOffset, lisbonDate, slotInstant } from "./lisbon.js";
import { BOOKING_COLUMNS, toBooking, type BookingRow } from "./records.js";
import { MESSAGES, parseDate, parsePartyQuery, parseSlot, rejectInvalid } from "./validation.js";

const LONGEST_WINDOW_MINUTES = 150 + 15;

/** Occupancy for the whole evening of a date, including windows that run past the last slot. */
async function eveningOccupancy(date: string, at: Date): Promise<Occupancy> {
  const times = slotTimes();
  const first = slotInstant(date, times[0] ?? "");
  const last = slotInstant(date, times[times.length - 1] ?? "");
  return loadOccupancy(pool, first, addMinutes(last, SLOT_MINUTES + LONGEST_WINDOW_MINUTES), at);
}

export async function availability(query: URLSearchParams): Promise<AvailabilityResponse> {
  const at = now();
  const date = parseDate(query.get("date"), at);
  const party = parsePartyQuery(query.get("party"));
  if (date === null || party === null) throw rejectInvalid({ date: [date, MESSAGES.date], party: [party, MESSAGES.party] });
  const occupancy = await eveningOccupancy(date, at);
  return {
    date,
    party_size: party,
    server_now: instantIso(at),
    slots: slotTimes().map((time) => {
      const startsAt = slotInstant(date, time);
      const covers = coversFree(occupancy, startsAt);
      return {
        time,
        starts_at: isoWithLisbonOffset(startsAt),
        ...slotAvailability(startsAt, at),
        covers_free: covers.total,
        rooms: covers.rooms.map((room) => ({ room_id: room.roomId, covers_free: room.coversFree })),
        eligible_tables: eligibleTargets(occupancy, party, startsAt).length,
      };
    }),
  };
}

export async function plan(query: URLSearchParams): Promise<PlanResponse> {
  const at = now();
  const date = parseDate(query.get("date"), at);
  const time = parseSlot(query.get("time"));
  const party = parsePartyQuery(query.get("party"));
  if (date === null || time === null || party === null) {
    throw rejectInvalid({ date: [date, MESSAGES.date], time: [time, MESSAGES.time], party: [party, MESSAGES.party] });
  }
  const startsAt = slotInstant(date, time);
  const window = turnWindow(party, startsAt);
  const statuses = planStatuses(await loadOccupancy(pool, window.start, window.end, at), party, startsAt);
  return {
    date,
    time,
    party_size: party,
    tables: catalog().tables.map((table) => ({
      table_id: table.tableId,
      room_id: table.roomId,
      min_seats: table.minSeats,
      max_seats: table.maxSeats,
      status: statuses.get(table.tableId) ?? "not_for_party",
    })),
    pairs: party >= 7 ? catalog().targets.filter((target) => target.tableIds.length > 1).map((pair) => ({ pair_id: pair.targetId, status: statuses.get(pair.targetId) ?? "not_for_party" })) : [],
  };
}

export async function tonight(): Promise<TonightResponse> {
  const at = now();
  const date = lisbonDate(at);
  const next = nextBookableSlot(at);
  const occupancy = await eveningOccupancy(date, at);
  const bookable = slotTimes().filter((time) => slotAvailability(slotInstant(date, time), at).bookable);
  const nextTableForTwo = (room: Room): string | null =>
    bookable.find((time) => {
      const window = turnWindow(2, slotInstant(date, time));
      return catalog().targets.some(
        (target) => target.roomId === room.roomId && target.tableIds.length === 1 && fitsParty(target, 2) && occupancy.isFree(target, window),
      );
    }) ?? null;
  const covers = next === null ? null : coversFree(occupancy, slotInstant(date, next));
  return {
    date,
    server_now: instantIso(at),
    next_slot: next,
    rooms: catalog().rooms.map((room) => ({
      room_id: room.roomId,
      name: room.name,
      seats: room.seats,
      covers_free_at_next_slot: covers?.rooms.find((candidate) => candidate.roomId === room.roomId)?.coversFree ?? null,
      next_table_for_two: nextTableForTwo(room),
    })),
  };
}

export async function hostFloor(query: URLSearchParams): Promise<HostFloorResponse> {
  const at = now();
  const requested = query.get("time");
  if (requested !== null && parseSlot(requested) === null) throw rejectInvalid({ time: [null, MESSAGES.time] });
  const date = lisbonDate(at);
  const time = requested ?? currentSlot(at);
  const instant = slotInstant(date, time);
  const occupancy = await loadOccupancy(pool, instant, addMinutes(instant, 1), at);
  const references = occupancy.occupations.flatMap((occupation) =>
    occupation.occupant.kind === "booking" ? [occupation.occupant.reference] : [],
  );
  const bookings = new Map(
    (references.length === 0
      ? []
      : await rows<BookingRow>(pool, `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE reference = ANY($1)`, [references])
    ).map((row) => [row.reference, toBooking(row)]),
  );
  const covers = coversFree(occupancy, instant);
  const tables = catalog().tables.map((table): HostTable => {
    const occupation = occupancy.at(table.tableId, instant);
    const occupant = occupation?.occupant;
    const partner = occupation?.tableIds.find((tableId) => tableId !== table.tableId) ?? null;
    return {
      table_id: table.tableId,
      room_id: table.roomId,
      status: occupant === undefined ? "free" : occupant.kind === "booking" ? occupant.status : occupant.kind === "hold" ? "held" : "offered",
      joined_with: partner,
      hold: occupant?.kind === "hold" ? { party_size: occupant.partySize, expires_at: instantIso(occupant.expiresAt) } : null,
      offer: occupant?.kind === "offer" ? { expires_at: instantIso(occupant.expiresAt) } : null,
      booking: occupant?.kind === "booking" ? (bookings.get(occupant.reference) ?? null) : null,
    };
  });
  return {
    date,
    time,
    server_now: instantIso(at),
    totals: {
      covers_free: covers.total,
      rooms: covers.rooms.map((room) => ({ room_id: room.roomId, name: room.name, seats: room.seats, covers_free: room.coversFree })),
    },
    tables,
  };
}
