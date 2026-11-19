import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { isoInstant, foldTelephone, ukTimeHM } from "../domain.js";
import { notifyDriver, getFlight } from "../services.js";
import { ukToInstant, addDays } from "../uktime.js";
import { judgeRun, type DutyBlock } from "../hours.js";
import { rateTableForDate } from "./rate-helpers.js";
import { waitingPennies, comfortCharge } from "../rules.js";
import { penniesToString } from "../money.js";
import { longDate } from "./operators.js";
import { parseLocalDate } from "../validation.js";


export function registerRunApi(app: Express, ctx: Ctx): void {
  app.get("/api/diary", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const week = typeof req.query.week === "string" && /^\d{4}-W\d{2}$/.test(req.query.week) ? req.query.week : null;
    if (!week) throw errors.invalid({ week: "We can't find that." });
    const [year, wn] = week.split("-W").map(Number);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = (jan4.getUTCDay() + 6) % 7;
    const monday = new Date(jan4.getTime() - dayOfWeek * 86400000 + (wn - 1) * 7 * 86400000);
    const days: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const hours = dayHours(iso);
      days.push({ date: iso, hours, label: hours === 23 ? "Clocks go forward 01:00" : hours === 25 ? "Clocks go back 02:00" : null });
    }
    const from = ukToInstant(days[0].date as string, "00:00").instant;
    const to = ukToInstant(days[6].date as string, "23:59").instant;
    const rows = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND depart_instant BETWEEN $2 AND $3 ORDER BY depart_instant", [deskId, from, new Date(to.getTime() + 59999)]);
    const out = [];
    for (const r of rows.rows) {
      const hire = await ctx.db.query("SELECT reference FROM hires WHERE id=$1", [r.hire_id]);
      out.push({
        runId: String(r.id),
        number: Number(r.number),
        hireId: String(r.hire_id),
        seats: Number((await ctx.db.query("SELECT seats FROM vehicles WHERE id=$1", [r.vehicle_id])).rows[0]?.seats ?? 0),
        driver: r.driver_name ? { name: String(r.driver_name), telephone: String(r.driver_telephone) } : null,
        departAt: { date: isoDateOf(r.depart_instant as Date), time: String(r.depart_time) },
        departInstant: isoInstant(r.depart_instant as Date),
        reference: hire.rows[0]?.reference ?? "",
      });
    }
    res.json({ week, days, rows: out });
  });

  app.get("/api/runs/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const r = await runById(ctx, deskId, String(req.params.id));
    res.json(await runOut(ctx, deskId, r));
  });

  app.put("/api/runs/:id/departure", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = (await readJson(req)) as Record<string, unknown>;
    const depart = parseLocalDate(body.departAt ?? {}, "departAt");
    const clash = await driverClash(ctx, deskId, run, depart.instant);
    if (clash) {
      throw errors.state("driverClash", `That driver is already on Run ${clash.number} at ${ukTimeHM(clash.depart_instant as Date)}.`);
    }
    const hadDriver = run.driver_name && run.told_at;
    await ctx.db.query("UPDATE runs SET depart_date=$1, depart_time=$2, depart_instant=$3, told_at=NULL WHERE id=$4", [
      depart.date,
      depart.time,
      depart.instant,
      run.id,
    ]);
    await syncVehicleDepartures(ctx, deskId, String(run.hire_id), String(run.id), depart);
    let message: string | null = null;
    if (hadDriver) {
      const ok = await publishChange(ctx, deskId, String(run.id));
      if (!ok) message = "We couldn't reach the driver's phone. Nothing was marked as told.";
      else {
        await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
      }
    }
    const after = await runById(ctx, deskId, String(run.id));
    const out = await runOut(ctx, deskId, after);
    if (message) (out as Record<string, unknown>).driverNotice = message;
    res.json(out);
  });

  app.put("/api/runs/:id/driver", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
    if (!name) throw errors.invalid({ name: "Enter the driver's name." });
    if (!telephone) throw errors.invalid({ telephone: "Enter a UK telephone number." });
    const folded = foldTelephone(telephone);
    const clash = await driverClash(ctx, deskId, run, run.depart_instant as Date, folded);
    if (clash && clash.id !== run.id) {
      throw errors.state("driverClash", `That driver is already on Run ${clash.number} at ${ukTimeHM(clash.depart_instant as Date)}.`);
    }
    await ctx.db.query("UPDATE runs SET driver_name=$1, driver_telephone=$2, driver_folded=$3 WHERE id=$4", [name, telephone, folded, run.id]);
    const ok = await publishTell(ctx, deskId, String(run.id));
    if (!ok) {
      const after = await runById(ctx, deskId, String(run.id));
      res.json(await runOut(ctx, deskId, after));
      return;
    }
    await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });

  app.post("/api/runs/:id/tell", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    if (!run.driver_name) throw errors.state("noDriver", "We can't find that.");
    const ok = await publishTell(ctx, deskId, String(run.id));
    if (!ok) throw errors.provider("We couldn't reach the driver's phone. Nothing was marked as told.");
    await ctx.db.query("UPDATE runs SET told_at=NOW() WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });

  app.put("/api/runs/:id/blocks", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = (await readJson(req)) as Record<string, unknown>;
    const _startAt = parseLocalDate(body.startAt ?? {}, "startAt");
    void _startAt;
    const blocksIn = Array.isArray(body.blocks) ? body.blocks : [];
    const blocks: DutyBlock[] = [];
    for (const b of blocksIn) {
      const o = (b ?? {}) as Record<string, unknown>;
      const kind = o.kind;
      const minutes = Number(o.minutes);
      if (!["drive", "break", "wait", "rest"].includes(String(kind)) || !Number.isInteger(minutes) || minutes <= 0) {
        throw errors.invalid({ blocks: "We can't find that." });
      }
      blocks.push({ kind: kind as DutyBlock["kind"], minutes });
    }
    await ctx.db.query("DELETE FROM duty_blocks WHERE run_id=$1", [run.id]);
    for (let i = 0; i < blocks.length; i++) {
      await ctx.db.query("INSERT INTO duty_blocks (run_id, desk_id, position, kind, minutes) VALUES ($1,$2,$3,$4,$5)", [
        run.id,
        deskId,
        i,
        blocks[i].kind,
        blocks[i].minutes,
      ]);
    }
    const answer = await hoursAnswerFor(ctx, deskId, String(run.id));
    res.json(answer);
  });

  app.get("/api/runs/:id/hours", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    res.json(await hoursAnswerFor(ctx, deskId, String(run.id)));
  });

  app.post("/api/runs/:id/second-driver", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    if (!run.second_driver) {
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.hire_id]);
      const rate = await rateTableForDate(ctx, deskId, isoDateOf(hire.rows[0].quote_sent_at ? (hire.rows[0].quote_sent_at as Date) : new Date()));
      const charge = rate.secondDriverPennies;
      await ctx.db.query("UPDATE runs SET second_driver=TRUE WHERE id=$1", [run.id]);
      const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-second";
      await ctx.db.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'secondDriver',$5,'operatorOwed',$6,NOW(),'Second driver'),
         ($7,$2,$3,$4,'secondDriver',$5,'hireIncome',$8,NOW(),'Second driver')`,
        [movementId + "-A", deskId, run.hire_id, movementId, run.vehicle_id, String(-charge), movementId + "-B", String(charge)]
      );
      await ctx.db.query("UPDATE vehicles SET total_pennies = total_pennies + $1 WHERE id=$2", [charge, run.vehicle_id]);
    }
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });

  app.post("/api/runs/:id/confirm", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    const answer = await hoursAnswerFor(ctx, deskId, String(run.id));
    if (answer.breaches.length) {
      throw errors.state("overTheLimit", "This run is over the limit. Move a break or add a second driver.");
    }
    await ctx.db.query("UPDATE runs SET confirmed=TRUE WHERE id=$1", [run.id]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });

  app.put("/api/runs/:id/stops/:stopId/flight", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const run = await runById(ctx, deskId, String(req.params.id));
    const body = (await readJson(req)) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[A-Za-z]{2}\d{2,4}$/.test(code)) throw errors.invalid({ code: "We can't find that." });
    await ctx.db.query("UPDATE enquiry_stops SET flight_code=$1 WHERE id=$2 AND enquiry_id=(SELECT reference FROM hires WHERE id=$3)", [
      code.toUpperCase(),
      req.params.stopId,
      run.hire_id,
    ]);
    const after = await runById(ctx, deskId, String(run.id));
    res.json(await runOut(ctx, deskId, after));
  });

  app.post("/api/runs/:id/accept-charges", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const run = await runById(ctx, deskId, String(req.params.id));
    const pending = await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1 AND accepted=FALSE", [String(run.id)]);
    let added = 0;
    for (const c of pending.rows) {
      await ctx.db.query("UPDATE run_charges SET accepted=TRUE, accepted_at=NOW() WHERE id=$1", [c.id]);
      const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-charge";
      await ctx.db.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'chargeAccepted',$5,'operatorOwed',$6,NOW(),'Charge accepted'),
         ($7,$2,$3,$4,'chargeAccepted',$5,'hireIncome',$8,NOW(),'Charge accepted')`,
        [movementId + "-A", deskId, run.hire_id, movementId, run.vehicle_id, String(-Number(c.amount_pennies)), movementId + "-B", String(c.amount_pennies)]
      );
      await ctx.db.query("UPDATE vehicles SET total_pennies = total_pennies + $1 WHERE id=$2", [Number(c.amount_pennies), run.vehicle_id]);
      added += Number(c.amount_pennies);
    }
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE id=$1", [run.vehicle_id]);
    res.json({ added: penniesToString(added), vehicleTotal: penniesToString(Number(vehicle.rows[0].total_pennies)) });
  });

  // Private run sheet.
  app.get("/api/r/:token", async (req: Request, res: Response) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
    if (!run.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
    if (hire.rows[0] && hire.rows[0].cancelled) throw errors.ended();
    const customer = hire.rows[0] ? await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]) : null;
    if (customer && customer.rows[0] && customer.rows[0].state === "erased") throw errors.ended();
    const answer = await runSheetAnswer(ctx, deskId, run.rows[0]);
    res.json(answer);
  });

  app.post("/api/r/:token/presses", async (req: Request, res: Response) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM run_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [String(t.rows[0].run_id)]);
    if (!run.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [run.rows[0].hire_id]);
    if (hire.rows[0] && hire.rows[0].cancelled) throw errors.ended();
    const body = (await readJson(req)) as Record<string, unknown>;
    const stopId = typeof body.stopId === "string" ? body.stopId : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    const secondsAgo = Number(body.secondsAgo ?? 0);
    const repeatKey = typeof body.repeatKey === "string" ? body.repeatKey : "";
    if (!["arrived", "boarded", "left", "comfortStop", "backOnTheRoad"].includes(kind)) throw errors.invalid({ kind: "We can't find that." });
    if (!Number.isFinite(secondsAgo) || secondsAgo < 0) throw errors.invalid({ secondsAgo: "We can't find that." });
    if (!repeatKey) throw errors.invalid({ repeatKey: "We can't find that." });
    const seen = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 AND repeat_key=$2", [run.rows[0].id, repeatKey]);
    if (seen.rows[0]) {
      const same = String(seen.rows[0].stop_id) === stopId && String(seen.rows[0].kind) === kind;
      if (!same) throw errors.state("repeatKeyConflict", "We can't find that.");
      res.status(Number(seen.rows[0].status_code ?? 201)).json({ pressId: String(seen.rows[0].id), at: isoInstant(seen.rows[0].at as Date) });
      return;
    }
    const at = new Date(Date.now() - Math.round(secondsAgo) * 1000);
    const order = ["arrived", "boarded", "left"];
    const previous = await ctx.db.query("SELECT kind FROM run_presses WHERE run_id=$1 AND stop_id=$2 AND kind IN ('arrived','boarded','left') ORDER BY at", [run.rows[0].id, stopId]);
    const pressedKinds = new Set(previous.rows.map((x) => String(x.kind)));
    if (["arrived", "boarded", "left"].includes(kind)) {
      const expected = order.find((k) => !pressedKinds.has(k));
      if (expected !== kind || pressedKinds.has(kind)) {
        throw errors.state("pressOutOfOrder", "We can't find that.");
      }
    }
    const id = "PR-" + Math.random().toString(36).slice(2, 12);
    await ctx.db.query("INSERT INTO run_presses (id, run_id, stop_id, kind, at, repeat_key) VALUES ($1,$2,$3,$4,$5,$6)", [
      id,
      run.rows[0].id,
      stopId,
      kind,
      at,
      repeatKey,
    ]);
    await recomputeCharges(ctx, deskId, run.rows[0]);
    res.status(201).json({ pressId: id, at: isoInstant(at) });
  });
}

