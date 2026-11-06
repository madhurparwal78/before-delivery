// Stockist requests, the split, versioned allocation edits and confirmation into Kill Bill (brief: API →
// Allocations and prices; Business rules → Allocations and split, Pricing, Confirmation).
import {
  COPY,
  FIELD,
  contactMissing,
  outOfRange,
  priceMissing,
  staleStart,
  unknownStyle,
} from "../shared/copy";
import { copenhagenDateText, marketTime, money } from "../shared/format";
import { CURRENCY, type Market, instantText } from "../shared/time";
import { type Member, type Role, requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { type DropRow, type StyleRow, staffDrop, stylesOf } from "./drops";
import { ApiError, type Json, notFound, reply, route, validationFailed } from "./http";
import { csvReply } from "./csv";
import { accountFor, invoice } from "./killbill";
import { queueMail } from "./mail";
import { copenhagenDay, priceLine, pricesInForce, splitEdition } from "./pricing";
import { visibleStockist } from "./stockists";
import { type Fields, failed, isUuid, optionalText } from "./validate";

interface AllocationRow {
  id: string;
  drop_id: string;
  drop_name: string;
  workspace_id: string;
  stockist_id: string;
  stockist_name: string;
  market: Market;
  contact_name: string | null;
  contact_email: string | null;
  contact_erased: boolean;
  status: "requested" | "split" | "confirmed";
  version: number;
  requested_at: Date | null;
  internal_note: string;
  saved_by: string;
  saved_at: Date;
  price_list_effective_date: string | null;
  invoice_number: string | null;
  killbill_invoice_id: string | null;
  total_minor: number | null;
  confirmed_at: Date | null;
}

interface LineRow {
  allocation_id: string;
  style_id: string;
  style_number: string;
  style_name: string;
  requested_quantity: number;
  allocated_quantity: number;
  unit_price_minor: number | null;
  net_minor: number | null;
  vat_minor: number | null;
  line_total_minor: number | null;
}

interface Allocation extends AllocationRow {
  lines: LineRow[];
}

const READERS: Role[] = ["merchandiser", "finance_lead", "launch_producer", "stockist_buyer"];

const ALLOCATION_SQL = `SELECT a.*, d.name AS drop_name, d.workspace_id, s.name AS stockist_name, s.market, s.contact_name, s.contact_email, s.contact_erased
  FROM allocations a JOIN drops d ON d.id = a.drop_id JOIN stockists s ON s.id = a.stockist_id
  WHERE d.workspace_id = $1 AND s.archived_at IS NULL`;

async function withLines(db: Db, found: AllocationRow[]): Promise<Allocation[]> {
  const lines = await rows<LineRow>(
    db,
    `SELECT l.*, st.style_number, st.name AS style_name FROM allocation_lines l JOIN styles st ON st.id = l.style_id
     WHERE l.allocation_id = ANY($1::uuid[]) ORDER BY st.position`,
    [found.map((a) => a.id)],
  );
  return found.map((a) => ({ ...a, lines: lines.filter((l) => l.allocation_id === a.id) }));
}

async function allocations(db: Db, me: Member, where: string, params: unknown[], lock = false): Promise<Allocation[]> {
  const own = me.role === "stockist_buyer" ? ` AND a.stockist_id = $${params.length + 2}` : "";
  const found = await rows<AllocationRow>(
    db,
    `${ALLOCATION_SQL}${where}${own} ORDER BY a.requested_at NULLS LAST, a.created_order${lock ? " FOR UPDATE OF a" : ""}`,
    [me.workspaceId, ...params, ...(own ? [me.stockistId] : [])],
  );
  return withLines(db, found);
}

async function allocationById(db: Db, me: Member, id: string, lock = false): Promise<Allocation> {
  const [found] = isUuid(id) ? await allocations(db, me, " AND a.id = $2", [id], lock) : [];
  if (!found) throw notFound();
  return found;
}

function linesJson(lines: LineRow[]): Json {
  return lines.map((l) => ({
    styleNumber: l.style_number,
    styleName: l.style_name,
    requestedQuantity: l.requested_quantity,
    allocatedQuantity: l.allocated_quantity,
    unitPriceMinor: l.unit_price_minor,
    netMinor: l.net_minor,
    vatMinor: l.vat_minor,
    lineTotalMinor: l.line_total_minor,
  }));
}

function allocationJson(me: Member, a: Allocation): Json {
  const shared = {
    id: a.id,
    dropName: a.drop_name,
    stockistName: a.stockist_name,
    status: a.status,
    currency: CURRENCY[a.market],
    lines: linesJson(a.lines),
    totalMinor: a.total_minor,
    priceListEffectiveDate: a.price_list_effective_date,
    invoiceNumber: a.invoice_number,
    confirmedAt: a.confirmed_at ? instantText(a.confirmed_at.getTime()) : null,
  };
  if (me.role === "stockist_buyer") return shared;
  return {
    ...shared,
    dropId: a.drop_id,
    stockistId: a.stockist_id,
    market: a.market,
    version: a.version,
    requestedAt: a.requested_at ? instantText(a.requested_at.getTime()) : null,
    killbillInvoiceId: a.killbill_invoice_id,
    contactName: a.contact_erased ? COPY.erased : a.contact_name,
    internalNote: a.internal_note,
    savedBy: a.saved_by,
    savedAt: instantText(a.saved_at.getTime()),
  };
}

function staleVersion(me: Member, a: Allocation): ApiError {
  return new ApiError(412, "stale_version", staleStart(a.saved_by, marketTime(a.saved_at.getTime())), {
    savedBy: a.saved_by,
    savedAt: instantText(a.saved_at.getTime()),
    current: allocationJson(me, a),
  });
}

/** Quantities per style from `lines`, each a whole number from 0 to the style's wholesale edition. */
function checkLines(value: unknown, styles: StyleRow[], fields: Fields): Map<string, number> {
  const quantities = new Map<string, number>();
  if (!Array.isArray(value)) {
    fields.lines = FIELD.required;
    return quantities;
  }
  value.forEach((raw, i) => {
    const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const number = typeof line.styleNumber === "string" ? line.styleNumber.trim() : "";
    const style = styles.find((s) => s.style_number.toLowerCase() === number.toLowerCase());
    if (!number) fields[`lines.${i}.styleNumber`] = FIELD.required;
    else if (!style) fields[`lines.${i}.styleNumber`] = unknownStyle(number);
    const max = style?.wholesale_edition ?? 0;
    if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > max) {
      fields[`lines.${i}.quantity`] = line.quantity === undefined || line.quantity === null ? FIELD.required : outOfRange(0, max);
    } else if (style) quantities.set(style.id, line.quantity);
  });
  return quantities;
}

