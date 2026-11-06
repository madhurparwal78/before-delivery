// Public reads: clock, stations, train search, coach plans, fare quotes and the public PNR lookup.
import type { ClassCode, ClassEntry, PublicPnr, QueueList, Quota, TrainResult } from "../../shared/api.js";
import type { App } from "../app.js";
import { counts, availabilityLabel, berthStates } from "../domain/availability.js";
import { type Stop, type Train, coachesOf, findTrain, isStation, stretchOf } from "../domain/catalog.js";
import { addDays, istTimestamp } from "../domain/clock.js";
import { adultFare, fareQuote } from "../domain/fare.js";
import { chartAt, departureAt, isChartPrepared, opensAt, windowOf } from "../domain/schedule.js";
import { isAge, journeyErrors } from "../domain/validate.js";
import type { Route } from "../http/api.js";
import { assertValid, notFound } from "../http/errors.js";
import { bookingRow, passengerRows } from "../store/rows.js";
import { loadRun } from "../store/runs.js";
import { currentStatus, timelineOf } from "../store/view.js";

/** GNWL from the origin, RLWL from a remote-location stop, PQWL from any other stop. */
export function generalListFor(from: Stop): QueueList {
  if (from.seq === 0) return "GNWL";
  return from.remote ? "RLWL" : "PQWL";
}

async function classEntry(
  app: App,
  train: Train,
  runDate: string,
  cls: ClassCode,
  quota: Quota,
  stretch: { from: Stop; to: Stop },
  now: number,
): Promise<ClassEntry> {
  const state = await loadRun(app.db, train, runDate, cls);
  const c = counts(state, quota, { from: stretch.from.seq, to: stretch.to.seq }, generalListFor(stretch.from));
  const opening = opensAt(quota, cls, runDate);
  const window = windowOf(now, opening, chartAt(train, runDate));
  return {
    class: cls,
    quota,
    window,
    opens_at: istTimestamp(opening),
    avl: c.avl,
    rac: c.rac,
    wl_type: c.wlType,
    wl: c.wl,
    wl_cap: c.wlCap,
    label: availabilityLabel(quota, window, opening, c),
    adult_fare_paise: adultFare(stretch.to.km - stretch.from.km, cls, quota).total,
  };
}

/** The run a search date means: the date the train leaves the From stop, taken back to its origin. */
function runDateFor(date: string, from: Stop): string {
  return addDays(date, -Math.floor(from.minutes / 1440));
}

export const journeyRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/clock$/,
    async handle(ctx, app) {
      return { status: 200, body: { now: istTimestamp(ctx.now), zone: "Asia/Kolkata", rate: app.clock.rate } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/stations$/,
    async handle(_ctx, app) {
      return { status: 200, body: { stations: app.catalog.stations } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/trains$/,
    async handle(ctx, app) {
      const q = ctx.url.searchParams;
      const from = q.get("from");
      const to = q.get("to");
      const cls = q.get("class");
      if (!isStation(app.catalog, from) || !isStation(app.catalog, to)) throw notFound();
      const query = { from, to, date: q.get("date"), quota: q.get("quota") ?? "GN", class: cls ?? "SL" };
      assertValid(journeyErrors(query, "date"));
      const date = query.date as string;
      const quota = query.quota as Quota;
      const trains: TrainResult[] = [];
      for (const train of app.catalog.trains) {
        const stretch = stretchOf(train, from as string, to as string);
        if (!stretch) continue;
        const runDate = runDateFor(date, stretch.from);
        const classes = cls ? [cls as ClassCode] : [...new Set(train.coaches.map((c) => c.cls))];
        const chart = chartAt(train, runDate);
        const entries: ClassEntry[] = [];
        for (const c of classes) entries.push(await classEntry(app, train, runDate, c, quota, stretch, ctx.now));
        trains.push({
          number: train.number,
          name: train.name,
          run_date: runDate,
          from: { code: stretch.from.code, name: stretch.from.name, departure_at: istTimestamp(departureAt(runDate, stretch.from)) },
          to: { code: stretch.to.code, name: stretch.to.name, arrival_at: istTimestamp(departureAt(runDate, stretch.to)) },
          stops: train.stops.map((s) => ({ code: s.code, name: s.name, km: s.km, departure_at: istTimestamp(departureAt(runDate, s)) })),
          chart_at: istTimestamp(chart),
          chart_prepared: isChartPrepared(ctx.now, chart),
          classes: entries,
        });
      }
      trains.sort((a, b) => a.from.departure_at.localeCompare(b.from.departure_at));
      return { status: 200, body: { trains } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/trains\/([^/]+)\/runs\/([^/]+)\/coaches$/,
    async handle(ctx, app) {
      const [number = "", runDate = ""] = ctx.params;
      const q = ctx.url.searchParams;
      const train = findTrain(app.catalog, number);
      const from = q.get("from");
      const to = q.get("to");
      if (!train || !isStation(app.catalog, from) || !isStation(app.catalog, to)) throw notFound();
      const errors = journeyErrors({ from, to, run_date: runDate, quota: "GN", class: q.get("class") }, "run_date");
      const stretch = stretchOf(train, from as string, to as string);
      if (!stretch && !errors.to) errors.to = "This train does not call at these stops in this order";
      assertValid(errors);
      const cls = q.get("class") as ClassCode;
      const state = await loadRun(app.db, train, runDate, cls);
      const span = { from: stretch?.from.seq ?? 0, to: stretch?.to.seq ?? 0 };
      return {
        status: 200,
        body: { coaches: coachesOf(train, cls).map((coach) => ({ coach, berths: berthStates(state, coach, span) })) },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/fare-quote$/,
    async handle(ctx, app) {
      const b = ctx.body;
      const train = findTrain(app.catalog, b.train);
      if (!train || !isStation(app.catalog, b.from) || !isStation(app.catalog, b.to)) throw notFound();
      const errors = journeyErrors(b, "run_date");
      const stretch = stretchOf(train, b.from as string, b.to as string);
      if (!stretch && !errors.to) errors.to = "This train does not call at these stops in this order";
      const passengers: unknown[] = Array.isArray(b.passengers) ? b.passengers : [];
      const ages = passengers.map((p) => (typeof p === "object" && p !== null ? (p as Record<string, unknown>).age : undefined));
      ages.forEach((age, i) => {
        if (!isAge(age)) errors[`passengers[${i}].age`] = "Enter an age from 0 to 125";
      });
      assertValid(errors);
      const km = (stretch?.to.km ?? 0) - (stretch?.from.km ?? 0);
      return { status: 200, body: fareQuote(km, b.class as ClassCode, b.quota as Quota, ages as number[]) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/pnr\/([^/]+)$/,
    async handle(ctx, app) {
      const pnr = ctx.params[0] ?? "";
      const row = /^\d{10}$/.test(pnr) ? await bookingRow(app.db, pnr) : undefined;
      if (!row) throw notFound();
      const t = timelineOf(app.catalog, row, ctx.now);
      const passengers = await passengerRows(app.db, pnr);
      const body: PublicPnr = {
        pnr,
        train: { number: t.train.number, name: t.train.name },
        run_date: row.run_date,
        from: row.from_code,
        to: row.to_code,
        class: row.class,
        chart_prepared: t.chartDue,
        passengers: passengers.map((p) => ({
          number: p.number,
          booking_status: p.booking_status.label,
          current_status: currentStatus(p, t).label,
        })),
      };
      return { status: 200, body };
    },
  },
];

