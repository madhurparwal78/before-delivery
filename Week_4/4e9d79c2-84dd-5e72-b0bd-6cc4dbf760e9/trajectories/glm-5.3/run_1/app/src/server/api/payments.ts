import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson, readText } from "../http.js";
import { parseCsv, csvBody, fileHeaders } from "../csv.js";
import { tx, vehiclesFor, moneyHeld } from "../repo.js";
import { penniesToString, type Pennies } from "../money.js";
import { parseDDMMYYYY } from "../domain.js";
import { vehicleMoney } from "./hires.js";

const REF_RE = /CV[-\s]?([0123456789ABCDEFGHJKMNPQRSTVWXYZOIloi]{5})(?![A-Za-z0-9])/gi;

/** Statement reference grammar, per Business rules. */
export function findReference(description: string): string | null {
  const matches = [...description.matchAll(REF_RE)];
  if (matches.length === 0) return null;
  const raw = matches[0][1].toUpperCase().replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1");
  if (raw.length !== 5) return null;
  return "CV-" + raw;
}

export function registerPaymentApi(app: Express, ctx: Ctx): void {
  app.post("/api/payments/statements/preview", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 2_000_000);
    const parsed = parseCsv(text, ["Date", "Description", "Amount", "Balance"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Date,Description,Amount,Balance." }, "The first line has to read Date,Description,Amount,Balance.");
    if (parsed.rows.length > 2000) throw errors.invalid({ file: "This file has more than 2,000 rows." }, "This file has more than 2,000 rows.");
    const matched: Record<string, unknown>[] = [];
    const unmatched: Record<string, unknown>[] = [];
    const moneyOut: Record<string, unknown>[] = [];
    const alreadySeen: Record<string, unknown>[] = [];
    const refused: { row: number; message: string }[] = [];
    const fingerprintRows: string[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const cells = parsed.rows[i];
      const rowNumber = parsed.rowNumbers[i];
      const dateText = (cells[0] ?? "").trim();
      const description = (cells[1] ?? "").trim();
      const amountText = (cells[2] ?? "").trim().replace(/^"|"$/g, "");
      const balanceText = (cells[3] ?? "").trim().replace(/^"|"$/g, "");
      const iso = parseDDMMYYYY(dateText);
      if (!iso) {
        refused.push({ row: rowNumber, message: `Row ${rowNumber}: ${dateText} is not a real date.` });
        continue;
      }
      const amount = parseStatementAmount(amountText);
      if (amount === null) {
        refused.push({ row: rowNumber, message: `Row ${rowNumber}: ${amountText} is not an amount.` });
        continue;
      }
      const balance = balanceText === "" ? null : parseStatementAmount(balanceText);
      const base = { row: rowNumber, date: iso, description, amount: penniesToString(amount), balance: balance === null ? null : penniesToString(balance) };
      fingerprintRows.push(`${iso}|${description}|${amount}|${balance ?? ""}`);
      const seen = await ctx.db.query(
        "SELECT 1 FROM statement_rows WHERE desk_id=$1 AND date=$2 AND description=$3 AND amount_pennies=$4 AND COALESCE(balance_pennies::text,'')=COALESCE($5,'')",
        [deskId, iso, description, String(amount), balance === null ? "" : String(balance)]
      );
      const reference = amount > 0 ? findReference(description) : null;
      if (seen.rows[0]) {
        alreadySeen.push({ ...base, reference });
      } else if (amount > 0 && reference) {
        matched.push({ ...base, reference });
      } else if (amount > 0) {
        unmatched.push(base);
      } else {
        moneyOut.push(base);
      }
    }
    const fingerprint = createHash("sha256").update(deskId + "|" + fingerprintRows.join("\n")).digest("hex");
    const previewId = "PV-" + fingerprint.slice(0, 12);
    await ctx.db.query(
      `INSERT INTO statement_previews (id, desk_id, fingerprint, payload, created_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (id) DO UPDATE SET payload=$4, created_at=NOW()`,
      [previewId, deskId, fingerprint, JSON.stringify({ matched, unmatched, moneyOut, alreadySeen, refused })]
    );
    res.json({ previewId, matched, unmatched, moneyOut, alreadySeen, refused });
  });

  app.post("/api/payments/statements/:previewId/bring-in", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const preview = await ctx.db.query("SELECT * FROM statement_previews WHERE desk_id=$1 AND id=$2", [deskId, req.params.previewId]);
    if (!preview.rows[0]) throw errors.notFound();
    const statementId = "ST-" + String(preview.rows[0].fingerprint).slice(0, 16);
    const already = await ctx.db.query("SELECT 1 FROM statements WHERE desk_id=$1 AND id=$2", [deskId, statementId]);
    if (already.rows[0]) {
      res.json({ broughtIn: 0, moneyHeld: penniesToString(await moneyHeld(ctx.db, deskId)) });
      return;
    }
    const payloadRows = (preview.rows[0].payload ?? { matched: [] }) as { matched?: { row: number; date: string; description: string; amount: string; balance: string | null; reference: string }[] };
    const rows = payloadRows.matched ?? [];
    let brought = 0;
    await tx(ctx.db, async (client) => {
      await client.query("INSERT INTO statements (id, desk_id, fingerprint, brought_at) VALUES ($1,$2,$3,NOW())", [statementId, deskId, preview.rows[0].fingerprint]);
      for (const r of rows) {
        const seen = await client.query(
          "SELECT 1 FROM statement_rows WHERE desk_id=$1 AND date=$2 AND description=$3 AND amount_pennies=$4 AND COALESCE(balance_pennies::text,'')=COALESCE($5,'')",
          [deskId, r.date, r.description, String(Math.round(Number(r.amount) * 100)), r.balance === null ? "" : String(Math.round(Number(r.balance) * 100))]
        );
        if (seen.rows[0]) continue;
        await client.query(
          "INSERT INTO statement_rows (desk_id, statement_id, row_number, date, description, amount_pennies, balance_pennies, reference, already_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)",
          [deskId, statementId, r.row, r.date, r.description, String(Math.round(Number(r.amount) * 100)), r.balance === null ? null : String(Math.round(Number(r.balance) * 100)), r.reference]
        );
        const hire = await client.query("SELECT * FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, r.reference]);
        if (!hire.rows[0]) continue;
        await allocateToVehicles(client, deskId, hire.rows[0], Math.round(Number(r.amount) * 100), r.description);
        brought++;
      }
    });
    res.json({ broughtIn: brought, moneyHeld: penniesToString(await moneyHeld(ctx.db, deskId)) });
  });

  app.get("/api/payments", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const held = await moneyHeld(ctx.db, deskId);
    const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND stage<>'enquiry' ORDER BY depart_instant", [deskId]);
    const bookings: Record<string, unknown>[] = [];
    for (const h of hires.rows) {
      const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
      const money = await vehicleMoney(ctx, deskId, vehicles);
      const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [h.customer_id]);
      bookings.push({
        id: String(h.id),
        reference: String(h.reference),
        customerName: customer.rows[0]?.name ?? "",
        paymentState: money.paymentState,
        paid: penniesToString(money.paid),
        owed: penniesToString(money.owed),
        credit: penniesToString(money.credit),
      });
    }
    res.json({ moneyHeld: penniesToString(held), bookings });
  });

  app.get("/api/hires/:id/ledger", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const lines = await ctx.db.query("SELECT * FROM ledger_lines WHERE desk_id=$1 AND hire_id=$2 ORDER BY at, id", [deskId, hire.rows[0].id]);
    const ACCOUNT_LABEL: Record<string, string> = {
      clientMoney: "Client money",
      hireIncome: "Hire income",
      refundsDue: "Refunds due",
      operatorOwed: "Operator owed",
    };
    const sum = lines.rows.reduce((s: number, x) => s + Number(x.amount_pennies), 0);
    res.json({
      lines: lines.rows.map((x) => ({
        id: String(x.id),
        movementId: String(x.movement_id),
        account: ACCOUNT_LABEL[String(x.account)] ?? String(x.account),
        amount: penniesToString(Number(x.amount_pennies)),
        at: (x.at as Date).toISOString().replace(/\.\d{3}Z$/, "Z"),
        vehicleId: x.vehicle_id ? String(x.vehicle_id) : null,
      })),
      sum: penniesToString(sum),
    });
  });

  app.post("/api/hires/:id/refunds", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const amount = typeof body.amount === "string" ? Math.round(Number(body.amount) * 100) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw errors.invalid({ amount: "Enter the amount in pounds and pence." });
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, vehicleId, hire.rows[0].id]);
    if (!vehicle.rows[0]) throw errors.notFound();
    const due = await refundsDueFor(ctx, deskId, vehicleId, vehicle.rows[0]);
    if (amount > due) throw errors.state("aboveDue", "We can't find that.");
    const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await tx(ctx.db, async (client) => {
      await client.query(
        `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
         ($1,$2,$3,$4,'refundPaid',$5,'clientMoney',$6,NOW(),'Refund paid'),
         ($7,$2,$3,$4,'refundPaid',$5,'refundsDue',$8,NOW(),'Refund paid')`,
        [movementId + "-A", deskId, hire.rows[0].id, movementId, vehicleId, String(-amount), movementId + "-B", String(amount)]
      );
    });
    res.status(201).json({ id: movementId });
  });

  app.get("/api/payments/download", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const lines = await ctx.db.query(
      "SELECT l.*, v.seats AS vehicle_seats FROM ledger_lines l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.desk_id=$1 ORDER BY l.at, l.id",
      [deskId]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders("payments", "csv"));
    res.send(paymentCsv(lines.rows));
  });

  app.get("/api/hires/:id/payments/download", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const lines = await ctx.db.query(
      "SELECT l.*, v.seats AS vehicle_seats FROM ledger_lines l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.desk_id=$1 AND l.hire_id=$2 ORDER BY l.at, l.id",
      [deskId, hire.rows[0].id]
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders(String(customer.rows[0]?.name ?? "customer") + " payments", "csv"));
    res.send(paymentCsv(lines.rows));
  });
}

