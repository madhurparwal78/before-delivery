import { z } from "zod";
import type { RegistrationView, RotaHeat } from "../../shared/api.js";
import { rotaOpen } from "../../shared/lifecycle.js";
import { type ClubAuth, can, requireRole } from "../auth.js";
import { type Db, isUniqueViolation, one, pool, rows, transaction } from "../db.js";
import { ApiError } from "../errors.js";
import { deliver, queueDelivery } from "../services/outbox.js";
import { parse, wholeNumber } from "../validate.js";
import { findEvent, reportedStatus } from "./events.js";
import { findRegistration, registrationView } from "./registrations.js";

interface StationRow {
  id: number;
  event_id: number;
  heat: number;
  name: string;
  worker_registration_id: number | null;
}

interface RotaRow {
  heat: number;
  id: number;
  name: string;
  worker: { registrationId: number; driverName: string; carNumber: number; classCode: string } | null;
}

export async function loadRota(db: Db, eventId: number): Promise<RotaHeat[]> {
  const found = await rows<RotaRow>(
    db,
    `select s.heat, s.id, s.name,
            case when r.id is null then null
                 else jsonb_build_object('registrationId', r.id, 'driverName', u.name, 'carNumber', r.car_number, 'classCode', r.class_code) end as worker
       from stations s
       left join registrations r on r.id = s.worker_registration_id
       left join users u on u.id = r.user_id
      where s.event_id = $1 order by s.heat, s.position`,
    [eventId],
  );
  const heats = new Map<number, RotaHeat>();
  for (const row of found) {
    const heat = heats.get(row.heat) ?? { number: row.heat, unfilled: 0, stations: [] };
    heat.stations.push({ id: row.id, name: row.name, worker: row.worker });
    if (row.worker === null) heat.unfilled += 1;
    heats.set(row.heat, heat);
  }
  return [...heats.values()];
}

async function findStation(db: Db, auth: ClubAuth, id: number): Promise<StationRow> {
  const row = await one<StationRow>(
    db,
    `select s.id, s.event_id, s.heat, s.name, s.worker_registration_id
       from stations s join events e on e.id = s.event_id
      where s.id = $1 and e.club_id = $2 for update of s`,
    [id, auth.club.id],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

/** Put a registration on a station, judging the rota rules in their published order. */
async function seat(db: Db, station: StationRow, registrationId: number | null): Promise<number> {
  const registration =
    registrationId === null
      ? null
      : await one<{ id: number; run_heat: number }>(
          db,
          "select id, run_heat from registrations where id = $1 and event_id = $2",
          [registrationId, station.event_id],
        );
  if (!registration) throw new ApiError("not_registered");
  if (await one(db, "select 1 from stations where worker_registration_id = $1", [registration.id])) {
    throw new ApiError("already_assigned");
  }
  if (registration.run_heat === station.heat) {
    throw new ApiError("own_heat", `You drive in heat ${station.heat}. Pick a station in another heat.`);
  }
  if (station.worker_registration_id !== null) throw new ApiError("station_taken");
  try {
    await db.query("update stations set worker_registration_id = $2 where id = $1", [station.id, registration.id]);
  } catch (error) {
    if (isUniqueViolation(error, "stations_worker_key")) throw new ApiError("already_assigned");
    throw error;
  }
  return registration.id;
}

async function announce(db: Db, auth: ClubAuth, station: StationRow, registrationId: number): Promise<number> {
  const event = await findEvent(db, auth.club.id, station.event_id);
  const worker = await findRegistration(db, auth, registrationId);
  return queueDelivery(db, {
    kind: "assignment",
    registrationId,
    recipient: worker.driver_email,
    subject: `Work assignment for ${event.name}: ${station.name}, heat ${station.heat}`,
    body: [
      `Hello ${worker.driver_name},`,
      "",
      `You are working ${station.name} in heat ${station.heat} at ${event.name} on ${event.date}.`,
    ].join("\n"),
  });
}

export interface Seated {
  station: StationRow;
  registration: RegistrationView;
  assignmentEmail: "sent" | "pending";
}

export async function claim(auth: ClubAuth, stationId: number): Promise<Seated> {
  const seated = await transaction(async (db) => {
    const station = await findStation(db, auth, stationId);
    const event = await findEvent(db, auth.club.id, station.event_id);
    if (!rotaOpen(reportedStatus(event, new Date()))) throw new ApiError("rota_locked");
    const mine = await one<{ id: number }>(db, "select id from registrations where event_id = $1 and user_id = $2", [
      station.event_id,
      auth.userId,
    ]);
    const registrationId = await seat(db, station, mine?.id ?? null);
    return { station, registrationId, deliveryId: await announce(db, auth, station, registrationId) };
  });
  const sent = await deliver(seated.deliveryId);
  return {
    station: seated.station,
    registration: await registrationView(pool, seated.registrationId),
    assignmentEmail: sent ? "sent" : "pending",
  };
}

const assignSchema = z.object({ registrationId: wholeNumber("Driver", 1, 2_147_483_647) });

export async function assign(auth: ClubAuth, stationId: number, body: unknown): Promise<Seated> {
  const seated = await transaction(async (db) => {
    const station = await findStation(db, auth, stationId);
    requireRole(auth, "workers");
    const event = await findEvent(db, auth.club.id, station.event_id);
    if (!rotaOpen(reportedStatus(event, new Date()))) throw new ApiError("rota_locked");
    const { registrationId } = parse(assignSchema, body);
    const seatedId = await seat(db, station, registrationId);
    return { station, registrationId: seatedId, deliveryId: await announce(db, auth, station, seatedId) };
  });
  const sent = await deliver(seated.deliveryId);
  return {
    station: seated.station,
    registration: await registrationView(pool, seated.registrationId),
    assignmentEmail: sent ? "sent" : "pending",
  };
}

export async function release(auth: ClubAuth, stationId: number): Promise<void> {
  await transaction(async (db) => {
    const station = await findStation(db, auth, stationId);
    const worker =
      station.worker_registration_id === null
        ? null
        : await one<{ user_id: number }>(db, "select user_id from registrations where id = $1", [
            station.worker_registration_id,
          ]);
    if (!can(auth, "workers") && worker?.user_id !== auth.userId) throw new ApiError("forbidden");
    const event = await findEvent(db, auth.club.id, station.event_id);
    if (!rotaOpen(reportedStatus(event, new Date()))) throw new ApiError("rota_locked");
    if (station.worker_registration_id === null) throw new ApiError("station_open");
    await db.query("update stations set worker_registration_id = null where id = $1", [stationId]);
  });
}