async function createAllocation(db: Db, me: Member, drop: DropRow, stockistId: string, status: "requested" | "split", quantities: Map<string, number>, note: string): Promise<string> {
  const now = nowSeconds();
  const created = await one<{ id: string }>(
    db,
    `INSERT INTO allocations (drop_id, stockist_id, status, requested_at, internal_note, saved_by, saved_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (drop_id, stockist_id) DO NOTHING RETURNING id`,
    [drop.id, stockistId, status, status === "requested" ? new Date() : null, note, me.name, now],
  );
  if (!created) throw new ApiError(409, status === "requested" ? "allocation_split" : "allocation_exists", status === "requested" ? COPY.allocationSplit : COPY.allocationExists);
  for (const style of await stylesOf(db, drop.id)) {
    const q = quantities.get(style.id) ?? 0;
    await db.query("INSERT INTO allocation_lines (allocation_id, style_id, requested_quantity, allocated_quantity) VALUES ($1, $2, $3, $4)", [
      created.id,
      style.id,
      status === "requested" ? q : 0,
      status === "split" ? q : 0,
    ]);
  }
  return created.id;
}

route("POST", "/api/drops/{dropId}/requests", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "merchandiser", "stockist_buyer");
  const body = ctx.json();
  return tx(async (db) => {
    const stockistId = typeof body.stockistId === "string" ? body.stockistId : "";
    if (me.role === "stockist_buyer") await visibleStockist(db, me, stockistId);
    const fields: Fields = {};
    const known = isUuid(stockistId) ? await one(db, "SELECT 1 FROM stockists WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL", [stockistId, me.workspaceId]) : undefined;
    if (!known) fields.stockistId = FIELD.stockist;
    const existing = known ? await one<{ id: string; status: string }>(db, "SELECT id, status FROM allocations WHERE drop_id = $1 AND stockist_id = $2 FOR UPDATE", [drop.id, stockistId]) : undefined;
    if (existing && existing.status !== "requested") throw new ApiError(409, "allocation_split", COPY.allocationSplit);
    const quantities = checkLines(body.lines, await stylesOf(db, drop.id), fields);
    if (failed(fields)) throw validationFailed(fields);
    if (existing) {
      for (const [styleId, q] of quantities) await db.query("UPDATE allocation_lines SET requested_quantity = $3 WHERE allocation_id = $1 AND style_id = $2", [existing.id, styleId, q]);
      await db.query("UPDATE allocations SET version = version + 1, saved_by = $2, saved_at = $3 WHERE id = $1", [existing.id, me.name, nowSeconds()]);
      return reply(200, allocationJson(me, await allocationById(db, me, existing.id)));
    }
    const id = await createAllocation(db, me, drop, stockistId, "requested", quantities, "");
    return reply(201, allocationJson(me, await allocationById(db, me, id)));
  });
});

