// Usage licences: whole-month terms clamped to month end, status by the client's calendar, replayable
// extensions billed in Kill Bill, and one renewal reminder per end date.

import { exec, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json, type MemberCtx } from "../http.js";
import { FieldErrors, isoInstant, notFound, required, staleVersion } from "../errors.js";
import { accountFor, billingClient, committedCharge } from "../killbill.js";
import { enqueue } from "../mail.js";
import { asObject, isWholeNumber, newId, str } from "../util.js";
import { formatDate, formatMoney } from "../../shared/format.js";
import { addDays, addMonths, isIsoDate, localDateOf, startOfLocalDay } from "../../shared/zones.js";
import { MEDIA, TERRITORIES, isMedia, isTerritory } from "./fees.js";

type Status = "active" | "expiring" | "expired";

interface LicenceRow {
  id: string;
  client_id: string;
  client_company: string;
  client_zone: string;
  contact_name: string;
  contact_email: string;
  talent_id: string;
  talent_name: string;
  media: keyof typeof MEDIA;
  territory: keyof typeof TERRITORIES;
  first_use_date: string;
  term_months: number;
  extension_months: number;
  monthly_fee_cents: number;
  version: number;
  created_by: string;
  created_at: Date;
}

interface ExtensionRow {
  id: string;
  months: number;
  amount_cents: number;
  killbill_invoice_id: string;
  extended_by: string;
  extended_at: Date;
}

const LICENCE_SELECT = `SELECT l.*, c.company AS client_company, c.time_zone AS client_zone, c.contact_name,
    c.contact_email, t.display_name AS talent_name,
    coalesce((SELECT sum(x.months) FROM licence_extensions x WHERE x.licence_id = l.id), 0)::int AS extension_months
  FROM licences l JOIN clients c ON c.id = l.client_id JOIN talent t ON t.id = l.talent_id`;

const EXPIRING_DAYS = 30;

/** End date, end instant and status of a licence, decided here only. */
function licenceTerm(row: Pick<LicenceRow, "first_use_date" | "term_months" | "extension_months" | "client_zone">,
  now: number): { endsOn: string; endsAt: number; status: Status } {
  const endsOn = addMonths(row.first_use_date, row.term_months + row.extension_months);
  const endsAt = startOfLocalDay(addDays(endsOn, 1), row.client_zone);
  const today = localDateOf(now, row.client_zone);
  const status: Status = now >= endsAt ? "expired" : today >= addDays(endsOn, -(EXPIRING_DAYS - 1)) ? "expiring" : "active";
  return { endsOn, endsAt, status };
}

function extensionBody(row: ExtensionRow): Record<string, unknown> {
  return {
    id: row.id,
    months: row.months,
    amountCents: row.amount_cents,
    killbillInvoiceId: row.killbill_invoice_id,
    extendedBy: row.extended_by,
    extendedAt: isoInstant(row.extended_at),
  };
}

async function lastExtension(db: Db, licenceId: string): Promise<ExtensionRow | null> {
  return one<ExtensionRow>(db, "SELECT * FROM licence_extensions WHERE licence_id = $1 ORDER BY extended_at DESC, id DESC LIMIT 1",
    [licenceId]);
}

async function licenceBody(db: Db, row: LicenceRow, now: number): Promise<Record<string, unknown>> {
  const term = licenceTerm(row, now);
  const last = await lastExtension(db, row.id);
  return {
    id: row.id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    clientTimeZone: row.client_zone,
    talentId: row.talent_id,
    talentDisplayName: row.talent_name,
    media: row.media,
    territory: row.territory,
    firstUseDate: row.first_use_date,
    termMonths: row.term_months,
    endsOn: term.endsOn,
    endsAt: isoInstant(term.endsAt),
    status: term.status,
    monthlyFeeCents: row.monthly_fee_cents,
    version: row.version,
    lastExtension: last && extensionBody(last),
  };
}

async function licenceById(db: Db, id: string): Promise<LicenceRow | null> {
  return one<LicenceRow>(db, `${LICENCE_SELECT} WHERE l.id = $1`, [id]);
}

async function licenceReply(db: Db, id: string, now: number): Promise<Record<string, unknown>> {
  const row = await licenceById(db, id);
  if (!row) throw new Error(`licence ${id} vanished`);
  return licenceBody(db, row, now);
}

async function visibleLicence(ctx: MemberCtx): Promise<LicenceRow> {
  const row = ctx.isTalent() ? null : await licenceById(pool, ctx.params.id);
  if (!row) throw notFound();
  return row;
}

