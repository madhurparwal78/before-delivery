import { query, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken, MEDIA_TITLES, TERRITORY_TITLES, type Media, type Territory } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { formatDay } from "../../shared/format.js";
import { queueEmail } from "./outbox.js";
import { createCharge, createOrGetAccount, BillingOutage } from "./killbill.js";
import type { SessionMember } from "./sessions.js";

export interface LicenceRow {
  id: string;
  client_id: string;
  talent_id: string;
  media: string;
  territory: string;
  first_use_date: string;
  term_months: number;
  ends_on: string;
  monthly_fee_cents: number;
  reminder_sent_date: string | null;
  version: number;
  last_extension_by: string | null;
  last_extension_at: Date | null;
}

/** Whole-month arithmetic with month-end clamping. */
export function addWholeMonths(from: string, months: number): string {
  const [y, m, d] = from.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** The instant the licence expires: start of the day after endsOn in the client's zone. */
export function endsAtInstant(endsOn: string, timeZone: string): Date {
  const [y, m, d] = endsOn.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  // Resolve midnight of the day after in the client's zone.
  return resolveLocalInstant(`${nextDay.toISOString().slice(0, 10)}T00:00`, timeZone);
}

function resolveLocalInstant(local: string, timeZone: string): Date {
  const [datePart, timePart] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const naive = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  for (let offset = -20 * 3600 * 1000; offset <= 20 * 3600 * 1000; offset += 60 * 1000) {
    const candidate = new Date(naive.getTime() + offset);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    const hour = get("hour") === "24" ? "00" : get("hour");
    if (`${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}` === local) return candidate;
  }
  return naive;
}

export type LicenceStatus = "active" | "expiring" | "expired";

/** Licence status, decided in exactly this place. */
export function licenceStatus(endsAt: Date, endsOn: string, clientZone: string, now: Date): LicenceStatus {
  if (now.getTime() >= endsAt.getTime()) return "expired";
  const today = dateInZone(now, clientZone);
  // expiring when today falls within the 30 calendar days ending on endsOn
  const [ey, em, ed] = endsOn.split("-").map(Number);
  const limit = new Date(Date.UTC(ey, em - 1, ed - 30));
  const [ty, tm, td] = today.split("-").map(Number);
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
  if (todayUtc.getTime() > limit.getTime()) return "expiring";
  return "active";
}

function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function licenceView(row: LicenceRow, client: { company: string; time_zone: string }, talent: { display_name: string }, lastExtension: { months: number; extendedAt: Date; extendedBy: string } | null): Record<string, unknown> {
  const endsAt = endsAtInstant(row.ends_on, client.time_zone);
  return {
    id: row.id,
    clientId: row.client_id,
    clientCompany: client.company,
    clientTimeZone: client.time_zone,
    talentId: row.talent_id,
    talentDisplayName: talent.display_name,
    media: row.media,
    territory: row.territory,
    firstUseDate: row.first_use_date,
    termMonths: row.term_months,
    endsOn: row.ends_on,
    endsAt: toInstant(endsAt),
    status: licenceStatus(endsAt, row.ends_on, client.time_zone, new Date()),
    monthlyFeeCents: row.monthly_fee_cents,
    version: row.version,
    lastExtension,
  };
}

export async function loadLicence(tx: Tx, id: string): Promise<LicenceRow> {
  const row = await tx.one<LicenceRow>(`SELECT *, to_char(first_use_date,'YYYY-MM-DD') AS first_use_date, to_char(ends_on,'YYYY-MM-DD') AS ends_on FROM licences WHERE id = $1`, [id]);
  if (!row) throw errors.notFound();
  return row;
}

export interface RecordLicenceInput {
  clientId: string;
  talentId: string;
  media: Media;
  territory: Territory;
  firstUseDate: string;
  termMonths: number;
  monthlyFeeCents: number;
  member: SessionMember;
}

export async function recordLicence(tx: Tx, input: RecordLicenceInput): Promise<LicenceRow> {
  const client = await tx.one<{ id: string; company: string; contact_email: string; time_zone: string; slug: string }>(`SELECT * FROM clients WHERE id = $1`, [input.clientId]);
  if (!client) throw errors.notFound();
  const talent = await tx.one<{ id: string; display_name: string; state: string }>(`SELECT id, display_name, state FROM talent WHERE id = $1`, [input.talentId]);
  if (!talent || talent.state === "erased") throw errors.notFound();
  const endsOn = addWholeMonths(input.firstUseDate, input.termMonths);
  const id = `lic_${randomToken(10)}`;
  await tx.query(
    `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months, ends_on, monthly_fee_cents, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
    [id, input.clientId, input.talentId, input.media, input.territory, input.firstUseDate, input.termMonths, endsOn, input.monthlyFeeCents]
  );
  const row = await loadLicence(tx, id);
  return row;
}

export interface ExtensionOutcome {
  licence: LicenceRow;
  extension: { id: string; months: number; amountCents: number; killbillInvoiceId: string | null; extendedBy: { id: string; name: string }; extendedAt: string };
}

/** Extends a licence by whole months, writing the Kill Bill charge and the row together. */
export async function extendLicence(tx: Tx, licenceId: string, months: number, version: number, member: SessionMember, now: Date): Promise<ExtensionOutcome> {
  const row = await loadLicence(tx, licenceId);
  if (row.version !== version) {
    const saver = row.last_extension_by ? await tx.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [row.last_extension_by]) : null;
    throw errors.precondition("stale_version", { savedBy: saver?.name || "Rungboard", savedAt: toInstant(row.last_extension_at || new Date(0)) });
  }
  const client = await tx.one<{ id: string; company: string; contact_email: string; slug: string; time_zone: string }>(`SELECT * FROM clients WHERE id = $1`, [row.client_id]);
  const talent = await tx.one<{ display_name: string }>(`SELECT display_name FROM talent WHERE id = $1`, [row.talent_id]);
  if (!client || !talent) throw errors.notFound();
  const newEnds = addWholeMonths(row.ends_on, months);
  const amount = row.monthly_fee_cents * months;
  let killbillInvoiceId: string | null = null;
  try {
    const account = await createOrGetAccount(`rungboard-client-${client.slug}`, client.company, client.contact_email);
    const charge = await createCharge(
      account.accountId,
      `Usage licence renewal: ${talent.display_name}, ${MEDIA_TITLES[row.media as Media]}, ${TERRITORY_TITLES[row.territory as Territory]}, ${months} months`,
      amount
    );
    killbillInvoiceId = charge.invoiceId;
  } catch (err) {
    if (err instanceof BillingOutage) throw errors.billingUnavailable();
    throw err;
  }
  const extensionId = `ext_${randomToken(10)}`;
  await tx.query(
    `INSERT INTO licence_extensions (id, licence_id, months, amount_cents, killbill_invoice_id, extended_by, extended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [extensionId, licenceId, months, amount, killbillInvoiceId, member.id, now]
  );
  await tx.query(`UPDATE licences SET ends_on = $2, version = version + 1, last_extension_by = $3, last_extension_at = $4 WHERE id = $1`, [licenceId, newEnds, member.id, now]);
  const fresh = await loadLicence(tx, licenceId);
  return {
    licence: fresh,
    extension: {
      id: extensionId,
      months,
      amountCents: amount,
      killbillInvoiceId,
      extendedBy: { id: member.id, name: member.name },
      extendedAt: toInstant(now),
    },
  };
}

/** Sends the renewal reminder for a licence, once per endsOn. */
export async function sendReminderIfDue(tx: Tx, licence: LicenceRow, now: Date): Promise<boolean> {
  const client = await tx.one<{ company: string; contact_email: string; time_zone: string }>(`SELECT company, contact_email, time_zone FROM clients WHERE id = $1`, [licence.client_id]);
  const talent = await tx.one<{ display_name: string }>(`SELECT display_name FROM talent WHERE id = $1`, [licence.talent_id]);
  if (!client || !talent) return false;
  const endsAt = endsAtInstant(licence.ends_on, client.time_zone);
  const status = licenceStatus(endsAt, licence.ends_on, client.time_zone, now);
  if (status !== "expiring") return false;
  if (licence.reminder_sent_date === licence.ends_on) return false;
  const claimed = await tx.one<{ id: string }>(
    `UPDATE licences SET reminder_sent_date = $2::date WHERE id = $1 AND reminder_sent_date IS DISTINCT FROM $2::date RETURNING id`,
    [licence.id, licence.ends_on]
  );
  if (!claimed) return false;
  const body = [
    `Hello,`,
    ``,
    `A usage licence is coming to an end.`,
    ``,
    `Talent: ${talent.display_name}`,
    `Ends: ${formatDay(licence.ends_on)}`,
    `Monthly fee: ${(licence.monthly_fee_cents / 100).toFixed(2)} CAD`,
    ``,
    `Vesper & Rowe Talent`,
  ].join("\r\n");
  await queueEmail({
    to: client.contact_email,
    subject: `Usage licence ending ${formatDay(licence.ends_on)}: ${talent.display_name}`,
    body,
  });
  return true;
}

export async function listLicences(status?: string): Promise<{ counts: Record<string, number>; rows: Array<LicenceRow & { client_company: string; client_time_zone: string; talent_display_name: string; last_extension: { months: number; extended_at: Date; extended_by_name: string } | null }> }> {
  const rows = await query<LicenceRow & { client_company: string; client_time_zone: string; talent_display_name: string; last_extension_months: number | null; last_extension_at: Date | null; last_extension_by_name: string | null }>(
    `SELECT l.*, to_char(l.first_use_date,'YYYY-MM-DD') AS first_use_date, to_char(l.ends_on,'YYYY-MM-DD') AS ends_on,
            c.company AS client_company, c.time_zone AS client_time_zone, t.display_name AS talent_display_name,
            e.months AS last_extension_months, e.extended_at AS last_extension_at, em.name AS last_extension_by_name
     FROM licences l
     JOIN clients c ON c.id = l.client_id
     JOIN talent t ON t.id = l.talent_id
     LEFT JOIN licence_extensions e ON e.id = (SELECT id FROM licence_extensions WHERE licence_id = l.id ORDER BY extended_at DESC LIMIT 1)
     LEFT JOIN members em ON em.id = e.extended_by
     ORDER BY l.ends_on`
  );
  const now = new Date();
  const counts = { active: 0, expiring: 0, expired: 0 };
  const out: Array<LicenceRow & { client_company: string; client_time_zone: string; talent_display_name: string; last_extension: { months: number; extended_at: Date; extended_by_name: string } | null }> = [];
  for (const row of rows) {
    const statusOfRow = licenceStatus(endsAtInstant(row.ends_on, row.client_time_zone), row.ends_on, row.client_time_zone, now);
    counts[statusOfRow] += 1;
    if (status && status !== statusOfRow) continue;
    out.push({
      ...row,
      client_company: row.client_company,
      client_time_zone: row.client_time_zone,
      talent_display_name: row.talent_display_name,
      last_extension: row.last_extension_months !== null
        ? { months: row.last_extension_months, extended_at: row.last_extension_at!, extended_by_name: row.last_extension_by_name || "" }
        : null,
    });
  }
  return { counts, rows: out };
}