function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayHours(iso: string): number {
  const noon = ukToInstant(iso, "12:00").instant;
  const start = ukToInstant(iso, "00:00").instant;
  const end = ukToInstant(addDays(iso, 1), "00:00").instant;
  void noon;
  return Math.round((end.getTime() - start.getTime()) / 3600000);
}

async function runById(ctx: Ctx, deskId: string, id: string): Promise<Record<string, unknown>> {
  const r = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND id=$2", [deskId, id]);
  if (!r.rows[0]) throw errors.notFound();
  return r.rows[0];
}

async function driverClash(
  ctx: Ctx,
  deskId: string,
  run: Record<string, unknown>,
  departInstant: Date,
  foldedOverride?: string
): Promise<Record<string, unknown> | null> {
  const folded = foldedOverride ?? (run.driver_folded ? String(run.driver_folded) : null);
  if (!folded) return null;
  const others = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND id<>$2 AND driver_folded=$3", [deskId, run.id, folded]);
  const myStart = departInstant;
  const myEnd = new Date(myStart.getTime() + (await dutySpan(ctx, String(run.id))) * 60000);
  for (const other of others.rows) {
    const otherStart = other.depart_instant as Date;
    const otherEnd = new Date(otherStart.getTime() + (await dutySpan(ctx, String(other.id))) * 60000);
    if (myStart < otherEnd && otherStart < myEnd) return other;
  }
  return null;
}

