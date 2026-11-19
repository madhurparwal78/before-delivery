import type { Ctx } from "./app.js";
import { sendMail } from "./services.js";
import { s3Delete, s3Get, s3Put, objectKeyForDocument } from "./s3.js";
import { renderPdf } from "./services.js";
import { ukDateString, addDays } from "./uktime.js";
import { penniesToString } from "./money.js";
import { paperLabel } from "./api/operators.js";
import { longDate } from "./api/operators.js";
import { vehiclesFor, isoDate } from "./repo.js";

/** Daily paper checks, balance reminders, erasures and the seeded invoice retry. */
export function startJobs(ctx: Ctx): void {
  let lastRunDay = "";
  const daily = async () => {
    try {
      const today = ukDateString(new Date());
      const desks = await ctx.db.query("SELECT id, email FROM desks");
      for (const desk of desks.rows) {
        await paperChecks(ctx, String(desk.id), String(desk.email));
        await balanceReminders(ctx, String(desk.id));
      }
      if (today !== lastRunDay) {
        lastRunDay = today;
      }
      await eraseCustomers(ctx);
      await retrySeedInvoice(ctx);
    } catch {
      // the next tick tries again
    }
  };
  const intervalMs = ctx.cfg.dailyRunAt === "any" ? 2000 : 60000;
  const timer = setInterval(daily, intervalMs);
  const hourly = setInterval(async () => {
    try {
      await eraseCustomers(ctx);
      await retrySeedInvoice(ctx);
    } catch {
      // ignore
    }
  }, 2000);
  void timer;
  void hourly;
  void lastRunDay;
  setTimeout(daily, 500);
}

async function paperChecks(ctx: Ctx, deskId: string, deskEmail: string): Promise<void> {
  const operators = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1", [deskId]);
  const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND cancelled=FALSE", [deskId]);
  const today = ukDateString(new Date());
  for (const h of hires.rows) {
    const ret = h.return_instant as Date | null;
    const lastDay = ukDateString(ret ?? (h.depart_instant as Date));
    const papers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, String(h.reference)]).catch(() => null);
    void papers;
    const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
    const operatorIds = new Set(vehicles.map((v) => v.operatorId).filter(Boolean) as string[]);
    for (const op of operators.rows) {
      if (!operatorIds.has(String(op.id))) continue;
      const opPapers = await ctx.db.query("SELECT * FROM papers WHERE desk_id=$1 AND operator_id=$2", [deskId, String(op.id)]);
      for (const p of opPapers.rows) {
        const endsOn = isoDate(p.ends_on);
        const days = dayDiff(endsOn, today);
        if (days < 0 || days > 30) continue;
        const key = `${deskId}|${op.id}|${p.kind}|${endsOn}`;
        const already = await ctx.db.query("SELECT 1 FROM daily_runs WHERE desk_id=$1 AND day=$2 AND hire_id=$3 AND kind=$4", [
          deskId,
          key,
          String(h.id),
          "paper",
        ]);
        if (already.rows[0]) continue;
        await ctx.db.query("INSERT INTO daily_runs (desk_id, day, hire_id, kind, done) VALUES ($1,$2,$3,'paper',TRUE) ON CONFLICT DO NOTHING", [
          deskId,
          key,
          String(h.id),
        ]);
        try {
          await sendMail(ctx.cfg, {
            to: deskEmail,
            subject: `${paperLabel(String(p.kind))} for ${String(op.name)} ends on ${longDate(endsOn)}`,
            text: `${paperLabel(String(p.kind))} for ${String(op.name)} ends on ${longDate(endsOn)}`,
          });
        } catch {
          // a failed mail tries again at the next daily check
          await ctx.db.query("DELETE FROM daily_runs WHERE desk_id=$1 AND day=$2 AND hire_id=$3 AND kind='paper'", [deskId, key, String(h.id)]);
        }
      }
    }
    void lastDay;
  }
}

function dayDiff(a: string, b: string): number {
  const toDays = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return Math.round(toDays(a) - toDays(b));
}