route("GET", "/api/drops/{dropId}/allocations", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, ...READERS);
  return reply(200, { items: (await allocations(pool, me, " AND a.drop_id = $2", [drop.id])).map((a) => allocationJson(me, a)) });
});

/** The proposed shares for every style over the drop's allocations that are not confirmed. */
async function proposal(db: Db, me: Member, drop: DropRow, lock: boolean): Promise<{ open: Allocation[]; shares: Map<string, Map<string, number>> }> {
  const all = await allocations(db, me, " AND a.drop_id = $2", [drop.id], lock);
  if (all.some((a) => a.status === "confirmed")) throw new ApiError(409, "drop_has_confirmed", COPY.dropHasConfirmed);
  const shares = new Map<string, Map<string, number>>();
  for (const style of await stylesOf(db, drop.id)) {
    const requests = all.map((a) => ({ stockistId: a.id, requested: a.lines.find((l) => l.style_id === style.id)?.requested_quantity ?? 0 }));
    shares.set(style.id, splitEdition(style.wholesale_edition, requests));
  }
  return { open: all, shares };
}

route("GET", "/api/drops/{dropId}/split", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "merchandiser");
  const { open, shares } = await proposal(pool, me, drop, false);
  return reply(200, {
    items: open.map((a) => ({
      stockistId: a.stockist_id,
      stockistName: a.stockist_name,
      lines: a.lines.map((l) => ({ styleNumber: l.style_number, requestedQuantity: l.requested_quantity, allocatedQuantity: shares.get(l.style_id)?.get(a.id) ?? 0 })),
    })),
  });
});

route("POST", "/api/drops/{dropId}/split", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "merchandiser");
  return tx(async (db) => {
    const { open, shares } = await proposal(db, me, drop, true);
    for (const a of open) {
      for (const l of a.lines) {
        await db.query("UPDATE allocation_lines SET allocated_quantity = $3 WHERE allocation_id = $1 AND style_id = $2", [a.id, l.style_id, shares.get(l.style_id)?.get(a.id) ?? 0]);
      }
      await db.query("UPDATE allocations SET status = 'split', version = version + 1, saved_by = $2, saved_at = $3 WHERE id = $1", [a.id, me.name, nowSeconds()]);
    }
    return reply(200, { items: (await allocations(db, me, " AND a.drop_id = $2", [drop.id])).map((a) => allocationJson(me, a)) });
  });
});

route("POST", "/api/allocations", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "merchandiser");
  const body = ctx.json();
  const drop = await staffDrop(pool, me, typeof body.dropId === "string" ? body.dropId : "");
  return tx(async (db) => {
    const fields: Fields = {};
    const stockistId = typeof body.stockistId === "string" ? body.stockistId : "";
    const known = isUuid(stockistId) ? await one(db, "SELECT 1 FROM stockists WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL", [stockistId, me.workspaceId]) : undefined;
    if (!known) fields.stockistId = FIELD.stockist;
    if (known && (await one(db, "SELECT 1 FROM allocations WHERE drop_id = $1 AND stockist_id = $2", [drop.id, stockistId]))) {
      throw new ApiError(409, "allocation_exists", COPY.allocationExists);
    }
    const quantities = checkLines(body.lines, await stylesOf(db, drop.id), fields);
    const note = optionalText(body.internalNote, "internalNote", 2000, fields);
    if (failed(fields)) throw validationFailed(fields);
    const id = await createAllocation(db, me, drop, stockistId, "split", quantities, note);
    return reply(201, allocationJson(me, await allocationById(db, me, id)));
  });
});

