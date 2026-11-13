// The store seeds itself once, when it is first created. D0 is the port-local creation date.
import { randomBytes } from "node:crypto";
import { addDays, instantOfLocal, MINUTE_MS, portDate, portMinute, portStamp, STEP_MINUTES } from "../shared/portTime.js";
import type { HistoryEntry, MoveStatus, Role } from "../shared/types.js";
import type { App } from "./app.js";
import { raiseBillingEvent } from "./domain/billing.js";
import { gateAt } from "./domain/plan.js";
import type { MoveRecord, VesselRecord } from "./store.js";
import { hashSecret } from "./routes/session.js";

const SEED_SECRET = "Slackwater-2026";

const PEOPLE: { id: string; email: string; name: string; role: Role; agency_code: string | null }[] = [
  { id: "D-1", email: "dispatch1@ebbstone.example", name: "Hana Lindqvist", role: "dispatcher", agency_code: null },
  { id: "D-2", email: "dispatch2@ebbstone.example", name: "Callum Adeyemi", role: "dispatcher", agency_code: null },
  { id: "C-1", email: "accounts@ebbstone.example", name: "Rosalind Pike", role: "clerk", agency_code: null },
  { id: "A-CORV", email: "agent@corvane.example", name: "Dario Veitch", role: "agent", agency_code: "CORV" },
  { id: "A-TIDE", email: "agent@tidewell.example", name: "Mina Sorrell", role: "agent", agency_code: "TIDE" },
];

const PILOTS: [string, string, string][] = [
  ["P-01", "Maren Holt", "A"],
  ["P-02", "Tobias Reyne", "B"],
  ["P-03", "Anneke Dwyer", "C"],
  ["P-04", "Ruairi Banks", "A"],
  ["P-05", "Owen Castellane", "B"],
  ["P-06", "Nadia Ferreira", "B"],
  ["P-07", "Idris Mallory", "B"],
  ["P-08", "Keziah Tran", "C"],
  ["P-09", "Lucan Ward", "A"],
  ["P-10", "Petra Solis", "C"],
];

const VESSELS: VesselRecord[] = [
  { id: "V-01", name: "Tern Arrow", imo: "9700011", agency_code: "CORV", length_m: 229, gross_tonnage: 43500, block_coefficient: 0.8, speed_kn: 10, draught_mm: 11200 },
  { id: "V-02", name: "Kestrel Bay", imo: "9700023", agency_code: "CORV", length_m: 148, gross_tonnage: 12400, block_coefficient: 0.72, speed_kn: 9, draught_mm: 7600 },
  { id: "V-03", name: "Halcyon Reef", imo: "9700035", agency_code: "TIDE", length_m: 190, gross_tonnage: 28900, block_coefficient: 0.78, speed_kn: 10, draught_mm: 9800 },
  { id: "V-04", name: "Marram Light", imo: "9700047", agency_code: "TIDE", length_m: 289, gross_tonnage: 71200, block_coefficient: 0.82, speed_kn: 9, draught_mm: 12900 },
  { id: "V-05", name: "Sable Quay", imo: "9700059", agency_code: "TIDE", length_m: 262, gross_tonnage: 64800, block_coefficient: 0.76, speed_kn: 8, draught_mm: 11400 },
];

const PROGRESSION: MoveStatus[] = ["Ordered", "Window committed", "Pilot assigned", "Pilot away", "On board", "Completed"];

interface SeedMove {
  ref: string;
  vessel: string;
  status: MoveStatus;
  boarding: number;
  pilot: string | null;
  duty: number;
}

