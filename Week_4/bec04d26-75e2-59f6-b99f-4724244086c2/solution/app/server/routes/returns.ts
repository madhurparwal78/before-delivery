import type { Hono } from "hono";
import { pool, query } from "../db";
import { addMonths } from "../../shared/calendar";
import { STATUSES } from "../../shared/types";
import { csvText } from "../domain/csv";
import { practiceMoment } from "../domain/labels";
import { type Env, authorize, isUuid, reply } from "../http/context";
import { notFound, packetPending } from "../http/errors";
import { type ReturnFilter, listOf, loadViews, matchesStatus } from "../store/returns";
import { getPractice } from "../store/practice";
import { returnActions } from "../returns-actions";
import { Check, MESSAGES } from "../validation";
import type { Reminder, ReturnView } from "../../shared/types";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const STATUS_FILTERS: string[] = [...STATUSES, "overdue"];

function yearFilter(year: string): ReturnFilter {
  return { dueFrom: `${year}-01-01`, dueBefore: `${Number(year) + 1}-01-01` };
}

async function filtered(practiceId: string, clientId: string | null, filter: ReturnFilter, status: string | undefined):
  Promise<ReturnView[]> {
  const practice = await getPractice(pool, practiceId);
  const views = await loadViews(pool, practice, { ...filter, ...(clientId ? { clientId } : {}) });
  return status ? views.filter((v) => matchesStatus(v, status)) : views;
}

export function registerReturns(app: Hono<Env>): void {
  app.get("/api/returns", async (c) => {
    const account = await authorize(c, { roles: "either" });
    const { month, year, status, state, client } = c.req.query();
    const check = new Check();
    let filter: ReturnFilter = {};
    if (month !== undefined) {
      if (MONTH.test(month)) filter = { dueFrom: `${month}-01`, dueBefore: `${addMonths(month, 1)}-01` };
      else check.fail("month", MESSAGES.month);
    } else if (year !== undefined) {
      if (YEAR.test(year)) filter = yearFilter(year);
      else check.fail("year", MESSAGES.year);
    }
    if (status !== undefined && !STATUS_FILTERS.includes(status)) check.fail("status", MESSAGES.status);
    check.done();
    const clientId = account.role === "owner" ? account.clientId : client || null;
    if (clientId && !isUuid(clientId)) return reply(listOf([]));
    return reply(listOf(await filtered(account.practiceId, clientId, { ...filter, ...(state ? { state } : {}) }, status)));
  });

  app.get("/api/year/:year/export.csv", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    const year = c.req.param("year");
    if (!YEAR.test(year)) throw notFound();
    const { status, state } = c.req.query();
    const rows = await filtered(account.practiceId, null, { ...yearFilter(year), ...(state ? { state } : {}) }, status || undefined);
    const body = csvText([
      ["client", "state", "period", "status", "overdue", "due_at", "zone", "gross_sales", "tax_due", "rate", "edition_effective_date"],
      ...rows.map((r) => [r.client.name, r.state, r.period, r.status, String(r.overdue), r.due_at, r.zone, r.gross_sales,
        r.tax_due, r.edition.rate, r.edition.effective_date]),
    ]);
    return new Response(body, { headers: {
      "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="duefield-${year}.csv"`,
    } });
  });

  app.get("/api/returns/:id", async (c) => {
    const id = c.req.param("id");
    const account = await authorize(c, { roles: "either", record: { id, table: "returns" } });
    return reply((await loadViews(pool, await getPractice(pool, account.practiceId), { ids: [id] }))[0]);
  });

  const write = (path: string, method: "post" | "patch", roles: ("bookkeeper" | "owner")[],
    action: keyof typeof returnActions) => {
    app[method](`/api/returns/:id${path}`, async (c) => {
      const id = c.req.param("id");
      const account = await authorize(c, { roles, record: { id, table: "returns" } });
      return reply(await returnActions[action](account, id, c.get("body")));
    });
  };
  write("", "patch", ["bookkeeper"], "saveAmounts");
  write("/prepare", "post", ["bookkeeper"], "prepare");
  write("/approve", "post", ["owner"], "approve");
  write("/send-back", "post", ["owner"], "sendBack");
  write("/file", "post", ["bookkeeper"], "file");
  write("/extension", "post", ["bookkeeper"], "extend");
  write("/amend", "post", ["bookkeeper"], "amend");

  app.get("/api/returns/:id/reminders", async (c) => {
    const id = c.req.param("id");
    await authorize(c, { roles: ["bookkeeper"], record: { id, table: "returns" } });
    const rows = await query<Omit<Reminder, "when">>(
      pool, "SELECT lead_days, scheduled_for, sent_at, status FROM reminders WHERE return_id = $1 ORDER BY scheduled_for", [id]);
    return reply(rows.map((r): Reminder => ({ ...r, when: practiceMoment(Date.parse(r.scheduled_for)) })));
  });

  app.get("/api/returns/:id/packet", async (c) => {
    const id = c.req.param("id");
    await authorize(c, { roles: "either", record: { id, table: "returns" } });
    const wanted = c.req.query("revision");
    const revisions = await query<{ revision: number; pdf: Buffer }>(
      pool, "SELECT revision, pdf FROM packet_revisions WHERE return_id = $1 ORDER BY revision DESC", [id]);
    if (!revisions.length) throw packetPending();
    const found = wanted === undefined ? revisions[0] : revisions.find((r) => String(r.revision) === wanted);
    if (!found) throw notFound();
    return new Response(new Uint8Array(found.pdf), { headers: {
      "content-type": "application/pdf", "content-disposition": `inline; filename="duefield-packet-${found.revision}.pdf"`,
    } });
  });
}