async function balanceReminders(ctx: Ctx, deskId: string): Promise<void> {
  const today = ukDateString(new Date());
  const hires = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND cancelled=FALSE AND stage<>'quoted'", [deskId]);
  for (const h of hires.rows) {
    const departDate = String(h.depart_date);
    const daysToDeparture = dayDiff(departDate, today);
    if (daysToDeparture > 10 || daysToDeparture <= 7) continue;
    const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
    const money = await (await import("./api/hires.js")).vehicleMoney(ctx, deskId, vehicles);
    if (money.owed <= 0) continue;
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [h.customer_id]);
    for (const v of vehicles) {
      const already = await ctx.db.query("SELECT 1 FROM reminders WHERE desk_id=$1 AND hire_id=$2 AND vehicle_id=$3", [deskId, h.id, v.id]);
      if (already.rows[0]) continue;
      const owedForVehicle = Math.max(0, v.total - v.deposit);
      if (owedForVehicle <= 0) continue;
      const dueOn = addDays(departDate, -7);
      try {
        await sendMail(ctx.cfg, {
          to: String(customer.rows[0]?.email ?? ""),
          subject: `Balance reminder ${String(h.reference)}`,
          text: `Balance reminder ${String(h.reference)}\n\nAmount owed: £${penniesToString(money.owed)}\nDue date: ${longDate(dueOn)}\nQuote reference: ${String(h.reference)}`,
        });
        await ctx.db.query("INSERT INTO reminders (desk_id, hire_id, vehicle_id, sent_at) VALUES ($1,$2,$3,NOW())", [deskId, h.id, v.id]);
      } catch {
        // try again next check
      }
    }
  }
}

export async function eraseCustomers(ctx: Ctx): Promise<void> {
  const due = await ctx.db.query(
    "SELECT * FROM customers WHERE state='closed' AND erase_at IS NOT NULL AND erase_at <= NOW()",
    []
  );
  for (const c of due.rows) {
    const deskId = String(c.desk_id);
    await ctx.db.query("UPDATE customers SET state='erasing' WHERE id=$1", [c.id]);
    try {
      const papers = await ctx.db.query("SELECT object_key FROM papers WHERE desk_id=$1", [deskId]);
      const files = await ctx.db.query("SELECT object_key FROM passenger_files WHERE desk_id=$1", [deskId]);
      const docs = await ctx.db.query("SELECT object_key FROM documents WHERE desk_id=$1 AND customer_name=$2", [deskId, c.name]);
      const keys = [...papers.rows, ...files.rows, ...docs.rows].map((x) => String(x.object_key)).filter(Boolean);
      const probe = keys.length ? await Promise.all(keys.map((k) => s3Get(ctx.cfg, k))) : await s3Get(ctx.cfg, "desks/probe/none");
      void probe;
      await Promise.all(keys.map((k) => s3Delete(ctx.cfg, k)));
      await ctx.db.query("DELETE FROM passengers WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query("UPDATE quote_tokens SET ended_at=NOW() WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query("UPDATE run_tokens SET created_at=created_at WHERE desk_id=$1 AND run_id IN (SELECT id FROM runs WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2))", [deskId, c.id]);
      await ctx.db.query("UPDATE documents SET customer_name='Erased customer' WHERE desk_id=$1 AND hire_id IN (SELECT id FROM hires WHERE desk_id=$1 AND customer_id=$2)", [deskId, c.id]);
      await ctx.db.query(
        "UPDATE customers SET name='', email=NULL, telephone=NULL, notes=NULL, state='erased' WHERE id=$1",
        [c.id]
      );
    } catch {
      // stays Erasing while MinIO is unreachable
    }
  }
}

export async function retrySeedInvoice(ctx: Ctx): Promise<void> {
  const pending = await ctx.db.query("SELECT * FROM documents WHERE state IN ('waiting','rendering')");
  for (const d of pending.rows) {
    try {
      const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [d.hire_id]);
      if (!hire.rows[0]) continue;
      const html = await (await import("./api/documents.js")).documentHtml(ctx, String(d.desk_id), hire.rows[0], String(d.kind), String(d.id));
      const pdf = await renderPdf(ctx.cfg, html);
      const key = objectKeyForDocument(String(d.desk_id), String(d.id));
      await s3Put(ctx.cfg, key, pdf, "application/pdf");
      const number = await takeNumber(ctx, String(d.desk_id), String(d.kind));
      await ctx.db.query("UPDATE documents SET state='stored', number=$2, object_key=$3, history = history || $4::jsonb WHERE id=$1", [
        String(d.id),
        number,
        key,
        JSON.stringify([{ at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), who: "Arranger", what: "Stored" }]),
      ]);
    } catch {
      // retried by the next tick
    }
  }
}

async function takeNumber(ctx: Ctx, deskId: string, kind: string): Promise<string> {
  const prefix = kind === "invoice" ? "INV" : kind === "creditNote" ? "CN" : null;
  if (!prefix) return "";
  const year = Number(ukDateString(new Date()).slice(0, 4));
  const client = await ctx.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO document_numbers (desk_id, kind_prefix, year, last_number) VALUES ($1,$2,$3,0) ON CONFLICT (desk_id, kind_prefix, year) DO NOTHING",
      [deskId, prefix, year]
    );
    const r = await client.query<{ next: number }>(
      "UPDATE document_numbers SET last_number = last_number + 1 WHERE desk_id=$1 AND kind_prefix=$2 AND year=$3 RETURNING last_number AS next",
      [deskId, prefix, year]
    );
    await client.query("COMMIT");
    return `${prefix}-${year}-${String(r.rows[0].next).padStart(4, "0")}`;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
