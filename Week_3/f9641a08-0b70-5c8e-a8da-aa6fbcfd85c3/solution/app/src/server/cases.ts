import type { AddressFields, AdminCase, AnyCase, CaseKind, ClaimCase, Customer, ReturnCase, Role, TrialCase, WarrantyRegistration } from "../shared/api";
import { inr } from "../shared/format";
import { audit } from "./audit";
import { sizeLabel } from "./catalogue";
import { emit, isUniqueViolation, one, rows, type Queryable, type Unit } from "./db";
import { FIELD, fail, outOfStock, validation, warrantyExpired, windowClosed } from "./errors";
import { attachedTo, ownEvidence } from "./evidence";
import { CASE_NUMBER_PREFIX, CASE_WORDS, RETURN_REASONS, CLAIM_COMPONENTS, canMoveCase, knownCaseStatus } from "./machines";
import { notify } from "./notifications";
import { roundHalfUp } from "./money";
import { allocationsOf, announceOrder, findByNumber, findLine, insertOrder } from "./orders";
import { refundOrder } from "./refunds";
import { figures, holdable, lockVariants, move, takeFrom, totalAvailable, variantName, announceStock, type Location } from "./stock";
import { lineFactsFor, returnVerdict, trialVerdict, warrantyEnd, type LineFacts } from "./windows";
import { config } from "./config";
import type { Fields } from "./validate";

// Returns, trial returns and warranty claims share one table and one set of rules.

interface CaseRow {
  id: string;
  kind: CaseKind;
  number: string;
  user_id: string;
  order_line_id: string;
  status: string;
  version: number;
  quantity: number | null;
  request_reason: string | null;
  outcome: "refund" | "exchange" | null;
  exchange_sku: string | null;
  exchange_order_id: string | null;
  note: string | null;
  registration_id: string | null;
  component: string | null;
  description: string | null;
  resolution_order_id: string | null;
  refund_amount: number | null;
  reject_reason: string | null;
}

const COLUMNS = `c.id, c.kind, c.number, c.user_id, c.order_line_id, c.status, c.version, c.quantity, c.request_reason, c.outcome, c.exchange_sku, c.exchange_order_id,
  c.note, c.registration_id, c.component, c.description, c.resolution_order_id, c.refund_amount, c.reject_reason`;

const SEQUENCE: Record<CaseKind, string> = { return: "return_number_seq", trial: "trial_number_seq", claim: "claim_number_seq" };
const EVENT: Record<CaseKind, "return" | "trial" | "warranty"> = { return: "return", trial: "trial", claim: "warranty" };
const SUBJECT: Record<CaseKind, string> = { return: "Return", trial: "Trial return", claim: "Warranty claim" };
const ENTITY: Record<CaseKind, "return" | "trial" | "warranty_claim"> = { return: "return", trial: "trial", claim: "warranty_claim" };

export async function loadCase(db: Queryable, kind: CaseKind, number: string, userId?: string, lock = false): Promise<CaseRow> {
  const row = await one<CaseRow>(db, `SELECT ${COLUMNS} FROM cases c WHERE c.kind = $1 AND c.number = $2 ${userId ? "AND c.user_id = $3" : ""} ${lock ? "FOR UPDATE" : ""}`, userId ? [kind, number, userId] : [kind, number]);
  if (!row) throw fail("not_found");
  return row;
}

interface LineSummary {
  order_number: string;
  product_name: string;
  colour: string;
  size_slug: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  resolution_number: string | null;
  exchange_number: string | null;
}

async function summaryOf(db: Queryable, row: CaseRow): Promise<LineSummary> {
  const found = await one<LineSummary>(
    db,
    `SELECT o.number AS order_number, l.product_name, l.colour, l.size_slug, u.id AS customer_id, u.name AS customer_name, u.email AS customer_email,
            (SELECT number FROM orders WHERE id = $2) AS resolution_number, (SELECT number FROM orders WHERE id = $3) AS exchange_number
     FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN users u ON u.id = o.user_id WHERE l.id = $1`,
    [row.order_line_id, row.resolution_order_id, row.exchange_order_id],
  );
  if (!found) throw fail("not_found");
  return found;
}