async function dutySpan(ctx: Ctx, runId: string): Promise<number> {
  const blocks = await ctx.db.query("SELECT minutes FROM duty_blocks WHERE run_id=$1 ORDER BY position", [runId]);
  if (blocks.rows.length === 0) return 60;
  return blocks.rows.reduce((s: number, x) => s + Number(x.minutes), 0);
}

async function syncVehicleDepartures(ctx: Ctx, deskId: string, hireId: string, runId: string, depart: { date: string; time: string; instant: Date }): Promise<void> {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  if (!run.rows[0]) return;
  await ctx.db.query("UPDATE vehicles SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE id=$4", [
    depart.date,
    depart.time,
    depart.instant,
    run.rows[0].vehicle_id,
  ]);
  const anyEarlier = await ctx.db.query(
    "SELECT COUNT(*) AS c FROM runs r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.hire_id=$1 AND v.depart_instant < $2",
    [hireId, depart.instant]
  );
  void anyEarlier;
  void deskId;
}

async function publishTell(ctx: Ctx, _deskId: string, runId: string): Promise<boolean> {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  if (!r || !r.driver_telephone) return false;
  const first = await ctx.db.query(
    "SELECT text FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position LIMIT 1",
    [r.hire_id]
  );
  const firstText = first.rows[0]?.text ? String(first.rows[0].text).split(",")[0] : "";
  const message = `Run ${r.number}: ${String(r.depart_time)} ${longDate(String(r.depart_date))}, ${firstText}.`;
  return notifyDriver(ctx.cfg, foldTelephone(String(r.driver_telephone)), `Run ${r.number}`, message);
}