/** Seeds people, vessels, pilots, duties, the first tariff revision and ten moves, once. */
export function seed(app: App, now: number): void {
  const { store } = app;
  if (store.meta("created_at")) return;
  store.transaction(() => {
    store.setMeta("created_at", String(now));
    store.setMeta("tide_version", "1");
    const d0 = portDate(now);
    const at = (shift: number, hhmm: string): number => {
      const [h, m] = hhmm.split(":").map(Number) as [number, number];
      return instantOfLocal(addDays(d0, shift), h * 60 + m) ?? now;
    };
    const stamp = portStamp(now);

    for (const person of PEOPLE) {
      const salt = randomBytes(16).toString("hex");
      store.users.put({ ...person, salt, hash: hashSecret(SEED_SECRET, salt) });
    }
    store.agencies.put({ code: "CORV", name: "Corvane Shipping Agency", agent_email: "agent@corvane.example", killbill_account_id: null });
    store.agencies.put({ code: "TIDE", name: "Tidewell Agencies", agent_email: "agent@tidewell.example", killbill_account_id: null });
    VESSELS.forEach((v) => store.vessels.put(v));
    PILOTS.forEach(([id, name, licence], index) => {
      store.pilots.put({ id, name, licence_class: licence, position: index + 1 });
      const salt = randomBytes(16).toString("hex");
      const email = `p${id.slice(2)}@ebbstone.example`;
      store.users.put({ id, email, name, role: "pilot", agency_code: null, salt, hash: hashSecret(SEED_SECRET, salt) });
    });

    const seededDuty = (pilot: string, start: number, minutes: number): void => {
      store.duties.put({ id: `DU-seed-${store.next("seed-duty")}`, pilot_id: pilot, move_ref: null, start, end: start + minutes * MINUTE_MS });
    };
    for (let shift = -14; shift <= 0; shift += 1) seededDuty("P-05", at(shift, "09:00"), 60);
    for (const shift of [1, 2, 3]) seededDuty("P-06", at(shift, "23:00"), 300);
    seededDuty("P-07", at(2, "08:00"), 480);

    store.tariffRevisions.put({
      id: `TR-${store.next("tariff")}`,
      label: "T-2026-A",
      effective_at: "2026-01-01T00:00",
      effective_instant: instantOfLocal("2026-01-01", 0) ?? 0,
      draft_foot_cents: 4250,
      minimum_cents: 200000,
      tonnage_bands: [
        { from_gt: 0, to_gt: 9999, cents: 48000 },
        { from_gt: 10000, to_gt: 29999, cents: 86000 },
        { from_gt: 30000, to_gt: 59999, cents: 134000 },
        { from_gt: 60000, to_gt: null, cents: 192500 },
      ],
      night_percent: 25,
      detention_half_hour_cents: 16500,
      detention_allowance_half_hours: 1,
      cancellation_cents: 38000,
    });

    const creation = Math.floor(now / (STEP_MINUTES * MINUTE_MS)) * STEP_MINUTES * MINUTE_MS;
    const moves: SeedMove[] = [
      { ref: "MV-1001", vessel: "V-01", status: "Ordered", boarding: at(2, "06:00"), pilot: null, duty: 360 },
      { ref: "MV-1002", vessel: "V-02", status: "Ordered", boarding: at(2, "12:00"), pilot: null, duty: 240 },
      { ref: "MV-1003", vessel: "V-03", status: "Window committed", boarding: at(2, "05:30"), pilot: null, duty: 300 },
      { ref: "MV-1004", vessel: "V-05", status: "Pilot assigned", boarding: at(2, "05:00"), pilot: "P-04", duty: 300 },
      { ref: "MV-1005", vessel: "V-02", status: "Pilot away", boarding: at(1, "08:00"), pilot: "P-10", duty: 240 },
      { ref: "MV-1006", vessel: "V-03", status: "On board", boarding: creation - 60 * MINUTE_MS, pilot: "P-02", duty: 300 },
      { ref: "MV-1007", vessel: "V-01", status: "On board", boarding: creation - 60 * MINUTE_MS, pilot: "P-09", duty: 300 },
      { ref: "MV-1008", vessel: "V-02", status: "On board", boarding: creation - 60 * MINUTE_MS, pilot: "P-08", duty: 240 },
      { ref: "MV-1009", vessel: "V-01", status: "Completed", boarding: at(-1, "05:30"), pilot: "P-09", duty: 300 },
      { ref: "MV-1010", vessel: "V-03", status: "Completed", boarding: at(-1, "14:00"), pilot: "P-02", duty: 300 },
    ];
    const names = { agent: { CORV: "Dario Veitch", TIDE: "Mina Sorrell" } as Record<string, string>, dispatcher: "Hana Lindqvist" };

    for (const seedMove of moves) {
      const vessel = VESSELS.find((v) => v.id === seedMove.vessel) as VesselRecord;
      const pilot = PILOTS.find(([id]) => id === seedMove.pilot);
      const reached = PROGRESSION.slice(0, PROGRESSION.indexOf(seedMove.status) + 1);
      const history: HistoryEntry[] = reached.map((status) => ({
        at: stamp,
        status,
        by: status === "Ordered" ? (names.agent[vessel.agency_code] ?? "") : ["Window committed", "Pilot assigned"].includes(status) ? names.dispatcher : (pilot?.[1] ?? ""),
      }));
      const subject = { draught_mm: vessel.draught_mm, speed_kn: vessel.speed_kn, block_coefficient: vessel.block_coefficient, gross_tonnage: vessel.gross_tonnage };
      const gate = seedMove.status === "Ordered" ? null : gateAt(store, subject, seedMove.boarding);
      const pinch = gate?.waypoints.find((w) => w.id === gate.pinch.waypoint_id);
      const boardingAt = portMinute(seedMove.boarding);
      const move: MoveRecord = {
        ref: seedMove.ref,
        seq: Number(seedMove.ref.slice(3)),
        version: 1,
        status: seedMove.status,
        agency_code: vessel.agency_code,
        vessel: { id: vessel.id, name: vessel.name, imo: vessel.imo, length_m: vessel.length_m, gross_tonnage: vessel.gross_tonnage, block_coefficient: vessel.block_coefficient },
        draught_mm: vessel.draught_mm,
        speed_kn: vessel.speed_kn,
        duty_minutes: seedMove.duty,
        boarding_at: boardingAt,
        committed: gate && pinch ? { boarding_at: boardingAt, pinch_waypoint: pinch.name, margin_mm: gate.pinch.margin_mm, tide_version: 1 } : null,
        pilot_id: seedMove.pilot,
        pilots_ever: seedMove.pilot ? [seedMove.pilot] : [],
        late_amendments: 0,
        detention: [],
        history,
        dispatcher_notes: [],
        rest_override: null,
        ladder_reports: [],
      };
      if (seedMove.pilot) {
        store.duties.put({ id: `DU-${move.ref}`, pilot_id: seedMove.pilot, move_ref: move.ref, start: seedMove.boarding, end: seedMove.boarding + seedMove.duty * MINUTE_MS });
      }
      store.moves.put(seedMove.status === "Completed" ? raiseBillingEvent(app, move, "Completed", seedMove.boarding + seedMove.duty * MINUTE_MS) : move);
    }
  });
}