route("GET", "/api/allocations", "none", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, ...READERS);
  const status = ctx.query("status");
  if (status && !["requested", "split", "confirmed"].includes(status)) throw validationFailed({ status: "Choose requested, split or confirmed." });
  const found = status ? await allocations(pool, me, " AND a.status = $2", [status]) : await allocations(pool, me, "", []);
  return reply(200, { items: found.map((a) => allocationJson(me, a)) });
});

route("GET", "/api/allocations/{id}", "none", async (ctx) => {
  const me = await staff(ctx);
  const a = await allocationById(pool, me, ctx.params.id);
  requireRole(me, ...READERS);
  return reply(200, allocationJson(me, a));
});

route("PATCH", "/api/allocations/{id}", "json", async (ctx) => {
  const me = await staff(ctx);
  await allocationById(pool, me, ctx.params.id);
  requireRole(me, "merchandiser");
  const body = ctx.json();
  return tx(async (db) => {
    const a = await allocationById(db, me, ctx.params.id, true);
    if (a.status === "confirmed") throw new ApiError(409, "allocation_confirmed", COPY.allocationConfirmed);
    if (body.version !== a.version) throw staleVersion(me, a);
    const fields: Fields = {};
    const quantities = checkLines(body.lines, await stylesOf(db, a.drop_id), fields);
    const note = "internalNote" in body ? optionalText(body.internalNote, "internalNote", 2000, fields) : a.internal_note;
    if (failed(fields)) throw validationFailed(fields);
    for (const [styleId, q] of quantities) await db.query("UPDATE allocation_lines SET allocated_quantity = $3 WHERE allocation_id = $1 AND style_id = $2", [a.id, styleId, q]);
    await db.query("UPDATE allocations SET internal_note = $2, version = version + 1, saved_by = $3, saved_at = $4 WHERE id = $1", [a.id, note, me.name, nowSeconds()]);
    return reply(200, allocationJson(me, await allocationById(db, me, a.id)));
  });
});

/** Lines priced as a confirmation now would price them; a line with no price in force keeps null prices. */
async function priced(db: Db, a: Allocation): Promise<{ lines: LineRow[]; effectiveDate: string | null; missing: string | null; total: number }> {
  const currency = CURRENCY[a.market];
  const prices = await pricesInForce(db, a.workspace_id, currency, copenhagenDay());
  let missing: string | null = null;
  let effectiveDate: string | null = null;
  let total = 0;
  const lines = a.lines.map((l) => {
    if (l.allocated_quantity <= 0) return { ...l, unit_price_minor: null, net_minor: null, vat_minor: null, line_total_minor: null };
    const price = prices.get(l.style_number.toLowerCase());
    if (!price) {
      missing ??= l.style_number;
      return { ...l, unit_price_minor: null, net_minor: null, vat_minor: null, line_total_minor: null };
    }
    if (!effectiveDate || price.effectiveDate > effectiveDate) effectiveDate = price.effectiveDate;
    const p = priceLine(price.unitPriceMinor, l.allocated_quantity, a.market);
    total += p.lineTotalMinor;
    return { ...l, unit_price_minor: price.unitPriceMinor, net_minor: p.netMinor, vat_minor: p.vatMinor, line_total_minor: p.lineTotalMinor };
  });
  return { lines, effectiveDate, missing, total };
}

route("GET", "/api/allocations/{id}/quote", "none", async (ctx) => {
  const me = await staff(ctx);
  const a = await allocationById(pool, me, ctx.params.id);
  requireRole(me, "finance_lead");
  if (a.status === "confirmed") return reply(200, allocationJson(me, a));
  const quote = await priced(pool, a);
  return reply(200, allocationJson(me, { ...a, lines: quote.lines, total_minor: quote.total, price_list_effective_date: quote.effectiveDate }));
});

