import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import { ACCOUNT_NAMES, allocatePayment, csvFile, downloadHeaders, hireMoney, ledgerOf, lineJson, marginText, MARGIN_COPY, parseDelimited, parseMargin, rateInForce, referencesIn, requireHire, statementAmount, vehiclesOf, vehicleTotals, depositFor, writeMovement, halfUp, type Account, type VehicleMoney } from "./domain.js";
import { conflict, objectsIn, instantText, moneyText, newId, notFound, ok, parseMoney, refused, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { localJson, stopsOf } from "./api-enquiries.js";
import { AMOUNT_COPY, quoteEnds, quoteMail, replaceQuotePage } from "./api-hires.js";
import { clashAtDeparture, setDeparture, tellDriverOfChange } from "./api-runs.js";
import { missingHourGuard } from "../shared/rules.js";
import { daysBetween, isRealDate, isTime, toInstant, typedToDate, ukDate, type LocalDateTime } from "../shared/time.js";
import type { CustomerRow, Cancellation, HireRow, RunRow, LedgerLineRow, StatementRow, StatementPreviewRow, ChangeRow } from "./records.js";

const STATEMENT_LIMIT = 2_000_000;
const HEADER = "Date,Description,Amount,Balance";
const ERASED_NAME = "Erased customer";

const loadHire = (ctx: Ctx): Promise<HireRow> => requireHire(pool, ctx.desk!.id, ctx.params.id);

export const moneyHeld = async (db: Db, deskId: string): Promise<number> =>
  (await only<{ held: number }>(db, "SELECT COALESCE(SUM(pennies),0)::bigint AS held FROM ledger_lines WHERE desk_id=$1 AND account='clientMoney'", [deskId])).held;

export const bookings = async (deskId: string): Promise<{ hire: HireRow; vehicles: VehicleMoney[]; money: Awaited<ReturnType<typeof hireMoney>> }[]> => {
  const hires = await rows<HireRow>(pool, "SELECT * FROM hires WHERE desk_id=$1 AND accepted_at IS NOT NULL AND merged_into IS NULL ORDER BY created_at DESC, id", [deskId]);
  const out = [];
  for (const hire of hires) {
    const vehicles = await vehiclesOf(pool, hire.id);
    out.push({ hire, vehicles, money: await hireMoney(pool, hire.id, vehicles) });
  }
  return out;
};

const readStatement = async (deskId: string, content: string): Promise<Record<string, unknown>> => {
  const lines = parseDelimited(content);
  if ((lines[0] ?? []).map((c) => c.trim()).join(",") !== HEADER) throw refused("The first line has to read Date,Description,Amount,Balance.", "file");
  const data = lines.slice(1);
  if (data.length > 2000) throw refused("This file has more than 2,000 rows.", "file");
  const matched: StatementRow[] = [];
  const unmatched: StatementRow[] = [];
  const moneyOut: StatementRow[] = [];
  const alreadySeen: StatementRow[] = [];
  const refusedRows: { row: number; message: string }[] = [];
  const hires = new Set((await rows<Pick<HireRow, "id">>(pool, "SELECT id FROM hires WHERE desk_id=$1 AND merged_into IS NULL", [deskId])).map((h) => h.id));
  const seen = new Set((await rows<{ date: string; amount: number; description: string; balance: string }>(pool, "SELECT date,amount,description,balance FROM statement_rows WHERE desk_id=$1", [deskId])).map((r) => `${r.date}|${r.amount}|${r.description}|${r.balance}`));
  data.forEach((cells, index) => {
    const row = index + 2;
    const [dateText = "", description = "", amountText = "", balance = ""] = cells;
    const date = typedToDate(dateText);
    if (!date) return void refusedRows.push({ row, message: `Row ${row}: ${dateText} is not a real date.` });
    const pennies = statementAmount(amountText);
    if (pennies === null) return void refusedRows.push({ row, message: `Row ${row}: ${amountText} is not an amount.` });
    const shown = { row, date, description, amount: moneyText(pennies), balance };
    const key = `${date}|${pennies}|${description}|${balance}`;
    if (pennies <= 0) return void moneyOut.push(shown);
    if (seen.has(key)) return void alreadySeen.push(shown);
    seen.add(key);
    const reference = referencesIn(description).find((r) => hires.has(r));
    if (reference) matched.push({ ...shown, reference });
    else unmatched.push(shown);
  });
  const previewId = newId("PV");
  await pool.query("INSERT INTO statement_previews (id,desk_id,matched,created_at) VALUES ($1,$2,$3,$4)", [previewId, deskId, JSON.stringify(matched), nowSeconds()]);
  return { previewId, matched, unmatched, moneyOut, alreadySeen, refused: refusedRows };
};

const paymentCsv = async (deskId: string, hireId: string | null): Promise<Buffer> => {
  const lines = await rows<LedgerLineRow & { customer: string; customer_state: string; seats: number | null }>(pool,
    `SELECT l.*, h.name AS customer, c.state AS customer_state, v.seats FROM ledger_lines l JOIN hires h ON h.id=l.hire_id JOIN customers c ON c.id=h.customer_id LEFT JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.desk_id=$1 AND ($2::text IS NULL OR l.hire_id=$2) ORDER BY l.seq`, [deskId, hireId]);
  return csvFile([
    ["Date", "Reference", "Customer", "Vehicle", "Account", "Amount", "Description"],
    ...lines.map((l) => [ukDate(l.at), l.hire_id, l.customer_state === "erased" ? ERASED_NAME : l.customer, l.seats ?? "", ACCOUNT_NAMES[l.account as Account], moneyText(l.pennies), l.description]),
  ]);
};

// ---- Changes and cancellations.
const parseChange = (body: Untrusted, vehicles: VehicleMoney[]): { depart: LocalDateTime | null; stops: string[] | null; edits: Map<string, { bought: number; margin: number }> } => {
  let depart: LocalDateTime | null = null;
  if (body.departAt) {
    const at = body.departAt;
    const refusal = missingHourGuard(at);
    if (refusal) throw refused(refusal, "departAt");
    depart = at;
  }
  let stops: string[] | null = null;
  if (body.stops !== undefined) {
    if (!Array.isArray(body.stops) || body.stops.length < 2 || body.stops.some((s: unknown) => typeof s !== "string" || !s.trim())) throw refused("Enter the pick-up address.", "stops");
    stops = body.stops.map((s: string) => s.trim());
  }
  const edits = new Map<string, { bought: number; margin: number }>();
  for (const typed of objectsIn(body.vehicles)) {
    const vehicle = vehicles.find((v) => v.id === typed.id);
    if (!vehicle) throw notFound();
    const bought = typed.boughtPrice === undefined ? vehicle.bought : parseMoney(typed.boughtPrice);
    if (bought === null) throw refused(AMOUNT_COPY, "boughtPrice");
    const margin = typed.marginPercent === undefined ? vehicle.margin_halves : parseMargin(typed.marginPercent);
    if (margin === null) throw refused(MARGIN_COPY, "marginPercent");
    edits.set(vehicle.id, { bought, margin });
  }
  return { depart, stops, edits };
};
type ChangedVehicle = Pick<VehicleMoney, "id" | "seats" | "bought" | "margin_halves" | "total" | "deposit">;
const sideView = (stops: string[], depart: LocalDateTime, vehicles: ChangedVehicle[]): Record<string, unknown> => ({
  departAt: depart, stops,
  vehicles: vehicles.map((v) => ({ id: v.id, seats: v.seats, boughtPrice: moneyText(v.bought), marginPercent: marginText(v.margin_halves), total: moneyText(v.total), deposit: moneyText(v.deposit) })),
  total: moneyText(vehicles.reduce((a, v) => a + v.total, 0)),
});
const workOutChange = async (db: Db, hire: HireRow, body: Untrusted) => {
  const vehicles = await vehiclesOf(db, hire.id);
  const stopsNow = (await stopsOf(db, hire.id)).map((s) => s.text);
  const { depart, stops, edits } = parseChange(body, vehicles);
  const rates = await rateInForce(db, hire.desk_id, ukDate(nowSeconds()));
  const next = vehicles.map((v) => {
    const edit = edits.get(v.id);
    const figures = { seats: v.seats, bought: edit?.bought ?? v.bought, margin_halves: edit?.margin ?? v.margin_halves, charges: v.charges };
    const total = vehicleTotals(figures).total;
    return { ...v, ...figures, total, moved: total !== v.total };
  });
  const priceMoved = next.some((v) => v.moved);
  const withDeposits = next.map((v) => ({ ...v, deposit: priceMoved ? depositFor(v.seats, v.total, rates) : v.deposit }));
  const currentDepart = localJson(hire.depart_date, hire.depart_time, hire.depart_repeated) as LocalDateTime;
  const lines = withDeposits.map((v, i) => ({
    vehicleId: v.id,
    refundsDue: Math.max(vehicles[i].retained - v.total, 0),
    owed: Math.max(v.total - vehicles[i].retained, 0),
  }));
  return {
    priceMoved, depart, stops, edits, rates, vehicles: withDeposits, before: vehicles, lines,
    view: {
      old: sideView(stopsNow, currentDepart, vehicles), new: sideView(stops ?? stopsNow, depart ?? currentDepart, withDeposits), priceMoved,
      lines: lines.map((l) => ({ vehicleId: l.vehicleId, refundsDue: moneyText(l.refundsDue), owed: moneyText(l.owed) })),
    },
  };
};
const syncStops = async (tx: Db, hireId: string, texts: string[]): Promise<void> => {
  const existing = await stopsOf(tx, hireId);
  const used = new Set<string>();
  for (const [position, text] of texts.entries()) {
    const same = existing.find((s) => s.text === text && !used.has(s.id));
    if (same) {
      used.add(same.id);
      await tx.query("UPDATE stops SET position=$2 WHERE id=$1", [same.id, position]);
    } else {
      const id = newId("ST");
      used.add(id);
      await tx.query("INSERT INTO stops (id,hire_id,position,text,checked) VALUES ($1,$2,$3,$4,false)", [id, hireId, position, text]);
    }
  }
  for (const stop of existing) if (!used.has(stop.id)) await tx.query("DELETE FROM stops WHERE id=$1", [stop.id]);
  await tx.query("UPDATE hires SET legs=NULL WHERE id=$1", [hireId]);
};

/** Days are UK calendar dates from the typed notice; the charge sits between the deposit and the vehicle's total. */
const cancellationCharge = (days: number, total: number, deposit: number): number => {
  const share = days >= 30 ? 0 : days >= 15 ? halfUp(total * 25, 100) : days >= 8 ? halfUp(total * 50, 100) : total;
  return Math.min(Math.max(share, deposit), total);
};
const workOutCancellation = async (db: Db, hire: HireRow, body: Untrusted): Promise<Cancellation | null> => {
  const at = body.noticeAt;
  if (!at || !isRealDate(at.date ?? "")) throw refused("Enter a date as DD/MM/YYYY.", "noticeAt");
  if (!isTime(at.time)) throw refused("Choose an hour and minutes.", "noticeAt");
  if (body.by !== "customer" && body.by !== "arranger") throw refused("Say who gave notice.", "by");
  if (hire.cancellation) return null;
  const vehicles = await vehiclesOf(db, hire.id);
  const now = nowSeconds();
  if (now >= vehicles.reduce((a, v) => Math.min(a, v.depart_instant), hire.depart_instant)) throw conflict("departureGone", "This departure has already gone.");
  const credit = (await ledgerOf(db, hire.id)).filter((l) => l.account === "clientMoney" && l.part === "credit").reduce((a, l) => a + l.pennies, 0);
  return {
    id: newId("CX"), noticeAt: instantText(toInstant(at)), by: body.by,
    lines: vehicles.map((v, i) => {
      const days = daysBetween(at.date, v.depart_date);
      const charge = body.by === "arranger" ? 0 : cancellationCharge(days, v.total, v.deposit);
      const paid = v.retained + (i === 0 ? credit : 0);
      return { vehicleId: v.id, days, charge: moneyText(charge), paid: moneyText(paid), refundsDue: moneyText(Math.max(paid - charge, 0)), owed: moneyText(Math.max(charge - paid, 0)) };
    }),
  };
};

export const moneyRoutes: ApiRoute[] = [
  route({
    method: "POST", path: "/api/payments/statements/preview", body: "csv", limit: STATEMENT_LIMIT,
    run: async ({ text, desk }) => ok(await readStatement(desk!.id, text)),
  }),
  route({
    method: "POST", path: "/api/payments/statements/:previewId/bring-in", body: "json",
    load: async (ctx) => {
      const preview = await one<StatementPreviewRow>(pool, "SELECT * FROM statement_previews WHERE id=$1 AND desk_id=$2", [ctx.params.previewId, ctx.desk!.id]);
      if (!preview) throw notFound();
      return preview;
    },
    run: async ({ desk, loaded }) => transaction(async (tx) => {
      await tx.query("SELECT id FROM desks WHERE id=$1 FOR UPDATE", [desk!.id]);
      let broughtIn = 0;
      const at = nowSeconds();
      for (const row of loaded.matched) {
        const pennies = parseMoney(row.amount) as number;
        const fresh = await one(tx, "INSERT INTO statement_rows (desk_id,date,amount,description,balance) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1 AS made", [desk!.id, row.date, pennies, row.description, row.balance]);
        if (!fresh) continue;
        await allocatePayment(tx, desk!.id, row.reference as string, pennies, row.description, at);
        broughtIn += 1;
      }
      return ok({ broughtIn, moneyHeld: moneyText(await moneyHeld(tx, desk!.id)) });
    }),
  }),
  route({
    method: "GET", path: "/api/payments",
    run: async ({ desk }) => ok({
      moneyHeld: moneyText(await moneyHeld(pool, desk!.id)),
      bookings: (await bookings(desk!.id)).map(({ hire, money }) => ({ id: hire.id, reference: hire.id, customerName: hire.name, paymentState: money.paymentState, paid: moneyText(money.paid), owed: moneyText(money.owed), credit: moneyText(money.credit) })),
    }),
  }),
  route({
    method: "GET", path: "/api/hires/:id/ledger", load: loadHire,
    run: async ({ loaded }) => {
      const lines = await ledgerOf(pool, loaded.id);
      return ok({ lines: lines.map(lineJson), sum: moneyText(lines.reduce((a, l) => a + l.pennies, 0)) });
    },
  }),
  route({
    method: "POST", path: "/api/hires/:id/refunds", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      const pennies = parseMoney(json.amount);
      if (pennies === null || pennies === 0) throw refused(AMOUNT_COPY, "amount");
      return transaction(async (tx) => {
        await tx.query("SELECT id FROM hires WHERE id=$1 FOR UPDATE", [loaded.id]);
        const vehicle = (await vehiclesOf(tx, loaded.id)).find((v) => v.id === json.vehicleId);
        if (!vehicle) throw notFound();
        if (pennies > vehicle.refundsDue) throw conflict("aboveDue", "That is more than this vehicle's refunds due.");
        const at = nowSeconds();
        await writeMovement(tx, { deskId: loaded.desk_id, hireId: loaded.id, vehicleId: vehicle.id, plus: "refundsDue", minus: "clientMoney", pennies, at, part: "refundPaid", description: "Refund paid" });
        const lines = await ledgerOf(tx, loaded.id);
        return ok({ lines: lines.slice(-2).map(lineJson) }, 201);
      });
    },
  }),
  route({
    method: "GET", path: "/api/payments/download",
    run: async ({ desk }) => ({ status: 200, raw: await paymentCsv(desk!.id, null), headers: downloadHeaders("payments.csv", "text/csv; charset=utf-8") }),
  }),
  route({
    method: "GET", path: "/api/hires/:id/payments/download", load: loadHire,
    run: async ({ desk, loaded }) => ({ status: 200, raw: await paymentCsv(desk!.id, loaded.id), headers: downloadHeaders(`${loaded.name} payments.csv`, "text/csv; charset=utf-8") }),
  }),
  route({
    method: "POST", path: "/api/hires/:id/changes/preview", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      if (loaded.accepted_at === null) throw conflict("notAccepted", "This booking has no accepted quote yet.");
      return ok((await workOutChange(pool, loaded, json)).view);
    },
  }),
  route({
    method: "POST", path: "/api/hires/:id/changes", body: "json", load: loadHire,
    run: async ({ json, desk, loaded }) => {
      const customer = await only<CustomerRow>(pool, "SELECT * FROM customers WHERE id=$1", [loaded.customer_id]);
      if (loaded.accepted_at === null) throw conflict("notAccepted", "This booking has no accepted quote yet.");
      const result = await transaction(async (tx) => {
        const hire = await requireHire(tx, desk!.id, loaded.id, true);
        const worked = await workOutChange(tx, hire, json);
        const at = nowSeconds();
        for (const v of worked.vehicles) await tx.query("UPDATE vehicles SET bought=$2,margin_halves=$3,deposit=$4 WHERE id=$1", [v.id, v.bought, v.margin_halves, v.deposit]);
        if (worked.stops) await syncStops(tx, hire.id, worked.stops);
        if (worked.depart) {
          await tx.query("SELECT id FROM desks WHERE id=$1 FOR UPDATE", [hire.desk_id]);
          for (const run of await rows<RunRow>(tx, "SELECT * FROM runs WHERE hire_id=$1", [hire.id])) {
            const clash = await clashAtDeparture(tx, run, worked.depart);
            if (clash) throw clash;
            await setDeparture(tx, run, worked.depart);
          }
        }
        for (const line of worked.lines) {
          if (line.refundsDue > 0) await writeMovement(tx, { deskId: hire.desk_id, hireId: hire.id, vehicleId: line.vehicleId, plus: "hireIncome", minus: "refundsDue", pennies: line.refundsDue, at, part: "refundDue", description: "Refund due" });
        }
        let current = await only<HireRow>(tx, "SELECT * FROM hires WHERE id=$1", [hire.id]);
        if (worked.priceMoved) {
          const token = await replaceQuotePage(tx, hire, customer.language);
          current = await only<HireRow>(tx, "UPDATE hires SET quote_token=$2,quote_sent_at=$3,quote_ends_at=$4,rate_table_id=$5,accepted_at=NULL,deposit_said_sent=false,quote_mailed=false,quote_edited=false,quote_version=quote_version+1,quote_changed_at=$3 WHERE id=$1 RETURNING *",
            [hire.id, token, at, quoteEnds(at), worked.rates.id]);
        }
        const id = newId("CH");
        await tx.query("INSERT INTO changes (id,hire_id,at,body) VALUES ($1,$2,$3,$4)", [id, hire.id, at, JSON.stringify(worked.view)]);
        return { worked, current, id };
      });
      if (result.worked.priceMoved) {
        await quoteMail(result.current, customer, await vehiclesOf(pool, loaded.id))
          .then(() => pool.query("UPDATE hires SET quote_mailed=true WHERE id=$1", [loaded.id]), (error) => console.error(error));
      }
      if (result.worked.depart || result.worked.stops) await tellDriverOfChange(loaded.id);
      return ok({ ...result.worked.view, id: result.id, quotePath: `/q/${result.current.quote_token}` }, 201);
    },
  }),
  route({
    method: "GET", path: "/api/hires/:id/changes", load: loadHire,
    run: async ({ loaded }) => ok({
      changes: (await rows<ChangeRow>(pool, "SELECT * FROM changes WHERE hire_id=$1 ORDER BY at, id", [loaded.id])).map((c) => ({ id: c.id, at: instantText(c.at), ...c.body })),
      cancellation: loaded.cancellation,
    }),
  }),
  route({
    method: "POST", path: "/api/hires/:id/cancel/preview", body: "json", load: loadHire,
    run: async ({ json, loaded }) => ok({ cancellation: (await workOutCancellation(pool, loaded, json)) ?? loaded.cancellation }),
  }),
  route({
    method: "POST", path: "/api/hires/:id/cancel", body: "json", load: loadHire,
    run: async ({ json, desk, loaded }) => transaction(async (tx) => {
      const hire = await requireHire(tx, desk!.id, loaded.id, true);
      const cancellation = await workOutCancellation(tx, hire, json);
      if (!cancellation) return ok({ cancellation: hire.cancellation });
      const at = nowSeconds();
      for (const line of cancellation.lines) {
        const due = parseMoney(line.refundsDue) as number;
        if (due > 0) await writeMovement(tx, { deskId: hire.desk_id, hireId: hire.id, vehicleId: line.vehicleId, plus: "hireIncome", minus: "refundsDue", pennies: due, at, part: "refundDue", description: "Refund due" });
      }
      await tx.query("UPDATE hires SET cancellation=$2 WHERE id=$1", [hire.id, JSON.stringify(cancellation)]);
      return ok({ cancellation });
    }),
  }),
];