async function publishChange(ctx: Ctx, deskId: string, runId: string): Promise<boolean> {
  void deskId;
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  if (!r || !r.driver_telephone) return false;
  const first = await ctx.db.query(
    "SELECT text FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position LIMIT 1",
    [r.hire_id]
  );
  const firstText = first.rows[0]?.text ? String(first.rows[0].text).split(",")[0] : "";
  const message = `Run ${r.number} changed: ${String(r.depart_time)} ${longDate(String(r.depart_date))}, ${firstText}.`;
  return notifyDriver(ctx.cfg, foldTelephone(String(r.driver_telephone)), `Run ${r.number}`, message);
}

export async function hoursAnswerFor(ctx: Ctx, deskId: string, runId: string): Promise<{ drivingMinutes: number; spreadMinutes: number; breaches: unknown[] }> {
  const run = await ctx.db.query("SELECT * FROM runs WHERE id=$1", [runId]);
  const r = run.rows[0];
  const blocks = (await ctx.db.query("SELECT * FROM duty_blocks WHERE run_id=$1 ORDER BY position", [runId])).rows.map(
    (x) => ({ kind: String(x.kind) as DutyBlock["kind"], minutes: Number(x.minutes) })
  );
  const duty = { startInstant: r.depart_instant as Date, blocks };
  let sameDayDriving = 0;
  let weekDaysOver = 0;
  if (r.driver_folded && !r.second_driver) {
    const others = await ctx.db.query(
      "SELECT * FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND id<>$3 AND depart_date=$4 AND second_driver=FALSE",
      [deskId, r.driver_folded, runId, r.depart_date]
    );
    for (const other of others.rows) {
      const otherBlocks = (await ctx.db.query("SELECT minutes, kind FROM duty_blocks WHERE run_id=$1", [other.id])).rows;
      sameDayDriving += otherBlocks.filter((b) => b.kind === "drive").reduce((s: number, b) => s + Number(b.minutes), 0);
    }
    const weekStart = mondayOf(String(r.depart_date));
    const weekRuns = await ctx.db.query(
      "SELECT DISTINCT depart_date FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND depart_date BETWEEN $3 AND $4",
      [deskId, r.driver_folded, weekStart, String(r.depart_date)]
    );
    for (const d of weekRuns.rows) {
      const dayRuns = await ctx.db.query(
        "SELECT id FROM runs WHERE desk_id=$1 AND driver_folded=$2 AND depart_date=$3 AND second_driver=FALSE",
        [deskId, r.driver_folded, String(d.depart_date)]
      );
      let dayDriving = 0;
      for (const dr of dayRuns.rows) {
        const b = await ctx.db.query("SELECT minutes, kind FROM duty_blocks WHERE run_id=$1", [dr.id]);
        dayDriving += b.rows.filter((x) => x.kind === "drive").reduce((s: number, x) => s + Number(x.minutes), 0);
      }
      if (dayDriving > 540) weekDaysOver++;
    }
  }
  const answer = judgeRun(duty, Boolean(r.second_driver), sameDayDriving, weekDaysOver);
  return { drivingMinutes: answer.drivingMinutes, spreadMinutes: answer.spreadMinutes, breaches: answer.breaches };
}