function confirmationMail(a: Allocation, lines: LineRow[], total: number, invoiceNumber: string, day: string): string {
  const currency = CURRENCY[a.market];
  const rowsText = lines
    .filter((l) => l.line_total_minor !== null)
    .map(
      (l) =>
        `${l.style_number} ${l.style_name} × ${l.allocated_quantity}: unit ${money(l.unit_price_minor ?? 0, currency)}, VAT ${money(l.vat_minor ?? 0, currency)}, line total ${money(l.line_total_minor ?? 0, currency)}`,
    )
    .join("\n");
  return `Hello ${a.contact_name ?? a.stockist_name},\n\nYour allocation of ${a.drop_name} for ${a.stockist_name} is confirmed.\n\n${rowsText}\n\nTotal: ${money(total, currency)}\nInvoice: ${invoiceNumber}\nPrices from the list in force on ${copenhagenDateText(day)}\n`;
}

route("POST", "/api/allocations/{id}/confirm", "json", async (ctx) => {
  const me = await staff(ctx);
  await allocationById(pool, me, ctx.params.id);
  requireRole(me, "finance_lead");
  const body = ctx.json();
  return tx(async (db) => {
    const a = await allocationById(db, me, ctx.params.id, true);
    if (a.status === "confirmed") throw new ApiError(409, "allocation_confirmed", COPY.alreadyConfirmed);
    if (body.version !== a.version) throw staleVersion(me, a);
    if (a.status !== "split") throw new ApiError(409, "allocation_not_split", COPY.allocationNotSplit);
    if (!a.lines.some((l) => l.allocated_quantity > 0)) throw new ApiError(409, "allocation_empty", COPY.allocationEmpty);
    const day = copenhagenDay();
    const quote = await priced(db, a);
    const currency = CURRENCY[a.market];
    if (quote.missing) throw new ApiError(409, "price_missing", priceMissing(quote.missing, currency));
    if (!a.contact_email) throw new ApiError(409, "contact_missing", contactMissing(a.stockist_name));
    const account = await accountFor(a.stockist_id, a.stockist_name, currency);
    const billed = await invoice(
      account,
      currency,
      quote.lines.filter((l) => l.line_total_minor !== null).map((l) => ({ description: `${l.style_number} ${l.style_name} × ${l.allocated_quantity}`, lineTotalMinor: l.line_total_minor ?? 0 })),
    );
    for (const l of quote.lines) {
      await db.query(
        "UPDATE allocation_lines SET unit_price_minor = $3, net_minor = $4, vat_minor = $5, line_total_minor = $6 WHERE allocation_id = $1 AND style_id = $2",
        [a.id, l.style_id, l.unit_price_minor, l.net_minor, l.vat_minor, l.line_total_minor],
      );
    }
    const now = nowSeconds();
    await db.query(
      `UPDATE allocations SET status = 'confirmed', version = version + 1, saved_by = $2, saved_at = $3, confirmed_at = $3, total_minor = $4,
         price_list_effective_date = $5, invoice_number = $6, killbill_invoice_id = $7 WHERE id = $1`,
      [a.id, me.name, now, quote.total, quote.effectiveDate, billed.invoiceNumber, billed.invoiceId],
    );
    await queueMail(db, {
      toName: a.contact_name,
      toEmail: a.contact_email,
      subject: `Allocation confirmed: ${a.drop_name} for ${a.stockist_name}`,
      body: confirmationMail(a, quote.lines, quote.total, billed.invoiceNumber, day),
    });
    return reply(200, allocationJson(me, await allocationById(db, me, a.id)));
  });
});

route("GET", "/api/allocations/{id}/line-sheet.csv", "none", async (ctx) => {
  const me = await staff(ctx);
  const a = await allocationById(pool, me, ctx.params.id);
  const currency = CURRENCY[a.market];
  return csvReply(
    [
      ["Style number", "Name", "Quantity", "Unit price (minor units)", "Net (minor units)", "VAT (minor units)", "Line total (minor units)", "Currency", "Price list from"],
      ...a.lines.map((l) => [l.style_number, l.style_name, l.allocated_quantity, l.unit_price_minor, l.net_minor, l.vat_minor, l.line_total_minor, currency, a.price_list_effective_date]),
    ],
    `allocation-${a.id}.csv`,
  );
});
