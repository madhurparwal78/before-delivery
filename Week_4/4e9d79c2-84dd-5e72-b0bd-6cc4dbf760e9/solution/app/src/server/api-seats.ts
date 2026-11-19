import { one, pool, rows, transaction, type Db, only } from "./db.js";
import { csvFile, downloadHeaders, liftOn, parseDelimited, requireHire, seatLabels, splitAmong, vehiclesOf, WHEELCHAIR_SEATS, type VehicleMoney } from "./domain.js";
import { conflict, moneyText, newId, notFound, ok, refused, unavailable, route, type ApiRoute, type Ctx } from "./http.js";
import { ProviderDown, putObject } from "./providers.js";
import { FILE_STORE_DOWN } from "./api-operators.js";
import { foldName } from "../shared/rules.js";
import type { HireRow, PassengerRow } from "./records.js";

const PASSENGER_LIMIT = 1_000_000;
const WHEELCHAIR_COPY = "Wheelchair users sit only in 2A and 2B.";
const loadHire = (ctx: Ctx): Promise<HireRow> => requireHire(pool, ctx.desk!.id, ctx.params.id);

export const passengersOf = (db: Db, hireId: string): Promise<PassengerRow[]> => rows<PassengerRow>(db, "SELECT * FROM passengers WHERE hire_id=$1 ORDER BY position", [hireId]);
const passengerJson = (p: PassengerRow): Record<string, unknown> => ({ id: p.id, name: p.name, group: p.grp, needs: p.needs, listedTwice: p.listed_twice, wheelchair: p.wheelchair });
export const adultsLine = (hire: HireRow, passengers: PassengerRow[]): { adultsNeeded: number; adultsShort: number } => {
  if (hire.occasion !== "school") return { adultsNeeded: 0, adultsShort: 0 };
  const adults = passengers.filter((p) => p.grp === "Adult").length;
  const adultsNeeded = Math.ceil((passengers.length - adults) / 15);
  return { adultsNeeded, adultsShort: Math.max(adultsNeeded - adults, 0) };
};