memberRoute("POST", "/api/licences", async (ctx) => {
  ctx.allow("accounts_lead", "agency_director");
  const body = asObject(await ctx.json());
  const errors: FieldErrors = new FieldErrors();
  const customer = await one<{ id: string }>(pool, "SELECT id FROM clients WHERE id = $1", [str(body, "clientId")]);
  const talent = await one<{ id: string }>(pool, "SELECT id FROM talent WHERE id = $1 AND state <> 'erased'",
    [str(body, "talentId")]);
  if (!customer) errors.add("clientId", required("Client"));
  if (!talent) errors.add("talentId", required("Talent"));
  if (!isMedia(body.media)) errors.add("media", required("Media"));
  if (!isTerritory(body.territory)) errors.add("territory", required("Territory"));
  if (!isIsoDate(body.firstUseDate)) errors.add("firstUseDate", "Enter the first-use date like 2027-01-31.");
  if (!isWholeNumber(body.termMonths) || body.termMonths < 1 || body.termMonths > 36) {
    errors.add("termMonths", "Enter a term from 1 to 36 months.");
  }
  if (!isWholeNumber(body.monthlyFeeCents) || body.monthlyFeeCents <= 0) {
    errors.add("monthlyFeeCents", "Enter a monthly fee above zero, like 450.00.");
  }
  if (errors.any() || !customer || !talent) errors.fail();
  const id = newId();
  await exec(pool, `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months,
      monthly_fee_cents, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [id, customer.id, talent.id, body.media, body.territory, body.firstUseDate, body.termMonths, body.monthlyFeeCents,
    ctx.member.name, new Date(ctx.now)]);
  return json(201, { licence: await licenceReply(pool, id, ctx.now) });
});

memberRoute("GET", "/api/licences", async (ctx) => {
  ctx.allow("accounts_lead", "agency_director");
  const wanted = ctx.query.get("status");
  if (wanted && !["active", "expiring", "expired"].includes(wanted)) {
    const errors: FieldErrors = new FieldErrors();
    errors.add("status", "Choose active, expiring or expired.");
    errors.fail();
  }
  const all = await rows<LicenceRow>(pool, `${LICENCE_SELECT} ORDER BY l.created_at DESC, l.id`);
  const counts: Record<Status, number> = { active: 0, expiring: 0, expired: 0 };
  for (const row of all) counts[licenceTerm(row, ctx.now).status] += 1;
  const listed = wanted ? all.filter((row) => licenceTerm(row, ctx.now).status === wanted) : all;
  return json(200, { counts, licences: await Promise.all(listed.map((row) => licenceBody(pool, row, ctx.now))) });
});

memberRoute("GET", "/api/licences/:id", async (ctx) => {
  const row = await visibleLicence(ctx);
  ctx.allow("accounts_lead", "agency_director");
  return json(200, { licence: await licenceBody(pool, row, ctx.now) });
});

memberRoute("POST", "/api/licences/:id/extensions", async (ctx) => {
  const found = await visibleLicence(ctx);
  ctx.allow("accounts_lead", "agency_director");
  const body = asObject(await ctx.json());
  return ctx.idempotent(`member:${ctx.member.id}`, body, () => tx(async (client) => {
    await client.query("SELECT 1 FROM licences WHERE id = $1 FOR UPDATE", [found.id]);
    const row = await licenceById(client, found.id);
    if (!row) throw notFound();
    if (body.version !== row.version) {
      const last = await lastExtension(client, row.id);
      throw staleVersion(last?.extended_by ?? row.created_by, last?.extended_at ?? row.created_at);
    }
    const months = body.months;
    if (!isWholeNumber(months) || months < 1 || months > 36) {
      const errors: FieldErrors = new FieldErrors();
      errors.add("months", "Enter months from 1 to 36.");
      errors.fail();
    }
    const amountCents = row.monthly_fee_cents * months;
    const account = await accountFor(client, await billingClient(client, row.client_id));
    const invoiceId = await committedCharge(account, {
      description: `Usage licence renewal: ${row.talent_name}, ${MEDIA[row.media]}, ${TERRITORIES[row.territory]}, ${months} months`,
      amountCents,
    });
    const id = newId();
    await exec(client, `INSERT INTO licence_extensions (id, licence_id, months, amount_cents, killbill_invoice_id, extended_by,
        extended_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, row.id, months, amountCents, invoiceId, ctx.member.name, new Date(ctx.now)]);
    await exec(client, "UPDATE licences SET version = version + 1 WHERE id = $1", [row.id]);
    const extension = await one<ExtensionRow>(client, "SELECT * FROM licence_extensions WHERE id = $1", [id]);
    return json(201, {
      licence: await licenceReply(client, row.id, ctx.now),
      extension: extension && extensionBody(extension),
    });
  }));
});

/** Queues one renewal reminder per licence per end date while it is expiring, once across copies. */
export async function sweepLicenceReminders(now: number): Promise<void> {
  const all = await rows<LicenceRow & { reminded: string[] }>(
    pool,
    `SELECT q.*, coalesce((SELECT array_agg(r.ends_on::text) FROM licence_reminders r WHERE r.licence_id = q.id), '{}') AS reminded
       FROM (${LICENCE_SELECT}) q`,
  );
  for (const row of all) {
    const term = licenceTerm(row, now);
    if (term.status !== "expiring" || row.reminded.includes(term.endsOn)) continue;
    await tx(async (client) => {
      const inserted = await exec(client, `INSERT INTO licence_reminders (licence_id, ends_on) VALUES ($1, $2)
        ON CONFLICT DO NOTHING`, [row.id, term.endsOn]);
      if (!inserted) return;
      await enqueue(client, {
        to: row.contact_email,
        subject: `Usage licence ending ${formatDate(term.endsOn)}: ${row.talent_name}`,
        text: [
          `Hello ${row.contact_name},`,
          "",
          `Your usage licence for ${row.talent_name} (${MEDIA[row.media]}, ${TERRITORIES[row.territory]}) ends on ${formatDate(term.endsOn)}.`,
          `To keep using the work after that day, reply to your booker to extend it at ${formatMoney(row.monthly_fee_cents)} a month.`,
          "",
          "Vesper & Rowe Talent",
        ].join("\n"),
        talentIds: [row.talent_id],
      });
    });
  }
}
