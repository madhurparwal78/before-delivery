// Engagements: brand-scoped loading and the Engagement object the API returns.
import { config } from "../config.js";
import { one, rows, type Db } from "../db.js";
import { ApiError } from "../errors.js";
import type { Currency } from "../../shared/money.js";
import { intakeFiles } from "./intake.js";
import { invoicesOf, settleOverdue } from "./invoices.js";
import { catalogueFor, readQuote } from "./quote.js";
import type { EngagementState, ReviewMilestone, Stage } from "./states.js";

export type EngagementRow = {
  id: string;
  brand_id: string;
  reference: string;
  title: string;
  state: EngagementState;
  review_milestone: ReviewMilestone | null;
  finals_out: boolean;
  quote_revision: number;
  locked_rate: string | null;
  locked_at: Date | null;
  brand_name: string;
  currency: Currency;
};

export type LedgerEntry = {
  id: string;
  kind: "deposit" | "invoice_payment" | "refund";
  amount_minor: number;
  currency: Currency;
  invoice_id: string | null;
  killbill_payment_id: string;
  created_at: string;
};

const SELECT_ENGAGEMENT = `SELECT e.id, e.brand_id, e.reference, e.title, e.state, e.review_milestone, e.finals_out, e.quote_revision,
  e.locked_rate::text AS locked_rate, e.locked_at, b.name AS brand_name, b.currency
  FROM engagements e JOIN brands b ON b.id = e.brand_id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

/** Loads an engagement; a missing id or another brand's id is the same not-found. `lock` takes the row lock. */
export async function loadEngagement(db: Db, id: string, brandId: string | null, lock = false): Promise<EngagementRow> {
  if (!isUuid(id)) throw new ApiError("not_found");
  const row = await one<EngagementRow>(db, `${SELECT_ENGAGEMENT} WHERE e.id = $1${brandId ? " AND e.brand_id = $2" : ""}${lock ? " FOR NO KEY UPDATE OF e" : ""}`, brandId ? [id, brandId] : [id]);
  if (!row) throw new ApiError("not_found");
  return row;
}

export function stageOf(row: EngagementRow): Stage {
  return { state: row.state, review_milestone: row.review_milestone, finals_out: row.finals_out };
}

export async function setStage(db: Db, id: string, stage: Stage): Promise<void> {
  await db.query("UPDATE engagements SET state = $2, review_milestone = $3, finals_out = $4 WHERE id = $1", [id, stage.state, stage.review_milestone, stage.finals_out]);
}

export async function ledgerOf(db: Db, engagementId: string): Promise<LedgerEntry[]> {
  const entries = await rows<Omit<LedgerEntry, "created_at"> & { created_at: Date }>(
    db,
    "SELECT id, kind, amount_minor, currency, invoice_id, killbill_payment_id, created_at FROM ledger_entries WHERE engagement_id = $1 ORDER BY created_at, id",
    [engagementId],
  );
  return entries.map((e) => ({ ...e, created_at: e.created_at.toISOString() }));
}

async function revisionRounds(db: Db, engagementId: string): Promise<{ look_dev: number; final_delivery: number }> {
  const counts = await rows<{ milestone: ReviewMilestone; n: number }>(
    db,
    "SELECT milestone, count(*)::int AS n FROM revision_rounds WHERE engagement_id = $1 GROUP BY milestone",
    [engagementId],
  );
  return { look_dev: counts.find((c) => c.milestone === "look_dev")?.n ?? 0, final_delivery: counts.find((c) => c.milestone === "final_delivery")?.n ?? 0 };
}

/** The Engagement object. Clients see only issued invoices; the studio sees every invoice, its stills and its review link. */
export async function engagementJson(db: Db, row: EngagementRow, audience: "client" | "studio", now: Date): Promise<Record<string, unknown>> {
  await settleOverdue(row.id, now);
  const catalogue = await catalogueFor(row);
  const invoices = await invoicesOf(db, row.id);
  const body: Record<string, unknown> = {
    id: row.id,
    reference: row.reference,
    title: row.title,
    state: row.state,
    brand: { id: row.brand_id, name: row.brand_name, currency: row.currency },
    finance_email: await contactEmail(db, row.brand_id, "finance"),
    quote: await readQuote(db, row, catalogue, now),
    files: await intakeFiles(db, row.id),
    invoices: audience === "client" ? invoices.filter((invoice) => invoice.issued_at !== null) : invoices,
    ledger: await ledgerOf(db, row.id),
    revision_rounds: await revisionRounds(db, row.id),
  };
  if (audience === "studio") {
    body.stills = await rows(db, "SELECT id, shot_code, milestone FROM stills WHERE engagement_id = $1 ORDER BY milestone, shot_code", [row.id]);
    const link = await one<{ created_at: Date }>(
      db,
      "SELECT created_at FROM review_links WHERE engagement_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [row.id],
    );
    const expires = link ? new Date(link.created_at.getTime() + config.timers.reviewLinkTtl * 1000) : null;
    body.review_link = expires && expires.getTime() >= now.getTime() ? { expires_at: expires.toISOString() } : null;
  }
  return body;
}

export async function engagementSummaries(db: Db, brandId: string | null): Promise<Record<string, unknown>[]> {
  const list = await rows<EngagementRow>(db, `${SELECT_ENGAGEMENT}${brandId ? " WHERE e.brand_id = $1" : ""} ORDER BY e.created_at, e.reference`, brandId ? [brandId] : []);
  return list.map((e) => (brandId ? { id: e.id, reference: e.reference, title: e.title, state: e.state } : { id: e.id, reference: e.reference, title: e.title, state: e.state, brand_name: e.brand_name }));
}

export async function contactEmail(db: Db, brandId: string, role: "owner" | "finance" | "reviewer"): Promise<string> {
  const row = await one<{ email: string }>(db, "SELECT email FROM contacts WHERE brand_id = $1 AND role = $2", [brandId, role]);
  if (!row) throw new Error(`brand ${brandId} has no ${role} contact`);
  return row.email;
}
