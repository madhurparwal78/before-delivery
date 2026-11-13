import { brusselsInstant, isoBrussels } from "../../shared/time";
import { now } from "../clock";
import type { TxHandle } from "../db";

import { createRecords, type RecordsSpec } from "./records";

const at = (year: number, month: number, day: number, hour: number, minute: number): string => isoBrussels(brusselsInstant(year, month, day, hour, minute));

/** The demo network of the brief, written once when the database has no members. */
export async function seedDemoNetwork(db: TxHandle): Promise<void> {
  const existing = await db.query("SELECT 1 FROM members LIMIT 1");
  if (existing.rows.length) return;
  const member = (key: string, name: string, roles: ("driver" | "passenger" | "founder")[], idState: "none" | "verified", wallet: number) =>
    ({ key, display_name: name, email: `${key}@longseat.test`, roles, id_state: idState, wallet_cents: wallet, photo: false });
  const spec: RecordsSpec = {
    members: [
      member("founder", "Wren Halloway", ["founder"], "none", 0),
      member("mara", "Mara Quell", ["driver", "passenger"], "verified", 0),
      member("idris", "Idris Penhallow", ["driver", "passenger"], "verified", 0),
      member("lune", "Lune Ostrander", ["driver", "passenger"], "none", 6000),
      member("tobin", "Tobin Areck", ["driver", "passenger"], "none", 4000),
    ],
    vehicles: [
      { key: "rowan", owner: "mara", make_model: "Rowan Estate", colour: "Slate grey", seats: 3 },
      { key: "fenwick", owner: "idris", make_model: "Fenwick Compact", colour: "Moss green", seats: 4 },
    ],
    rides: [
      { key: "ride1", driver: "mara", vehicle: "rowan", stops: ["Kestrevel", "Brisanne", "Oakhythe", "Tollemarch"], departure: at(2027, 1, 16, 8, 30), seats: 3, price_cents: 2150, booking_mode: "instant", state: "published" },
      { key: "ride2", driver: "idris", vehicle: "fenwick", stops: ["Vardholm", "Kestrevel", "Hesketh Mere"], departure: at(2027, 1, 16, 14, 0), seats: 4, price_cents: 1500, booking_mode: "request", state: "published" },
      { key: "ride3", driver: "mara", vehicle: "rowan", stops: ["Tollemarch", "Corrandy", "Saint Ivrel"], departure: at(2027, 1, 17, 17, 15), seats: 3, price_cents: 2000, booking_mode: "instant", state: "published" },
    ],
    bookings: [{ key: "lune-ride1", ride: "ride1", passenger: "lune", boarding: "Kestrevel", alighting: "Brisanne", seats: 1, state: "confirmed", created_at: isoBrussels(now()) }],
  };
  await createRecords(db, spec, { sessions: false });
}