function parseStatementAmount(text: string): Pennies | null {
  const t = text.trim().replace(/,/g, "");
  const m = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = Number(m[1]) * 100;
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  return t.startsWith("-") ? -(whole + frac) : whole + frac;
}

/** Money goes to vehicles by departure then list order, first deposits then balances, per DP-33. */
async function allocateToVehicles(
  client: { query: Function },
  deskId: string,
  hire: Record<string, unknown>,
  amount: Pennies,
  description: string
): Promise<void> {
  const vehicles = (await client.query("SELECT * FROM vehicles WHERE desk_id=$1 AND hire_id=$2 ORDER BY depart_instant, position", [deskId, hire.id]))
    .rows as Record<string, unknown>[];
  const states: { id: string; deposit: Pennies; total: Pennies; depositPaid: Pennies; balancePaid: Pennies }[] = [];
  for (const v of vehicles) {
    const r = await client.query(
      `SELECT COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='deposit'),0) AS deposit,
              COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='balance'),0) AS balance
       FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
      [deskId, v.id]
    );
    states.push({
      id: String(v.id),
      deposit: Number(v.deposit_pennies),
      total: Number(v.total_pennies),
      depositPaid: Number(r.rows[0].deposit),
      balancePaid: Number(r.rows[0].balance),
    });
  }
  let left = amount;
  for (const s of states) {
    if (left <= 0) break;
    const depositOwed = Math.max(0, s.deposit - s.depositPaid);
    const take = Math.min(left, depositOwed);
    if (take > 0) {
      await writeMovementLines(client, deskId, String(hire.id), s.id, take, "deposit", description);
      left -= take;
    }
  }
  for (const s of states) {
    if (left <= 0) break;
    const balanceOwed = Math.max(0, s.total - s.deposit - s.balancePaid);
    const take = Math.min(left, balanceOwed);
    if (take > 0) {
      await writeMovementLines(client, deskId, String(hire.id), s.id, take, "balance", description);
      left -= take;
    }
  }
  if (left > 0) {
    await writeMovementLines(client, deskId, String(hire.id), null, left, "credit", description);
  }
}

async function writeMovementLines(
  client: { query: Function },
  deskId: string,
  hireId: string,
  vehicleId: string | null,
  amount: Pennies,
  kind: string,
  description: string
): Promise<void> {
  const movementId = "MV-" + Math.random().toString(36).slice(2, 10).toUpperCase() + "-" + kind;
  await client.query(
    `INSERT INTO ledger_lines (id, desk_id, hire_id, movement_id, movement_kind, vehicle_id, account, amount_pennies, at, description) VALUES
     ($1,$2,$3,$4,$10,$5,'clientMoney',$6,NOW(),$7),
     ($8,$2,$3,$4,$10,$5,'hireIncome',$9,NOW(),$7)`,
    [movementId + "-A", deskId, hireId, movementId, vehicleId, String(amount), description, movementId + "-B", String(-amount), kind]
  );
}

export async function refundsDueFor(ctx: Ctx, deskId: string, vehicleId: string, vehicle: Record<string, unknown>): Promise<Pennies> {
  const r = await ctx.db.query(
    `SELECT COALESCE(SUM(amount_pennies),0) AS due FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='refundsDue'`,
    [deskId, vehicleId]
  );
  const paid = await ctx.db.query(
    `SELECT COALESCE(SUM(amount_pennies),0) AS p FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='clientMoney'`,
    [deskId, vehicleId]
  );
  void vehicle;
  return Math.max(0, Number(paid.rows[0].p) - Number(vehicle.total_pennies ?? 0) + Number(r.rows[0].due));
}

function paymentCsv(rows: Record<string, unknown>[]): string {
  const ACCOUNT: Record<string, string> = {
    clientMoney: "Client money",
    hireIncome: "Hire income",
    refundsDue: "Refunds due",
    operatorOwed: "Operator owed",
  };
  const out = rows.map((x) => [
    (x.at as Date).toISOString().slice(0, 10),
    "",
    "",
    x.vehicle_seats ? String(x.vehicle_seats) : "",
    ACCOUNT[String(x.account)] ?? String(x.account),
    (Number(x.amount_pennies) / 100).toFixed(2),
    String(x.description ?? ""),
  ]);
  return csvBody(["Date", "Reference", "Customer", "Vehicle", "Account", "Amount", "Description"], out);
}