function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  return new Date(dt.getTime() - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

export async function runOut(ctx: Ctx, _deskId: string, r: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stops = await ctx.db.query(
    "SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position",
    [r.hire_id]
  );
  const charges = await ctx.db.query("SELECT * FROM run_charges WHERE run_id=$1", [r.id]);
  const hire = await ctx.db.query("SELECT reference FROM hires WHERE id=$1", [r.hire_id]);
  return {
    id: String(r.id),
    number: Number(r.number),
    hireId: String(r.hire_id),
    reference: hire.rows[0]?.reference,
    vehicleId: String(r.vehicle_id),
    seats: Number((await ctx.db.query("SELECT seats FROM vehicles WHERE id=$1", [r.vehicle_id])).rows[0]?.seats ?? 0),
    driver: r.driver_name ? { name: String(r.driver_name), telephone: String(r.driver_telephone) } : null,
    toldAt: r.told_at ? isoInstant(r.told_at as Date) : null,
    confirmed: Boolean(r.confirmed),
    sheetPath: String(r.sheet_path),
    departAt: { date: String(r.depart_date), time: String(r.depart_time) },
    departInstant: isoInstant(r.depart_instant as Date),
    secondDriver: Boolean(r.second_driver),
    stops: stops.rows.map((s) => ({ id: String(s.id), text: String(s.text), flightCode: s.flight_code ? String(s.flight_code) : null })),
    charges: charges.rows.map((c) => ({
      stopId: c.stop_id ? String(c.stop_id) : null,
      kind: String(c.kind),
      minutes: Number(c.minutes),
      amount: penniesToString(Number(c.amount_pennies)),
      accepted: Boolean(c.accepted),
    })),
    chargesTotal: penniesToString(charges.rows.reduce((s: number, c) => s + (c.accepted ? Number(c.amount_pennies) : 0), 0)),
  };
}

async function runSheetAnswer(ctx: Ctx, deskId: string, r: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = await runOut(ctx, deskId, r);
  const presses = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 ORDER BY at", [r.id]);
  const stops = (base.stops as { id: string; text: string; flightCode: string | null }[]).map((s) => ({
    id: s.id,
    text: s.text,
    presses: {
      arrived: pressAt(presses.rows, s.id, "arrived"),
      boarded: pressAt(presses.rows, s.id, "boarded"),
      left: pressAt(presses.rows, s.id, "left"),
    },
  }));
  return {
    number: base.number,
    departAt: base.departAt,
    departInstant: base.departInstant,
    stops,
    flightLine: null,
    charges: base.charges,
  };
}

function pressAt(rows: Record<string, unknown>[], stopId: string, kind: string): string | null {
  const found = rows.find((x) => String(x.stop_id) === stopId && String(x.kind) === kind);
  return found ? isoInstant(found.at as Date) : null;
}

/** Waiting and comfort charges after presses, per DP-45. */
async function recomputeCharges(ctx: Ctx, deskId: string, r: Record<string, unknown>): Promise<void> {
  const runId = String(r.id);
  await ctx.db.query("DELETE FROM run_charges WHERE run_id=$1 AND accepted=FALSE", [runId]);
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [r.hire_id]);
  const rate = await rateTableForDate(ctx, deskId, isoDateOf(hire.rows[0].quote_sent_at ? (hire.rows[0].quote_sent_at as Date) : new Date()));
  const perHour = rate.waitingRatePennies;
  const stops = await ctx.db.query("SELECT * FROM enquiry_stops WHERE enquiry_id=(SELECT reference FROM hires WHERE id=$1) ORDER BY position", [r.hire_id]);
  const presses = await ctx.db.query("SELECT * FROM run_presses WHERE run_id=$1 ORDER BY at", [runId]);
  for (const stop of stops.rows) {
    const arrived = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "arrived");
    const boarded = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "boarded");
    if (arrived && boarded) {
      const minutes = Math.floor(((boarded.at as Date).getTime() - (arrived.at as Date).getTime()) / 60000);
      let from: Date | null = arrived.at as Date;
      if (stop.flight_code) {
        const flight = await getFlight(ctx.cfg, String(stop.flight_code), String(r.depart_date));
        if (flight && flight.actualArrival) {
          from = new Date(flight.actualArrival);
        } else {
          from = null;
        }
      }
      const base = from ?? (r.depart_instant as Date);
      const mins = Math.max(0, Math.floor(((boarded.at as Date).getTime() - base.getTime()) / 60000));
      const charge = stop.flight_code && from ? waitingPennies(mins, perHour) : waitingPennies(minutes, perHour);
      void minutes;
      if (charge > 0) {
        const existing = await ctx.db.query("SELECT 1 FROM run_charges WHERE run_id=$1 AND stop_id=$2 AND kind='waiting' AND accepted=FALSE", [runId, stop.id]);
        if (!existing.rows[0]) {
          await ctx.db.query("INSERT INTO run_charges (id, run_id, stop_id, kind, minutes, amount_pennies) VALUES ($1,$2,$3,'waiting',$4,$5)", [
            "CH-" + Math.random().toString(36).slice(2, 12),
            runId,
            stop.id,
            mins,
            charge,
          ]);
        }
      }
    }
    const comfort = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "comfortStop");
    const back = presses.rows.find((p) => p.stop_id === stop.id && p.kind === "backOnTheRoad");
    if (comfort && back) {
      const minutes = Math.floor(((back.at as Date).getTime() - (comfort.at as Date).getTime()) / 60000);
      const charge = comfortCharge(minutes, perHour);
      if (charge > 0) {
        const existing = await ctx.db.query("SELECT 1 FROM run_charges WHERE run_id=$1 AND stop_id=$2 AND kind='comfortStop' AND accepted=FALSE", [runId, stop.id]);
        if (!existing.rows[0]) {
          await ctx.db.query("INSERT INTO run_charges (id, run_id, stop_id, kind, minutes, amount_pennies) VALUES ($1,$2,$3,'comfortStop',$4,$5)", [
            "CH-" + Math.random().toString(36).slice(2, 12),
            runId,
            stop.id,
            minutes,
            charge,
          ]);
        }
      }
    }
  }
}
