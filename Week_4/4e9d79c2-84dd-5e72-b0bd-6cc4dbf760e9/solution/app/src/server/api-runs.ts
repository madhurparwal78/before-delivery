import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import { hoursOf, spreadMinutes, type Block } from "./hours.js";
import { halfUp, rateById, vehicleTotals, writeMovement } from "./domain.js";
import { ApiError, conflict, fieldErrors, instantText, moneyText, newId, newToken, notFound, ok, refused, unavailable, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { flightStatus, ProviderDown, pushToDriver } from "./providers.js";
import { localJson, stopsOf } from "./api-enquiries.js";
import { foldTelephone, isUkTelephone, missingHourGuard } from "../shared/rules.js";
import { addDays, clockChangeLabel, hoursInDay, longDate, mondayOfIsoWeek, isoWeekOf, toInstant, ukDate, ukTime, type LocalDateTime } from "../shared/time.js";
import { sheetCopy } from "../shared/strings.js";
import type { HireRow, StopRow, VehicleRow, RunRow, FlightRow, PressRow, AcceptedChargeRow } from "./records.js";

const PHONE_DOWN = "We couldn't reach the driver's phone. Nothing was marked as told.";
const DEFAULT_DUTY_MINUTES = 60;

/** One run per vehicle that has none, numbered per desk. */
export const createRuns = async (tx: Db, deskId: string, hireId: string): Promise<void> => {
  const vehicles = await rows<{ id: string }>(tx, "SELECT v.id FROM vehicles v LEFT JOIN runs r ON r.vehicle_id=v.id WHERE v.hire_id=$1 AND r.id IS NULL ORDER BY v.position", [hireId]);
  for (const v of vehicles) {
    const desk = await only<{ next_run: number }>(tx, "UPDATE desks SET next_run=next_run+1 WHERE id=$1 RETURNING next_run", [deskId]);
    await tx.query("INSERT INTO runs (id,desk_id,number,hire_id,vehicle_id,token) VALUES ($1,$2,$3,$4,$5,$6)", [newId("RN"), deskId, desk.next_run - 1, hireId, v.id, newToken()]);
  }
};

const shortStop = (text: string): string => text.split(",")[0];
const tellMessage = (run: RunRow, vehicle: VehicleRow, stops: StopRow[], changed: boolean): string =>
  `Run ${run.number}${changed ? " changed" : ""}: ${vehicle.depart_time} ${longDate(vehicle.depart_date)}, ${shortStop(stops[0].text)}.`;

const runVehicle = (db: Db, run: RunRow): Promise<VehicleRow> => only<VehicleRow>(db, "SELECT * FROM vehicles WHERE id=$1", [run.vehicle_id]);

/** Pushes one message and marks the run told only after ntfy has accepted it. */
const tellDriver = async (run: RunRow, changed: boolean): Promise<RunRow> => {
  const vehicle = await runVehicle(pool, run);
  const stops = await stopsOf(pool, run.hire_id);
  try {
    await pushToDriver(run.telephone_folded as string, `Run ${run.number}`, tellMessage(run, vehicle, stops, changed));
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    await pool.query("UPDATE runs SET told_at=NULL WHERE id=$1", [run.id]);
    throw unavailable("driverUnreachable", PHONE_DOWN);
  }
  return only<RunRow>(pool, "UPDATE runs SET told_at=$2 WHERE id=$1 RETURNING *", [run.id, nowSeconds()]);
};
export const tellDriverOfChange = async (hireId: string): Promise<void> => {
  for (const run of await rows<RunRow>(pool, "SELECT * FROM runs WHERE hire_id=$1 AND told_at IS NOT NULL", [hireId])) await tellDriver(run, true).catch(() => undefined);
};

const PRESS_ORDER = ["arrived", "boarded", "left", "comfortStop", "backOnTheRoad"] as const;
type PressKind = (typeof PRESS_ORDER)[number];
const FREE_MINUTES = 15;
const AIRPORT_FREE_MINUTES = 60;
const chargeFor = (minutes: number, free: number, ratePerHour: number): number => (minutes > free ? halfUp((minutes - free) * ratePerHour, 60) : 0);

/** Waiting and comfort-stop charges, worked out at each read from the presses. */
export const chargesOf = async (db: Db, run: RunRow): Promise<{ stopId: string; kind: string; minutes: number; amount: number; accepted: boolean }[]> => {
  const hire = await only<Pick<HireRow, "rate_table_id">>(db, "SELECT rate_table_id FROM hires WHERE id=$1", [run.hire_id]);
  const rates = await rateById(db, hire.rate_table_id as string);
  const vehicle = await runVehicle(db, run);
  const presses = await rows<Pick<PressRow, "stop_id" | "kind" | "at">>(db, "SELECT stop_id,kind,at FROM presses WHERE run_id=$1", [run.id]);
  const flights = await rows<FlightRow>(db, "SELECT * FROM run_flights WHERE run_id=$1", [run.id]);
  const accepted = await rows<AcceptedChargeRow>(db, "SELECT * FROM accepted_charges WHERE run_id=$1", [run.id]);
  const out = [];
  for (const stop of await stopsOf(db, run.hire_id)) {
    const at = (kind: string): number | undefined => presses.find((p) => p.stop_id === stop.id && p.kind === kind)?.at;
    const boarded = at("boarded");
    const arrived = at("arrived");
    const flight = flights.find((f) => f.stop_id === stop.id);
    if (arrived !== undefined && boarded !== undefined) {
      const from = flight ? flight.landed_at ?? vehicle.depart_instant : arrived;
      const minutes = Math.max(Math.floor((boarded - from) / 60), 0);
      const amount = chargeFor(minutes, flight ? AIRPORT_FREE_MINUTES : FREE_MINUTES, rates.waiting_rate);
      if (amount > 0) out.push({ stopId: stop.id, kind: "waiting", minutes, amount, accepted: false });
    }
    const paused = at("comfortStop");
    const back = at("backOnTheRoad");
    if (paused !== undefined && back !== undefined) {
      const minutes = Math.floor((back - paused) / 60);
      const amount = chargeFor(minutes, FREE_MINUTES, rates.waiting_rate);
      if (amount > 0) out.push({ stopId: stop.id, kind: "comfortStop", minutes, amount, accepted: false });
    }
  }
  return out.map((c) => {
    const done = accepted.find((a) => a.stop_id === c.stopId && a.kind === c.kind);
    return done ? { ...c, minutes: done.minutes, amount: done.pennies, accepted: true } : c;
  });
};

const runJson = async (db: Db, run: RunRow): Promise<Record<string, unknown>> => {
  const vehicle = await runVehicle(db, run);
  const flights = await rows<Pick<FlightRow, "stop_id" | "code">>(db, "SELECT stop_id,code FROM run_flights WHERE run_id=$1", [run.id]);
  const charges = await chargesOf(db, run);
  return {
    id: run.id, number: run.number, hireId: run.hire_id, vehicleId: run.vehicle_id, seats: vehicle.seats, driver: run.driver_name ? { name: run.driver_name, telephone: run.driver_telephone } : null,
    toldAt: instantText(run.told_at), confirmed: run.confirmed, sheetPath: `/r/${run.token}`, departAt: localJson(vehicle.depart_date, vehicle.depart_time, vehicle.depart_repeated), departInstant: instantText(vehicle.depart_instant),
    secondDriver: run.second_driver, stops: (await stopsOf(db, run.hire_id)).map((s) => ({ id: s.id, text: s.text, flightCode: flights.find((f) => f.stop_id === s.id)?.code ?? null })),
    charges: charges.map((c) => ({ stopId: c.stopId, kind: c.kind, minutes: c.minutes, amount: moneyText(c.amount), accepted: c.accepted })), chargesTotal: moneyText(charges.reduce((a, c) => a + c.amount, 0)),
  };
};
const loadRun = async (ctx: Ctx): Promise<RunRow> => {
  const run = await one<RunRow>(pool, "SELECT * FROM runs WHERE id=$1 AND desk_id=$2", [ctx.params.id, ctx.desk!.id]);
  if (!run) throw notFound();
  return run;
};
const dutySpan = async (db: Db, run: RunRow): Promise<{ start: number; end: number }> => {
  const vehicle = await runVehicle(db, run);
  const start = run.duty_start ?? vehicle.depart_instant;
  return { start, end: start + (run.blocks.length ? spreadMinutes(run.blocks) : DEFAULT_DUTY_MINUTES) * 60 };
};
/** A driver is on one run at a time. */
const clashRefusal = async (db: Db, deskId: string, runId: string, telephoneFolded: string | null, span: { start: number; end: number }): Promise<ApiError | null> => {
  if (!telephoneFolded) return null;
  const others = await rows<RunRow>(db, "SELECT * FROM runs WHERE desk_id=$1 AND telephone_folded=$2 AND id<>$3", [deskId, telephoneFolded, runId]);
  for (const other of others) {
    const theirs = await dutySpan(db, other);
    if (span.start < theirs.end && theirs.start < span.end) return conflict("driverClash", `That driver is already on Run ${other.number} at ${ukTime(theirs.start)}.`);
  }
  return null;
};
export const hoursRead = (run: RunRow): ReturnType<typeof hoursOf> => hoursOf(pool, run.desk_id, run);
/** Would this run's duty, moved to a new departure, overlap its driver's other run? */
export const clashAtDeparture = (db: Db, run: RunRow, at: LocalDateTime): Promise<ApiError | null> => {
  const start = toInstant(at);
  return clashRefusal(db, run.desk_id, run.id, run.telephone_folded, { start, end: start + (run.blocks.length ? spreadMinutes(run.blocks) : DEFAULT_DUTY_MINUTES) * 60 });
};
const isBlockList = (blocks: unknown): blocks is Block[] =>
  Array.isArray(blocks) && blocks.every((b: Untrusted) => ["drive", "break", "wait", "rest"].includes(b?.kind) && Number.isInteger(b.minutes) && b.minutes > 0);
export const setDeparture = async (tx: Db, run: RunRow, at: LocalDateTime): Promise<void> => {
  const instant = toInstant(at);
  await tx.query("UPDATE vehicles SET depart_date=$2,depart_time=$3,depart_repeated=$4,depart_instant=$5 WHERE id=$1", [run.vehicle_id, at.date, at.time, at.repeatedHour ?? null, instant]);
  if (run.duty_start !== null) await tx.query("UPDATE runs SET duty_start=$2 WHERE id=$1", [run.id, instant]);
  const first = await only<Pick<VehicleRow, "depart_date" | "depart_time" | "depart_repeated" | "depart_instant">>(tx, "SELECT depart_date,depart_time,depart_repeated,depart_instant FROM vehicles WHERE hire_id=$1 ORDER BY depart_instant LIMIT 1", [run.hire_id]);
  await tx.query("UPDATE hires SET depart_date=$2,depart_time=$3,depart_repeated=$4,depart_instant=$5 WHERE id=$1", [run.hire_id, first.depart_date, first.depart_time, first.depart_repeated, first.depart_instant]);
};

interface SheetRead { run: RunRow; ended: boolean }
export const sheetByToken = async (db: Db, token: string): Promise<SheetRead | null> => {
  const run = await one<RunRow>(db, "SELECT * FROM runs WHERE token=$1", [token]);
  if (!run) return null;
  const hire = await only<HireRow & { customer_state: string }>(db, "SELECT h.*, c.state AS customer_state FROM hires h JOIN customers c ON c.id=h.customer_id WHERE h.id=$1", [run.hire_id]);
  return { run, ended: Boolean(hire.cancellation) || hire.customer_state === "erased" };
};
const loadSheet = async (ctx: Ctx): Promise<SheetRead> => {
  const found = await sheetByToken(pool, ctx.params.token);
  if (!found) throw notFound();
  if (found.ended) throw new ApiError(410, "pageEnded", sheetCopy("en").pageEnded);
  return found;
};
export const sheetJson = async (db: Db, run: RunRow) => {
  const vehicle = await runVehicle(db, run);
  const presses = await rows<Pick<PressRow, "stop_id" | "kind" | "at">>(db, "SELECT stop_id,kind,at FROM presses WHERE run_id=$1", [run.id]);
  const flights = await rows<Pick<FlightRow, "failed">>(db, "SELECT failed FROM run_flights WHERE run_id=$1", [run.id]);
  const charges = await chargesOf(db, run);
  return {
    number: run.number, departAt: localJson(vehicle.depart_date, vehicle.depart_time, vehicle.depart_repeated) as LocalDateTime, departInstant: instantText(vehicle.depart_instant),
    stops: (await stopsOf(db, run.hire_id)).map((s) => {
      const at = (kind: string): string | null => instantText(presses.find((p) => p.stop_id === s.id && p.kind === kind)?.at);
      return { id: s.id, text: s.text, presses: { arrived: at("arrived"), boarded: at("boarded"), left: at("left"), comfortStop: at("comfortStop"), backOnTheRoad: at("backOnTheRoad") } };
    }),
    flightLine: flights.some((f) => f.failed) ? sheetCopy("en").flight : null,
    charges: charges.map((c) => ({ stopId: c.stopId, kind: c.kind, minutes: c.minutes, amount: moneyText(c.amount), accepted: c.accepted })),
  };
};

/** The flight is read at the first press at that stop and at most once per 5 minutes after that. */
const readFlight = async (tx: Db, run: RunRow, stopId: string, now: number): Promise<void> => {
  const flight = await one<FlightRow>(tx, "SELECT * FROM run_flights WHERE run_id=$1 AND stop_id=$2", [run.id, stopId]);
  if (!flight || (flight.read_at !== null && now - flight.read_at < 300)) return;
  const vehicle = await runVehicle(tx, run);
  try {
    const status = await flightStatus(flight.code, vehicle.depart_date);
    const landed = status?.actualArrival ? Math.floor(Date.parse(status.actualArrival) / 1000) : null;
    await tx.query("UPDATE run_flights SET landed_at=$3,read_at=$4,failed=false WHERE run_id=$1 AND stop_id=$2", [run.id, stopId, landed, now]);
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    await tx.query("UPDATE run_flights SET read_at=$3,failed=true WHERE run_id=$1 AND stop_id=$2", [run.id, stopId, now]);
  }
};

interface DiaryDay { date: string; hours: number; label: string | null }
export type DiaryRun = RunRow & Pick<VehicleRow, "seats" | "depart_date" | "depart_time" | "depart_repeated" | "depart_instant">;
export const diaryRead = async (deskId: string, week: string): Promise<{ week: string; days: DiaryDay[]; found: DiaryRun[] }> => {
  const monday = mondayOfIsoWeek(week) as string;
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((date) => ({ date, hours: hoursInDay(date), label: clockChangeLabel(date) }));
  const found = await rows<DiaryRun>(pool,
    `SELECT r.*, v.seats, v.depart_date, v.depart_time, v.depart_repeated, v.depart_instant FROM runs r JOIN vehicles v ON v.id=r.vehicle_id JOIN hires h ON h.id=r.hire_id JOIN customers c ON c.id=h.customer_id
     WHERE r.desk_id=$1 AND v.depart_date>=$2 AND v.depart_date<=$3 AND h.cancellation IS NULL AND c.state='active' ORDER BY v.depart_instant, r.number`, [deskId, monday, addDays(monday, 6)]);
  return { week, days, found };
};
export const currentWeek = (): string => isoWeekOf(ukDate(nowSeconds()));

export const runRoutes: ApiRoute[] = [
  route({
    method: "GET", path: "/api/diary",
    run: async ({ query, desk }) => {
      const week = query.get("week") ?? currentWeek();
      if (!mondayOfIsoWeek(week)) throw refused("Choose a week such as 2027-W12.", "week");
      const { days, found } = await diaryRead(desk!.id, week);
      return ok({
        week, days,
        rows: found.map((r) => ({ runId: r.id, number: r.number, hireId: r.hire_id, seats: r.seats, driver: r.driver_name ? { name: r.driver_name, telephone: r.driver_telephone } : null, departAt: localJson(r.depart_date, r.depart_time, r.depart_repeated), departInstant: instantText(r.depart_instant) })),
      });
    },
  }),
  route({ method: "GET", path: "/api/runs/:id", load: loadRun, run: async ({ loaded }) => ok(await runJson(pool, loaded)) }),
  route({
    method: "PUT", path: "/api/runs/:id/departure", body: "json", load: loadRun,
    run: async ({ json, loaded }) => {
      const at = json.departAt;
      const refusal = missingHourGuard(at);
      if (refusal) throw refused(refusal, "departAt");
      await transaction(async (tx) => {
        await tx.query("SELECT id FROM desks WHERE id=$1 FOR UPDATE", [loaded.desk_id]);
        const clash = await clashAtDeparture(tx, loaded, at);
        if (clash) throw clash;
        await setDeparture(tx, loaded, at);
      });
      const run = await only<RunRow>(pool, "SELECT * FROM runs WHERE id=$1", [loaded.id]);
      return ok(await runJson(pool, run.told_at !== null ? await tellDriver(run, true) : run));
    },
  }),
  route({
    method: "PUT", path: "/api/runs/:id/driver", body: "json", load: loadRun,
    run: async ({ json, loaded }) => {
      const fields: Record<string, string> = {};
      if (typeof json.name !== "string" || !json.name.trim()) fields.name = "Enter your name.";
      if (typeof json.telephone !== "string" || !isUkTelephone(json.telephone)) fields.telephone = "Enter a UK telephone number.";
      if (Object.keys(fields).length) throw fieldErrors(fields);
      const folded = foldTelephone(json.telephone);
      if (loaded.telephone_folded === folded && loaded.told_at !== null) return ok(await runJson(pool, loaded));
      const clash = await clashRefusal(pool, loaded.desk_id, loaded.id, folded, await dutySpan(pool, loaded));
      if (clash) throw clash;
      const run = await only<RunRow>(pool, "UPDATE runs SET driver_name=$2,driver_telephone=$3,telephone_folded=$4,told_at=NULL WHERE id=$1 RETURNING *", [loaded.id, json.name.trim(), json.telephone, folded]);
      return ok(await runJson(pool, await tellDriver(run, false)));
    },
  }),
  route({
    method: "POST", path: "/api/runs/:id/tell", body: "json", load: loadRun,
    run: async ({ loaded }) => {
      if (!loaded.telephone_folded) throw conflict("noDriver", "Assign a driver first.");
      return ok(await runJson(pool, await tellDriver(loaded, false)));
    },
  }),
  route({
    method: "PUT", path: "/api/runs/:id/blocks", body: "json", load: loadRun,
    run: async ({ json, loaded }) => {
      const start = json.startAt;
      const refusal = missingHourGuard(start);
      if (refusal) throw refused(refusal, "startAt");
      if (!isBlockList(json.blocks)) throw refused("Each block needs a kind and whole minutes.", "blocks");
      const run = await only<RunRow>(pool, "UPDATE runs SET blocks=$2,duty_start=$3,confirmed=false WHERE id=$1 RETURNING *", [loaded.id, JSON.stringify(json.blocks), toInstant(start)]);
      return ok(await hoursRead(run));
    },
  }),
  route({ method: "GET", path: "/api/runs/:id/hours", load: loadRun, run: async ({ loaded }) => ok(await hoursRead(loaded)) }),
  route({
    method: "POST", path: "/api/runs/:id/second-driver", body: "json", load: loadRun,
    run: async ({ loaded }) => transaction(async (tx) => {
      const run = await only<RunRow>(tx, "SELECT * FROM runs WHERE id=$1 FOR UPDATE", [loaded.id]);
      if (run.second_driver) return ok(await runJson(tx, run));
      const hire = await only<Pick<HireRow, "rate_table_id">>(tx, "SELECT rate_table_id FROM hires WHERE id=$1", [run.hire_id]);
      const rates = await rateById(tx, hire.rate_table_id as string);
      await tx.query("UPDATE vehicles SET charges=charges+$2 WHERE id=$1", [run.vehicle_id, rates.second_driver]);
      await writeMovement(tx, { deskId: run.desk_id, hireId: run.hire_id, vehicleId: run.vehicle_id, plus: "operatorOwed", minus: "hireIncome", pennies: rates.second_driver, at: nowSeconds(), part: "secondDriver", description: "Second driver" });
      return ok(await runJson(tx, await only<RunRow>(tx, "UPDATE runs SET second_driver=true WHERE id=$1 RETURNING *", [run.id])));
    }),
  }),
  route({
    method: "POST", path: "/api/runs/:id/confirm", body: "json", load: loadRun,
    run: async ({ loaded }) => {
      if ((await hoursRead(loaded)).breaches.length) throw conflict("overTheLimit", "This run is over the limit. Move a break or add a second driver.");
      return ok(await runJson(pool, await only<RunRow>(pool, "UPDATE runs SET confirmed=true WHERE id=$1 RETURNING *", [loaded.id])));
    },
  }),
  route({
    method: "PUT", path: "/api/runs/:id/stops/:stopId/flight", body: "json", load: loadRun,
    run: async ({ json, params, loaded }) => {
      if (!(await stopsOf(pool, loaded.hire_id)).some((s) => s.id === params.stopId)) throw notFound();
      if (typeof json.code !== "string" || !json.code.trim()) throw refused("Enter the flight code.", "code");
      await pool.query("INSERT INTO run_flights (run_id,stop_id,code) VALUES ($1,$2,$3) ON CONFLICT (run_id,stop_id) DO UPDATE SET code=$3,landed_at=NULL,read_at=NULL,failed=false", [loaded.id, params.stopId, json.code.trim()]);
      return ok(await runJson(pool, loaded));
    },
  }),
  route({
    method: "POST", path: "/api/runs/:id/accept-charges", body: "json", load: loadRun,
    run: async ({ loaded }) => transaction(async (tx) => {
      const run = await only<RunRow>(tx, "SELECT * FROM runs WHERE id=$1 FOR UPDATE", [loaded.id]);
      const waiting = (await chargesOf(tx, run)).filter((c) => !c.accepted);
      const added = waiting.reduce((a, c) => a + c.amount, 0);
      const now = nowSeconds();
      for (const charge of waiting) {
        await tx.query("INSERT INTO accepted_charges (run_id,stop_id,kind,minutes,pennies) VALUES ($1,$2,$3,$4,$5)", [run.id, charge.stopId, charge.kind, charge.minutes, charge.amount]);
        await writeMovement(tx, { deskId: run.desk_id, hireId: run.hire_id, vehicleId: run.vehicle_id, plus: "operatorOwed", minus: "hireIncome", pennies: charge.amount, at: now, part: "charge", description: "Charge accepted" });
      }
      const vehicle = await only<VehicleRow>(tx, "UPDATE vehicles SET charges=charges+$2 WHERE id=$1 RETURNING *", [run.vehicle_id, added]);
      return ok({ added: moneyText(added), vehicleTotal: moneyText(vehicleTotals(vehicle).total) });
    }),
  }),
  route({ method: "GET", path: "/api/r/:token", access: "private", load: loadSheet, run: async ({ loaded }) => ok(await sheetJson(pool, loaded.run)) }),
  route({
    method: "POST", path: "/api/r/:token/presses", access: "private", body: "json", load: loadSheet,
    run: async ({ json, loaded }) => {
      const kind = json.kind as PressKind;
      if (!PRESS_ORDER.includes(kind)) throw refused("Choose a press.", "kind");
      if (typeof json.repeatKey !== "string" || !json.repeatKey) throw refused("A press needs its repeat key.", "repeatKey");
      if (typeof json.stopId !== "string") throw refused("Choose a stop.", "stopId");
      if (!Number.isInteger(json.secondsAgo) || json.secondsAgo < 0) throw refused("A press needs its seconds ago.", "secondsAgo");
      const run = loaded.run;
      if (!(await stopsOf(pool, run.hire_id)).some((s) => s.id === json.stopId)) throw refused("Choose a stop.", "stopId");
      return transaction(async (tx) => {
        await tx.query("SELECT id FROM runs WHERE id=$1 FOR UPDATE", [run.id]);
        const seen = await one<PressRow>(tx, "SELECT * FROM presses WHERE run_id=$1 AND repeat_key=$2", [run.id, json.repeatKey]);
        if (seen) {
          if (seen.stop_id !== json.stopId || seen.kind !== kind) throw conflict("repeatKeyConflict", "That repeat key belongs to another press.");
          return ok({ pressId: seen.id, at: instantText(seen.at) }, 201);
        }
        const done = (await rows<Pick<PressRow, "kind">>(tx, "SELECT kind FROM presses WHERE run_id=$1 AND stop_id=$2", [run.id, json.stopId])).map((p) => p.kind);
        const before = PRESS_ORDER[PRESS_ORDER.indexOf(kind) - 1];
        if (done.includes(kind) || (before && !done.includes(before))) throw conflict("pressOutOfOrder", "That press is out of order.");
        const now = nowSeconds();
        const at = now - json.secondsAgo;
        const made = await only<PressRow>(tx, "INSERT INTO presses (id,run_id,stop_id,kind,at,repeat_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [newId("PR"), run.id, json.stopId, kind, at, json.repeatKey]);
        await readFlight(tx, run, json.stopId, now);
        return ok({ pressId: made.id, at: instantText(made.at) }, 201);
      });
    },
  }),
];