export async function caseBody(db: Queryable, row: CaseRow): Promise<AnyCase & { customer: Customer }> {
  const s = await summaryOf(db, row);
  const history = await rows<{ status: string; at: Date }>(db, "SELECT status, at FROM case_history WHERE case_id = $1 ORDER BY id", [row.id]);
  const base = {
    number: row.number,
    version: row.version,
    order_number: s.order_number,
    order_line_id: row.order_line_id,
    history: history.map((h) => ({ status: h.status, at: h.at.toISOString() })),
    refund_amount: row.refund_amount,
    reason: row.reject_reason,
    product: s.product_name,
    variant: `${s.product_name} — ${s.colour}, ${sizeLabel(s.size_slug)}`,
    customer: { id: s.customer_id, name: s.customer_name, email: s.customer_email },
  };
  if (row.kind === "return") {
    return { ...base, status: row.status, quantity: row.quantity ?? 1, outcome: row.outcome ?? "refund", request_reason: row.request_reason ?? "", exchange_sku: row.exchange_sku, exchange_order_number: s.exchange_number } as ReturnCase & { customer: Customer };
  }
  if (row.kind === "trial") return { ...base, status: row.status, note: row.note ?? "" } as TrialCase & { customer: Customer };
  return {
    ...base,
    status: row.status,
    component: row.component ?? "",
    description: row.description ?? "",
    resolution_order_number: s.resolution_number,
    evidence: await attachedTo(db, row.id),
  } as ClaimCase & { customer: Customer };
}

/** The shopper's view omits the customer object. */
export async function customerBody(db: Queryable, row: CaseRow): Promise<AnyCase> {
  const { customer: _customer, ...rest } = await caseBody(db, row);
  return rest as AnyCase;
}

export async function listCases(db: Queryable, kind: CaseKind, filter: { userId?: string; status?: string }): Promise<CaseRow[]> {
  return rows<CaseRow>(
    db,
    `SELECT ${COLUMNS} FROM cases c WHERE c.kind = $1 AND ($2::uuid IS NULL OR c.user_id = $2) AND ($3::text IS NULL OR c.status = $3) ORDER BY c.created_at DESC, c.number DESC`,
    [kind, filter.userId ?? null, filter.status ?? null],
  );
}

async function announceCase(u: Unit, row: CaseRow, status: string, version: number): Promise<void> {
  emit(u, EVENT[row.kind], { number: row.number, status, version }, "owner", `user:${row.user_id}`);
  emit(u, "queue", { kind: row.kind, number: row.number, status }, "staff");
}

async function record(u: Unit, row: CaseRow, status: string, at: Date, detail: string): Promise<void> {
  await u.db.query("INSERT INTO case_history (case_id, status, at) VALUES ($1, $2, $3)", [row.id, status, at]);
  await notify(u, row.user_id, `${SUBJECT[row.kind]} ${row.number}: ${CASE_WORDS[row.kind][status] ?? status}`, detail, at);
}

interface LineInfo {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
  unit_price: number;
  line_discount: number;
  line_tax: number;
  fulfillment: string;
  category: string;
  product_id: string;
  delivered_at: Date | null;
  user_id: string;
}

async function lineInfo(db: Queryable, lineId: string): Promise<LineInfo> {
  const line = await one<LineInfo>(
    db,
    `SELECT l.id, l.order_id, l.sku, l.quantity, l.unit_price, l.line_discount, l.line_tax, l.fulfillment, p.category, p.id AS product_id, o.delivered_at, o.user_id
     FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id WHERE l.id = $1`,
    [lineId],
  );
  if (!line) throw fail("not_found");
  return line;
}

async function factsOf(db: Queryable, line: LineInfo): Promise<LineFacts> {
  const f = (await lineFactsFor(db, [line.id])).get(line.id);
  return { quantity: line.quantity, category: line.category, delivered: line.fulfillment === "delivered", deliveredAt: line.delivered_at, openCase: f?.openCase ?? false, returned: f?.returned ?? 0, trialRefunded: f?.trialRefunded ?? false };
}