const nextSeat = (vehicles: VehicleMoney[], taken: PassengerRow[], wheelchair: boolean): { vehicleId: string; seat: string } | null => {
  const free = (v: VehicleMoney, seat: string): boolean => !taken.some((p) => p.vehicle_id === v.id && p.seat === seat);
  if (wheelchair) {
    for (const v of vehicles.filter((x) => liftOn(x.seats))) for (const seat of WHEELCHAIR_SEATS) if (free(v, seat)) return { vehicleId: v.id, seat };
    return null;
  }
  for (const v of vehicles) for (const seat of seatLabels(v.seats)) if (free(v, seat) && !(liftOn(v.seats) && WHEELCHAIR_SEATS.includes(seat))) return { vehicleId: v.id, seat };
  for (const v of vehicles) for (const seat of WHEELCHAIR_SEATS) if (liftOn(v.seats) && free(v, seat)) return { vehicleId: v.id, seat };
  return null;
};
interface SeatVehicle { id: string; seats: number; grid: { seat: string; passengerId: string | null }[]; split: { passengerId: string; name: string; amount: string }[] }
const addPassenger = async (tx: Db, hireId: string, typed: { name: string; group: string; needs: string }): Promise<PassengerRow> => {
  const folded = [typed.name, typed.group, typed.needs].map(foldName).join("|");
  const existing = await one<PassengerRow>(tx, "SELECT * FROM passengers WHERE hire_id=$1 AND folded=$2", [hireId, folded]);
  if (existing) return only<PassengerRow>(tx, "UPDATE passengers SET listed_twice=true WHERE id=$1 RETURNING *", [existing.id]);
  const wheelchair = typed.needs.trim().toLowerCase() === "wheelchair";
  const place = nextSeat(await vehiclesOf(tx, hireId), await passengersOf(tx, hireId), wheelchair);
  return only<PassengerRow>(tx, "INSERT INTO passengers (id,hire_id,name,grp,needs,folded,wheelchair,vehicle_id,seat) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [newId("PX"), hireId, typed.name, typed.group, typed.needs, folded, wheelchair, place?.vehicleId ?? null, place?.seat ?? null]);
};
export const seatsJson = async (db: Db, hireId: string): Promise<{ vehicles: SeatVehicle[] }> => {
  const passengers = await passengersOf(db, hireId);
  return {
    vehicles: (await vehiclesOf(db, hireId)).map((v) => {
      const seated = passengers.filter((p) => p.vehicle_id === v.id);
      const amounts = seated.length ? splitAmong(v.total, seated.length) : [];
      return {
        id: v.id, seats: v.seats,
        grid: seatLabels(v.seats).map((seat) => ({ seat, passengerId: seated.find((p) => p.seat === seat)?.id ?? null })),
        split: seated.map((p, i) => ({ passengerId: p.id, name: p.name, amount: moneyText(amounts[i]) })),
      };
    }),
  };
};

export const seatRoutes: ApiRoute[] = [
  route({
    method: "POST", path: "/api/hires/:id/passengers/import", body: "csv", limit: PASSENGER_LIMIT, load: loadHire,
    run: async ({ raw, text, desk, loaded }) => {
      const body = text.replace(/^﻿/, "");
      const delimiter = (body.split(/\r?\n/)[0] ?? "").includes(";") ? ";" : ",";
      const lines = parseDelimited(body, delimiter);
      const header = (lines[0] ?? []).map((h) => h.trim().toLowerCase());
      const at = (name: string): number => header.indexOf(name);
      if (at("name") < 0) throw refused("The first line has to name a Name column.", "file");
      const data = lines.slice(1);
      if (data.length > 500) throw refused("This file has more than 500 rows.", "file");
      const listId = newId("PL");
      const objectKey = `desks/${desk!.id}/passengers/${loaded.id}/${listId}.csv`;
      try {
        await putObject(objectKey, raw, "text/csv");
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreDown", FILE_STORE_DOWN);
        throw error;
      }
      const passengers = await transaction(async (tx) => {
        await tx.query("SELECT id FROM hires WHERE id=$1 FOR UPDATE", [loaded.id]);
        await tx.query("INSERT INTO passenger_lists (id,hire_id,object_key) VALUES ($1,$2,$3)", [listId, loaded.id, objectKey]);
        const added = [];
        for (const cells of data) {
          const name = (cells[at("name")] ?? "").trim();
          if (name) added.push(await addPassenger(tx, loaded.id, { name, group: (cells[at("group")] ?? "").trim(), needs: (cells[at("needs")] ?? "").trim() }));
        }
        return added;
      });
      return ok({ listId, objectKey, passengers: passengers.map(passengerJson) }, 201);
    },
  }),
  route({
    method: "POST", path: "/api/hires/:id/passengers", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      if (typeof json.name !== "string" || !json.name.trim()) throw refused("Enter your name.", "name");
      const typed = { name: json.name.trim(), group: typeof json.group === "string" ? json.group.trim() : "", needs: typeof json.needs === "string" ? json.needs.trim() : "" };
      return transaction(async (tx) => {
        await tx.query("SELECT id FROM hires WHERE id=$1 FOR UPDATE", [loaded.id]);
        return ok(passengerJson(await addPassenger(tx, loaded.id, typed)), 201);
      });
    },
  }),
  route({
    method: "GET", path: "/api/hires/:id/passengers", load: loadHire,
    run: async ({ loaded }) => {
      const passengers = await passengersOf(pool, loaded.id);
      return ok({ passengers: passengers.map(passengerJson), ...adultsLine(loaded, passengers) });
    },
  }),
  route({ method: "GET", path: "/api/hires/:id/seats", load: loadHire, run: async ({ loaded }) => ok(await seatsJson(pool, loaded.id)) }),
  route({
    method: "PUT", path: "/api/hires/:id/seats", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      const vehicles = await vehiclesOf(pool, loaded.id);
      const vehicle = vehicles.find((v) => v.id === json.vehicleId);
      if (!vehicle) throw notFound();
      if (typeof json.seat !== "string" || !seatLabels(vehicle.seats).includes(json.seat)) throw refused("That seat does not exist.", "seat");
      return transaction(async (tx) => {
        await tx.query("SELECT id FROM hires WHERE id=$1 FOR UPDATE", [loaded.id]);
        const passengers = await passengersOf(tx, loaded.id);
        const person = passengers.find((p) => p.id === json.passengerId);
        if (!person) throw notFound();
        const occupant = passengers.find((p) => p.vehicle_id === vehicle.id && p.seat === json.seat && p.id !== person.id);
        const byTheLift = (where: VehicleMoney | undefined, seat: string | null): boolean => Boolean(where && liftOn(where.seats) && seat && WHEELCHAIR_SEATS.includes(seat));
        if (person.wheelchair && !byTheLift(vehicle, json.seat)) throw conflict("wheelchairSeat", WHEELCHAIR_COPY);
        if (occupant?.wheelchair && !byTheLift(vehicles.find((v) => v.id === person.vehicle_id), person.seat)) throw conflict("wheelchairSeat", WHEELCHAIR_COPY);
        if (occupant) await tx.query("UPDATE passengers SET vehicle_id=$2,seat=$3 WHERE id=$1", [occupant.id, person.vehicle_id, person.seat]);
        await tx.query("UPDATE passengers SET vehicle_id=$2,seat=$3 WHERE id=$1", [person.id, vehicle.id, json.seat]);
        return ok(await seatsJson(tx, loaded.id));
      });
    },
  }),
  route({
    method: "GET", path: "/api/hires/:id/passengers/download", load: loadHire,
    run: async ({ loaded }) => {
      const vehicles = await vehiclesOf(pool, loaded.id);
      const lines = (await passengersOf(pool, loaded.id)).map((p) => [p.name, p.grp, p.needs, vehicles.find((v) => v.id === p.vehicle_id)?.seats ?? "", p.seat ?? ""]);
      return { status: 200, raw: csvFile([["Name", "Group", "Needs", "Vehicle", "Seat"], ...lines]), headers: downloadHeaders(`${loaded.name} passengers.csv`, "text/csv; charset=utf-8") };
    },
  }),
];
