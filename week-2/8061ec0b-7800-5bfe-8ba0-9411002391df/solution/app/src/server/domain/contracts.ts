// Loading contracts, who may see them, and the Contract and ContractSummary bodies.

import type { Contract, ContractSummary, HistoryEntry, PriceList, User } from "../../shared/api.js";
import { isoSecond } from "../../shared/storeTime.js";
import { instrumentLabel, type ContractStatus, type InstrumentType, type Size } from "../../shared/vocabulary.js";
import { now, storeToday } from "../clock.js";
import { query, withClient, type Db, type Queryable } from "../db/pool.js";
import { notFound } from "../http/errors.js";
import { billingDates, contractMonth, contractTerms, loadPriceLists } from "./terms.js";

export interface ContractRow {
  id: string; status: ContractStatus; student_id: string; student_name: string; grade: number; school_id: string;
  school_name: string; family_id: string; parent_name: string; parent_email: string; instrument_serial: string;
  instrument_type: InstrumentType; size: Size; model: string; waiver: boolean; price_list_id: string | null;
  delivery_date: string; hold_expires_at: Date | null; signer_name: string | null; signed_at: Date | null;
  activated_at: Date | null; closed_at: Date | null; billing_anchor_date: string | null; predecessor_id: string | null;
  successor_id: string | null; subscription_state: "active" | "cancelled" | null; agreement_stored: boolean;
  seeded_agreement: boolean; bill_of_sale_stored: boolean; created_at: Date; equity_cents: number;
}

const CONTRACT_SELECT = `
  SELECT c.*, s.name AS student_name, s.grade, s.family_id, sc.id AS school_id, sc.name AS school_name,
    f.parent_name, f.email AS parent_email, i.instrument_type, i.size, i.model,
    COALESCE((SELECT SUM(l.amount_cents) FROM ledger_entries l WHERE l.contract_id = c.id), 0)::int AS equity_cents
  FROM contracts c
  JOIN students s ON s.id = c.student_id
  JOIN schools sc ON sc.id = s.school_id
  JOIN families f ON f.id = s.family_id
  JOIN instruments i ON i.serial = c.instrument_serial`;

export async function loadContractRows(db: Queryable, where: string, values: unknown[]): Promise<ContractRow[]> {
  return query<ContractRow>(db, `${CONTRACT_SELECT} WHERE ${where} ORDER BY c.created_order`, values);
}

export async function loadContractRow(db: Queryable, id: string): Promise<ContractRow | undefined> {
  return (await loadContractRows(db, "c.id = $1", [id]))[0];
}

/** Parents reach only their own children's contracts; everything else answers 404 exactly like an unknown ID. */
export function canSee(user: User, row: { family_id: string }): boolean {
  return user.role !== "parent" || row.family_id === user.family_id;
}

async function visibleContract(db: Db, user: User, id: string): Promise<ContractRow> {
  const row = await loadContractRow(db, id);
  if (row === undefined || !canSee(user, row)) throw notFound();
  return row;
}

/** The newest link a contract has had (a replaced link is never the newest). */
interface LinkRow { state: "live" | "revoked" | "used"; expires_at: Date }

function signingLinkState(row: ContractRow, link: LinkRow | undefined): Contract["signing_link"] {
  if (link === undefined) return { status: "none", expires_at: null };
  const lapsed = link.state === "live" && (link.expires_at <= now() || row.status !== "agreement_sent");
  return { status: lapsed ? "expired" : link.state, expires_at: isoSecond(link.expires_at) };
}

/** Step 4 of the precedence: 404 for an unknown contract or one the caller may not see, before any lock or replay. */
export async function requireVisible(user: User, id: string): Promise<ContractRow> {
  return withClient((db) => visibleContract(db, user, id));
}

/** The full Contract body, computed at request time from the row, its history and the price lists. */
export async function contractBody(db: Queryable, row: ContractRow, lists?: PriceList[]): Promise<Contract> {
  const versions = lists ?? await loadPriceLists(db);
  const today = storeToday();
  const terms = contractTerms(row, versions, today);
  const history = await query<{ from_status: ContractStatus | null; to_status: ContractStatus; at: Date;
    actor: HistoryEntry["actor"]; actor_name: string | null }>(db,
    "SELECT from_status, to_status, at, actor, actor_name FROM contract_history WHERE contract_id = $1 ORDER BY id", [row.id]);
  const [link] = await query<LinkRow>(db,
    `SELECT state, expires_at FROM signing_links WHERE contract_id = $1 AND state <> 'replaced'
     ORDER BY sent_order DESC LIMIT 1`, [row.id]);
  const stamp = (d: Date | null): string | null => (d === null ? null : isoSecond(d));
  return {
    id: row.id, status: row.status,
    student: { id: row.student_id, name: row.student_name, grade: row.grade },
    school: { id: row.school_id, name: row.school_name }, family_id: row.family_id,
    instrument: { serial: row.instrument_serial, instrument_type: row.instrument_type, size: row.size, model: row.model,
      label: instrumentLabel(row.instrument_type, row.size) },
    waiver: row.waiver, terms, equity_cents: row.equity_cents, contract_month: contractMonth(row.equity_cents, terms),
    delivery_date: row.delivery_date, hold_expires_at: stamp(row.hold_expires_at),
    signing_link: signingLinkState(row, link), agreement_stored: row.agreement_stored,
    bill_of_sale_stored: row.bill_of_sale_stored, subscription_state: row.subscription_state,
    signed_at: stamp(row.signed_at), activated_at: stamp(row.activated_at), closed_at: stamp(row.closed_at),
    billing_anchor_date: row.billing_anchor_date,
    next_billing_date: row.status === "active" && row.billing_anchor_date !== null
      ? billingDates(row.billing_anchor_date, today, 1)[0] : null,
    predecessor_id: row.predecessor_id, successor_id: row.successor_id,
    history: history.map((h) => ({ from: h.from_status, to: h.to_status, at: isoSecond(h.at), actor: h.actor,
      actor_name: h.actor_name })),
  };
}

/** Reloads a contract after a change and builds its body. */
export async function freshContractBody(db: Queryable, id: string): Promise<Contract> {
  const row = await loadContractRow(db, id);
  if (row === undefined) throw notFound();
  return contractBody(db, row);
}

export function contractSummary(row: ContractRow): ContractSummary {
  return {
    id: row.id, status: row.status, student_name: row.student_name,
    instrument_label: instrumentLabel(row.instrument_type, row.size), serial: row.instrument_serial,
    equity_cents: row.equity_cents, delivery_date: row.delivery_date,
  };
}