async function lockLine(db: Queryable & { query: Unit["db"]["query"] }, id: string): Promise<void> {
  await db.query("SELECT id FROM order_lines WHERE id = $1 FOR UPDATE", [id]);
}

async function insertCase(u: Unit, kind: CaseKind, userId: string, lineId: string, status: string, extra: Partial<Record<string, unknown>>, now: Date): Promise<CaseRow> {
  const { rows: [seq] } = await u.db.query<{ n: number }>(`SELECT nextval('${SEQUENCE[kind]}') AS n`);
  const number = `${CASE_NUMBER_PREFIX[kind]}-${seq?.n}`;
  const columns = ["kind", "number", "user_id", "order_line_id", "status", "created_at", ...Object.keys(extra)];
  const values = [kind, number, userId, lineId, status, now, ...Object.values(extra)];
  try {
    const { rows: [created] } = await u.db.query<{ id: string }>(
      `INSERT INTO cases (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      values,
    );
    if (!created) throw new Error("case inserted");
    return loadCase(u.db, kind, number);
  } catch (failure) {
    if (isUniqueViolation(failure)) throw fail("duplicate_request");
    throw failure;
  }
}

async function open(u: Unit, row: CaseRow, now: Date, detail: string): Promise<AnyCase> {
  await record(u, row, row.status, now, detail);
  await announceCase(u, row, row.status, row.version);
  return customerBody(u.db, row);
}

// ---- returns -------------------------------------------------------------------------------

export async function createReturn(u: Unit, userId: string, input: Record<string, unknown>, now: Date): Promise<AnyCase> {
  const line = await lineInfo(u.db, (await findLine(u.db, String(input.order_line_id ?? ""), userId)).id);
  await lockLine(u.db, line.id);
  const facts = await factsOf(u.db, line);
  if (facts.openCase) throw fail("duplicate_request");
  const fields: Fields = {};
  const quantity = typeof input.quantity === "number" && Number.isInteger(input.quantity) && input.quantity >= 1 && input.quantity <= 10 ? input.quantity : null;
  if (quantity === null) fields.quantity = FIELD.quantity;
  const reason = typeof input.reason === "string" && RETURN_REASONS.includes(input.reason) ? input.reason : null;
  if (!reason) fields.reason = FIELD.reason;
  const outcome = input.outcome === "refund" || input.outcome === "exchange" ? input.outcome : null;
  if (!outcome) fields.outcome = FIELD.outcome;
  let exchangeSku: string | null = null;
  if (outcome === "exchange") {
    const candidate = typeof input.exchange_sku === "string"
      ? await one<{ sku: string }>(u.db, "SELECT v.sku FROM variants v WHERE v.sku = $1 AND v.product_id = $2 AND v.sku <> $3 AND v.price = $4", [input.exchange_sku, line.product_id, line.sku, line.unit_price])
      : null;
    if (candidate) exchangeSku = candidate.sku;
    else fields.exchange_sku = FIELD.exchangeSku;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  if (exchangeSku) {
    const stock = (await figures(u.db, [exchangeSku])).get(exchangeSku);
    const available = stock ? totalAvailable(stock) : 0;
    if (available < 1) throw outOfStock(await variantName(u.db, exchangeSku), exchangeSku, available);
  }
  const verdict = returnVerdict(facts, quantity ?? 1, now);
  if (!verdict.ok) throw verdict.closedOn ? windowClosed("return", config.returnWindowDays, new Date(verdict.closedOn.getTime())) : fail("not_eligible");
  const row = await insertCase(u, "return", userId, line.id, "requested", { quantity, request_reason: reason, outcome, exchange_sku: exchangeSku }, now);
  return open(u, row, now, `Your return ${row.number} has been requested.`);
}

// ---- trial returns -------------------------------------------------------------------------

export async function createTrial(u: Unit, userId: string, input: Record<string, unknown>, now: Date): Promise<AnyCase> {
  const line = await lineInfo(u.db, (await findLine(u.db, String(input.order_line_id ?? ""), userId)).id);
  await lockLine(u.db, line.id);
  const facts = await factsOf(u.db, line);
  if (facts.openCase) throw fail("duplicate_request");
  const note = typeof input.note === "string" ? input.note : "";
  if (note.length > 500) throw validation({ note: FIELD.note });
  const verdict = trialVerdict(facts, now);
  if (!verdict.ok) throw verdict.closedOn ? windowClosed("trial", config.trialWindowDays, verdict.closedOn) : fail("not_eligible");
  const row = await insertCase(u, "trial", userId, line.id, "requested", { note }, now);
  return open(u, row, now, `Your trial return ${row.number} has been requested.`);
}

// ---- warranty ------------------------------------------------------------------------------

export async function registerWarranty(u: Unit, userId: string, input: Record<string, unknown>, now: Date): Promise<{ status: number; body: WarrantyRegistration }> {
  const lineId = typeof input.order_line_id === "string" && /^[0-9a-f-]{36}$/.test(input.order_line_id) ? input.order_line_id : "";
  const line = await one<{ id: string; fulfillment: string; category: string; delivered_at: Date | null; registration_id: string | null; covered_until: Date | null }>(
    u.db,
    `SELECT l.id, l.fulfillment, p.category, o.delivered_at, r.id AS registration_id, r.covered_until
     FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id
     LEFT JOIN warranty_registrations r ON r.order_line_id = l.id
     WHERE l.id = $1 AND o.user_id = $2`,
    [lineId, userId],
  );
  if (!line) throw fail("not_found");
  if (line.registration_id && line.covered_until) return { status: 200, body: { id: line.registration_id, order_line_id: line.id, covered_until: line.covered_until.toISOString() } };
  if (line.fulfillment !== "delivered" || !line.delivered_at) throw fail("not_eligible");
  const end = warrantyEnd(line.delivered_at, line.category);
  if (now >= end) throw warrantyExpired(end);
  const created = await one<{ id: string }>(
    u.db,
    "INSERT INTO warranty_registrations (order_line_id, user_id, covered_until) VALUES ($1, $2, $3) ON CONFLICT (order_line_id) DO NOTHING RETURNING id",
    [line.id, userId, end],
  );
  if (created) return { status: 201, body: { id: created.id, order_line_id: line.id, covered_until: end.toISOString() } };
  const existing = await one<{ id: string; covered_until: Date }>(u.db, "SELECT id, covered_until FROM warranty_registrations WHERE order_line_id = $1", [line.id]);
  if (!existing) throw fail("not_found");
  return { status: 200, body: { id: existing.id, order_line_id: line.id, covered_until: existing.covered_until.toISOString() } };
}

export async function createClaim(u: Unit, userId: string, input: Record<string, unknown>, now: Date): Promise<AnyCase> {
  const registration = typeof input.registration_id === "string" && /^[0-9a-f-]{36}$/.test(input.registration_id)
    ? await one<{ id: string; order_line_id: string; covered_until: Date }>(u.db, "SELECT id, order_line_id, covered_until FROM warranty_registrations WHERE id = $1 AND user_id = $2", [input.registration_id, userId])
    : null;
  if (!registration) throw fail("not_found");
  const ids = Array.isArray(input.evidence_ids) ? input.evidence_ids.filter((id): id is string => typeof id === "string") : [];
  const evidence = await Promise.all(ids.map((id) => ownEvidence(u.db, id, userId)));
  await lockLine(u.db, registration.order_line_id);
  const component = typeof input.component === "string" && CLAIM_COMPONENTS.includes(input.component) ? input.component : null;
  if (component) {
    const clash = await one(u.db, "SELECT 1 FROM cases WHERE kind = 'claim' AND order_line_id = $1 AND component = $2 AND status NOT IN ('rejected', 'resolved')", [registration.order_line_id, component]);
    if (clash) throw fail("duplicate_request");
  }
  const fields: Fields = {};
  if (!component) fields.component = FIELD.component;
  const description = typeof input.description === "string" ? input.description : "";
  if (description.length < 20 || description.length > 1000) fields.description = FIELD.description;
  const photos = evidence.filter((e) => e.kind === "photo").length;
  const receipts = evidence.filter((e) => e.kind === "receipt").length;
  if (!Array.isArray(input.evidence_ids) || photos < 1 || photos > 5 || receipts > 1 || ids.length !== evidence.length || new Set(ids).size !== ids.length || evidence.some((e) => e.claim_id !== null)) {
    fields.evidence_ids = FIELD.evidenceIds;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  if (now >= registration.covered_until) throw warrantyExpired(registration.covered_until);
  const row = await insertCase(u, "claim", userId, registration.order_line_id, "submitted", { registration_id: registration.id, component, description }, now);
  await u.db.query("UPDATE evidence SET claim_id = $2 WHERE id = ANY($1)", [ids, row.id]);
  return open(u, row, now, `Your warranty claim ${row.number} has been submitted.`);
}

// ---- staff moves ---------------------------------------------------------------------------

interface Actor {
  id: string;
  role: Role;
}

/** Paid amount of a line: net plus tax. */
function paid(line: LineInfo): number {
  return line.unit_price * line.quantity - line.line_discount + line.line_tax;
}

async function refundedOnLine(db: Queryable, lineId: string): Promise<{ amount: number; units: number }> {
  const found = await one<{ amount: number; units: number }>(
    db,
    "SELECT coalesce(sum(refund_amount), 0) AS amount, coalesce(sum(quantity) FILTER (WHERE kind = 'return'), 0) AS units FROM cases WHERE order_line_id = $1 AND status = 'refunded'",
    [lineId],
  );
  return { amount: found?.amount ?? 0, units: found?.units ?? 0 };
}

/** Returning q of a line refunds paid × q ÷ quantity, half up; the last units refund whatever is left of the line. */
function refundShare(line: LineInfo, quantity: number, before: { amount: number; units: number }): number {
  const total = paid(line);
  return quantity >= line.quantity - before.units ? total - before.amount : roundHalfUp(total * quantity, line.quantity);
}

async function returnUnits(u: Unit, line: LineInfo, quantity: number, reason: "return_received" | "trial_returned", ref: string, now: Date): Promise<string[]> {
  const allocations = (await allocationsOf(u.db, line.order_id)).filter((a) => a.line_id === line.id);
  await lockVariants(u.db, [line.sku]);
  let left = quantity;
  const location = (allocations[0]?.location ?? "bhiwandi") as Location;
  for (const a of allocations) {
    const part = Math.min(left, a.quantity);
    if (part > 0) {
      await move(u.db, { sku: line.sku, location: a.location, reason, ref, from: "dispatched", to: "available", quantity: part, at: now });
      left -= part;
    }
  }
  if (left > 0) await move(u.db, { sku: line.sku, location, reason, ref, from: "dispatched", to: "available", quantity: left, at: now });
  return [line.sku];
}

/** A zero-value order for an exchange or a replacement, with its units taken from stock. */
async function zeroOrder(u: Unit, line: LineInfo, sku: string, quantity: number, kind: "exchange" | "replacement", reason: "exchange_committed" | "replacement_committed", now: Date): Promise<{ id: string; number: string }> {
  await lockVariants(u.db, [sku]);
  const by = (await figures(u.db, [sku])).get(sku);
  const available = by ? holdable(by) : 0;
  if (!by || available < quantity) throw outOfStock(await variantName(u.db, sku), sku, available);
  const original = await one<{ number: string; email: string | null; phone: string | null; address: AddressFields | null; shipping_method: "standard" | "express" }>(
    u.db,
    "SELECT number, email, phone, address, shipping_method FROM orders WHERE id = $1",
    [line.order_id],
  );
  const chunk = takeFrom(by, quantity);
  const order = await insertOrder(u.db, {
    userId: line.user_id,
    kind,
    status: "placed",
    paymentBase: "captured",
    placedAt: now,
    deliveredAt: null,
    email: original?.email ?? null,
    phone: original?.phone ?? null,
    address: original?.address ?? null,
    shippingMethod: original?.shipping_method ?? "standard",
    gift: false,
    giftMessage: "",
    discountCode: null,
    giftCardCode: null,
    lines: [{ sku, quantity, unitPrice: 0, discount: 0, tax: 0, fulfillment: "unfulfilled", allocations: [chunk] }],
    subtotal: 0,
    discount: 0,
    shipping: 0,
    tax: 0,
    shippingTax: 0,
    grand: 0,
    giftCardAmount: 0,
    cardAmount: 0,
    cardLast4: null,
    confirmationEmailedAt: null,
    events: [{ status: "placed", at: now }],
  });
  await move(u.db, { sku, location: chunk.location, reason, ref: `order:${order.number}`, from: "available", to: "committed", quantity: chunk.quantity, at: now });
  await notify(u, line.user_id, `Your Roam House order ${order.number} is placed`, `Your ${kind} order ${order.number} is placed at no charge.`, now);
  await announceOrder(u, await findByNumber(u.db, order.number));
  await announceStock(u, [sku]);
  return order;
}

export async function transition(u: Unit, actor: Actor, kind: CaseKind, number: string, input: Record<string, unknown>, now: Date): Promise<AdminCase> {
  const row = await loadCase(u.db, kind, number, undefined, true);
  if (input.version !== row.version) throw fail("stale_version");
  const to = typeof input.to === "string" ? input.to : "";
  if (!knownCaseStatus(kind, to)) throw validation({ to: FIELD.caseTo });
  if (!canMoveCase(kind, row.status, to)) throw fail("invalid_transition");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (to === "rejected" && (reason.length < 5 || reason.length > 500)) throw validation({ reason: FIELD.rejectReason });
  const line = await lineInfo(u.db, row.order_line_id);
  const next: Partial<Record<string, unknown>> = {};
  let detail = `Your ${SUBJECT[kind].toLowerCase()} ${row.number} is now ${CASE_WORDS[kind][to]}.`;
  const touched: string[] = [];

  if (to === "rejected") next.reject_reason = reason;
  if (kind === "return" && to === "received") touched.push(...(await returnUnits(u, line, row.quantity ?? 1, "return_received", `return:${row.number}`, now)));
  if (kind === "trial" && to === "returned") touched.push(...(await returnUnits(u, line, line.quantity, "trial_returned", `trial:${row.number}`, now)));
  if ((kind === "return" && to === "refunded") || (kind === "trial" && to === "refunded")) {
    const before = await refundedOnLine(u.db, line.id);
    const amount = kind === "trial" ? paid(line) - before.amount : refundShare(line, row.quantity ?? 1, before);
    const order = await findByNumber(u.db, (await summaryOf(u.db, row)).order_number, undefined, true);
    await refundOrder(u, order, amount, `${kind}:${row.number}`, now);
    next.refund_amount = amount;
    detail += ` Refund issued: ${inr(amount)}.`;
    await announceOrder(u, order);
  }
  if (kind === "return" && to === "exchanged" && row.exchange_sku) {
    const order = await zeroOrder(u, line, row.exchange_sku, row.quantity ?? 1, "exchange", "exchange_committed", now);
    next.exchange_order_id = (await findByNumber(u.db, order.number)).id;
    detail += ` Your exchange order is ${order.number}.`;
    touched.push(row.exchange_sku);
  }
  if (kind === "claim" && to === "replacement") {
    const order = await zeroOrder(u, line, line.sku, 1, "replacement", "replacement_committed", now);
    next.resolution_order_id = (await findByNumber(u.db, order.number)).id;
    detail += ` Your replacement order is ${order.number}.`;
    touched.push(line.sku);
  }

  const sets = ["status = $2", "version = version + 1", ...Object.keys(next).map((k, i) => `${k} = $${i + 3}`)];
  await u.db.query(`UPDATE cases SET ${sets.join(", ")} WHERE id = $1`, [row.id, to, ...Object.values(next)]);
  const updated = await loadCase(u.db, kind, number);
  await record(u, updated, to, now, detail);
  await audit(u, actor, "status_changed", ENTITY[kind], number, { status: row.status }, { status: to }, now);
  await announceCase(u, updated, to, updated.version);
  if (touched.length > 0) await announceStock(u, touched);
  return (await caseBody(u.db, updated)) as AdminCase;
}
