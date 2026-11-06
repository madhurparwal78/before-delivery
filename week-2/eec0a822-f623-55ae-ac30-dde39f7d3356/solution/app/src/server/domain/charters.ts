import { randomUUID } from "node:crypto";
import type pg from "pg";
import { one, type Db } from "../db";
import { conflict, type Json } from "../http";
import { formatDay } from "../../shared/format";
import { formatMoney } from "../../shared/money";
import { isoInstant } from "../../shared/zones";
import type { Line, Quote } from "./pricing";
import { seasonOf, weekEnd } from "./weeks";
import type { YachtRow } from "./yachts";

export interface CharterRow {
  id: string;
  workspace_slug: string;
  hold_id: string | null;
  yacht_id: string;
  yacht_slug: string;
  yacht_name: string;
  yacht_base: "split" | "lavrio";
  yacht_cabins: number;
  workspace_name: string;
  week_start: string;
  client_name: string;
  client_email: string;
  currency: string;
  season: string;
  deposit_date: string | null;
  exchange_table_id: string;
  rate: string;
  lines: Line[];
  total_eur_minor: number;
  total_minor: number;
  invoice_status: "invoiced" | "not_invoiced";
  killbill_invoice_id: string | null;
  invoiced_at: Date | null;
  status: "open" | "closed";
  closed_at: Date | null;
  erases_at: Date | null;
  created_at: Date;
}

export const CHARTER_SELECT = `SELECT c.*, y.slug AS yacht_slug, y.name AS yacht_name, y.base AS yacht_base, y.cabins AS yacht_cabins,
    w.name AS workspace_name
  FROM charters c JOIN yachts y ON y.id = c.yacht_id JOIN workspaces w ON w.slug = c.workspace_slug`;

export async function charterById(db: Db, workspace: string, id: string, lock = false): Promise<CharterRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return one<CharterRow>(db, `${CHARTER_SELECT} WHERE c.id = $1 AND c.workspace_slug = $2${lock ? " FOR UPDATE OF c" : ""}`, [id, workspace]);
}

const iso = (d: Date | null): string | null => (d ? isoInstant(d.getTime()) : null);

export function charterJson(c: CharterRow): Json {
  return {
    id: c.id,
    holdId: c.hold_id,
    yachtSlug: c.yacht_slug,
    weekStart: c.week_start,
    weekEnd: weekEnd(c.week_start),
    clientName: c.client_name,
    clientEmail: c.client_email,
    currency: c.currency,
    season: c.season,
    depositDate: c.deposit_date,
    exchangeTableId: c.exchange_table_id,
    rate: c.rate,
    lines: c.lines as unknown as Json,
    totalEurMinor: c.total_eur_minor,
    totalMinor: c.total_minor,
    invoiceStatus: c.invoice_status,
    killbillInvoiceId: c.killbill_invoice_id,
    invoicedAt: iso(c.invoiced_at),
    status: c.status,
    closedAt: iso(c.closed_at),
    erasesAt: iso(c.erases_at),
  };
}

interface NewCharter {
  workspace: string;
  holdId: string | null;
  yacht: YachtRow;
  weekStart: string;
  clientName: string;
  clientEmail: string;
  depositDate: string | null;
  quote: Quote;
}

/** Inserts a charter with its stored, never recomputed, price. A second charter on the week is booked. */
export async function insertCharter(db: pg.PoolClient, c: NewCharter): Promise<string> {
  const id = randomUUID();
  try {
    await db.query("SAVEPOINT charter_insert");
    await db.query(
      `INSERT INTO charters (id, workspace_slug, hold_id, yacht_id, week_start, client_name, client_email, currency, season,
         deposit_date, exchange_table_id, rate, lines, total_eur_minor, total_minor, invoice_status, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'not_invoiced','open', now())`,
      [id, c.workspace, c.holdId, c.yacht.id, c.weekStart, c.clientName, c.clientEmail, c.quote.currency, seasonOf(c.weekStart),
        c.depositDate, c.quote.exchangeTableId, c.quote.rate, JSON.stringify(c.quote.lines), c.quote.totalEurMinor, c.quote.totalMinor],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      await db.query("ROLLBACK TO SAVEPOINT charter_insert");
      throw conflict("week_booked");
    }
    throw error;
  }
  return id;
}

export function confirmationMail(c: CharterRow): { to: string; subject: string; text: string } {
  const lines = c.lines.map((l) => `${l.label}: ${formatMoney(c.currency, l.amountMinor)}`);
  return {
    to: c.client_email,
    subject: `Charter confirmed: ${c.yacht_name}, week of ${formatDay(c.week_start)}`,
    text: [
      `Dear ${c.client_name},`,
      "",
      `Your charter of ${c.yacht_name} is confirmed for the week of ${formatDay(c.week_start)} to ${formatDay(weekEnd(c.week_start))}.`,
      "",
      ...lines,
      `Total: ${formatMoney(c.currency, c.total_minor)}`,
      "",
      `Kill Bill invoice: ${c.killbill_invoice_id}`,
      "",
      "Fair winds,",
      c.workspace_name,
    ].join("\n"),
  };
}
