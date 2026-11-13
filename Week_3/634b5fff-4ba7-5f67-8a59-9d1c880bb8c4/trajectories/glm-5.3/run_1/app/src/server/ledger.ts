import { query } from './db.js';
import { apiError } from './errors.js';
import { businessClock, config } from './config.js';
import * as kb from './killbill.js';
import { CHARITY_NAME } from './edition.js';
import { formatOre } from '../shared/money.js';
import * as store from './storage.js';
import * as svix from './webhooks.js';
import { withTransaction } from './db.js';

/** The ledger view for one order. */
export async function ledgerFor(reference: string): Promise<{
  reference: string;
  rateBasisPoints: number;
  grossOre: number;
  courierOre: number;
  totalOre: number;
  lines: { kind: string; grossOre: number; netOre: number; vatOre: number; charityOre: number; makerOre: number; settledAt: string | null }[];
  totals: { grossOre: number; netOre: number; vatOre: number; charityOre: number; makerOre: number };
  gatewayFeeOre: number | null;
  makerAfterFeesOre: number;
  refunds: { refundId: string; state: string; amountOre: number }[];
  killbill: { invoiceId: string; items: { description: string; amountOre: number }[]; transactions: { type: string; amountOre: number }[] } | null;
}> {
  const orders = await query<{
    reference: string; rate_bps: number; gross_ore: number; courier_ore: number; total_ore: number;
    gateway_fee_ore: number | null; method: string; kb_invoice_id: string | null;
  }>('SELECT reference, rate_bps, gross_ore, courier_ore, total_ore, gateway_fee_ore, method, kb_invoice_id FROM orders WHERE reference = $1', [reference]);
  if (orders.length === 0) throw apiError(404, 'not_found');
  const o = orders[0];

  const lines = await query<{ kind: string; gross_ore: number; net_ore: number; vat_ore: number; charity_ore: number; maker_ore: number; posted_at: Date | null }>(
    'SELECT kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, posted_at FROM split_lines WHERE reference = $1 ORDER BY id',
    [reference],
  );
  const refunds = await query<{ refundId: string; state: string; amountOre: number }>(
    'SELECT refund_id AS "refundId", state, amount_ore AS "amountOre" FROM refunds WHERE reference = $1 ORDER BY created_at',
    [reference],
  );

  // The Kill Bill part: null (with status 200) when Kill Bill is down.
  let killbill: Awaited<ReturnType<typeof ledgerFor>>['killbill'] = null;
  if (o.kb_invoice_id) {
    try {
      const inv = await kb.getInvoice(o.kb_invoice_id);
      if (inv) {
        const items = inv.items.filter((i) => i.linkedInvoiceItemId === null).map((i) => ({ description: i.description ?? '', amountOre: Math.round(i.amount * 100) }));
        let transactions: { type: string; amountOre: number }[] = [];
        const payments = await query<{ kb_payment_id: string | null }>('SELECT kb_payment_id FROM orders WHERE reference = $1', [reference]);
        if (payments[0]?.kb_payment_id) {
          const pay = await kb.getPayment(payments[0].kb_payment_id);
          if (pay) {
            transactions = pay.transactions.map((t) => ({ type: t.transactionType, amountOre: Math.round((t.amount ?? 0) * 100) }));
          }
        }
        killbill = { invoiceId: inv.invoiceId, items, transactions };
      }
    } catch {
      killbill = null;
    }
  }

  const totals = lines.reduce((acc, l) => ({
    grossOre: acc.grossOre + l.gross_ore,
    netOre: acc.netOre + l.net_ore,
    vatOre: acc.vatOre + l.vat_ore,
    charityOre: acc.charityOre + l.charity_ore,
    makerOre: acc.makerOre + l.maker_ore,
  }), { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 });

  const fee = o.gateway_fee_ore;
  const makerAfterFees = totals.makerOre - (fee ?? 0);

  return {
    reference,
    rateBasisPoints: o.rate_bps,
    grossOre: o.gross_ore,
    courierOre: o.courier_ore,
    totalOre: o.total_ore,
    lines: lines.map((l) => ({
      kind: l.kind,
      grossOre: l.gross_ore,
      netOre: l.net_ore,
      vatOre: l.vat_ore,
      charityOre: l.charity_ore,
      makerOre: l.maker_ore,
      settledAt: l.posted_at ? new Date(l.posted_at).toISOString() : null,
    })),
    totals,
    gatewayFeeOre: fee,
    makerAfterFeesOre: makerAfterFees,
    refunds,
    killbill,
  };
}

export interface RateRow { rateBasisPoints: number; effectiveFrom: string }

export async function charityRates(): Promise<RateRow[]> {
  const rows = await query<{ rate_bps: number; effective_from: Date }>(
    'SELECT rate_bps, effective_from FROM rate_changes ORDER BY effective_from',
  );
  return rows.map((r) => ({ rateBasisPoints: r.rate_bps, effectiveFrom: new Date(r.effective_from).toISOString() }));
}

export async function scheduleRate(rateBps: number, effectiveFrom: string): Promise<RateRow> {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw apiError(422, 'rate_invalid');
  const instant = Date.parse(effectiveFrom);
  if (!Number.isFinite(instant)) throw apiError(422, 'rate_invalid');
  if (instant <= businessClock.nowMs()) throw apiError(422, 'rate_must_be_future');
  await query('INSERT INTO rate_changes (rate_bps, effective_from) VALUES ($1,$2)', [rateBps, new Date(instant).toISOString()]);
  return { rateBasisPoints: rateBps, effectiveFrom: new Date(instant).toISOString() };
}

export interface StatementLine {
  reference: string; boxNumber: number; kind: 'sale' | 'refund';
  grossOre: number; netOre: number; vatOre: number; charityOre: number; makerOre: number;
  rateBasisPoints: number; postedAt: string;
}

/** All lines posted in one Copenhagen calendar month. */
export async function monthLines(month: string): Promise<StatementLine[]> {
  const start = Date.parse(`${month}-01T00:00:00+01:00`);
  if (!Number.isFinite(start)) throw apiError(422, 'month_invalid');
  const endDate = new Date(start);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const rows = await query<{
    reference: string; box_number: number; kind: string; gross_ore: number; net_ore: number; vat_ore: number;
    charity_ore: number; maker_ore: number; rate_bps: number; posted_at: Date;
  }>(
    `SELECT sl.reference, o.number AS box_number, sl.kind, sl.gross_ore, sl.net_ore, sl.vat_ore, sl.charity_ore, sl.maker_ore, sl.rate_bps, sl.posted_at
       FROM split_lines sl JOIN orders o ON o.reference = sl.reference
      WHERE sl.posted_at >= $1 AND sl.posted_at < $2
      ORDER BY sl.posted_at, sl.id`,
    [new Date(start).toISOString(), endDate.toISOString()],
  );
  return rows.map((r) => ({
    reference: r.reference,
    boxNumber: r.box_number,
    kind: r.kind as 'sale' | 'refund',
    grossOre: r.gross_ore,
    netOre: r.net_ore,
    vatOre: r.vat_ore,
    charityOre: r.charity_ore,
    makerOre: r.maker_ore,
    rateBasisPoints: r.rate_bps,
    postedAt: new Date(r.posted_at).toISOString(),
  }));
}

/** Issue a month's statement as a real PDF. */
export async function issueStatement(month: string): Promise<{
  id: string; month: string; revision: number; charityTotalOre: number; makerTotalOre: number; vatTotalOre: number;
  lines: StatementLine[]; pdfUrl: string; token: string;
}> {
  // The month must have started.
  const now = businessClock.now();
  const start = Date.parse(`${month}-01T00:00:00+01:00`);
  if (!Number.isFinite(start)) throw apiError(422, 'month_invalid');
  const nowCph = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit' }).format(now).replace('-', ''));
  const startCph = Number(month.replace('-', ''));
  if (startCph > nowCph) throw apiError(422, 'month_invalid');

  const lines = await monthLines(month);
  const totals = lines.reduce((acc, l) => ({
    charity: acc.charity + l.charityOre,
    maker: acc.maker + l.makerOre,
    vat: acc.vat + l.vatOre,
  }), { charity: 0, maker: 0, vat: 0 });

  const existing = await query<{ revision: number }>(
    'SELECT revision FROM statements WHERE month = $1 ORDER BY revision DESC LIMIT 1', [month],
  );
  const revision = (existing[0]?.revision ?? 0) + 1;
  const id = `stmt-${month.replace('-', '')}-r${revision}`;
  const token = crypto.randomUUID().replace(/-/g, '');

  const html = statementHtml(month, revision, lines, totals);
  const pdf = await renderPdf(html);
  const objectKey = `statements/${month}-r${revision}.pdf`;
  try {
    await store.putObject(objectKey, pdf, 'application/pdf');
  } catch {
    throw apiError(503, 'storage_unreachable');
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO statements (id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore, object_key, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, month, revision, totals.charity, totals.maker, totals.vat, objectKey, token],
    );
  });

  // The signed statement.issued event.
  const payload = {
    eventId: `evt-${id}`,
    statementId: id,
    month,
    revision,
    charityTotalOre: totals.charity,
    lineCount: lines.length,
    downloadUrl: `${config.appPublicUrl}/api/statements/${id}/pdf?token=${token}`,
    issuedAt: businessClock.now().toISOString(),
  };
  try {
    await svix.sendMessage(`evt-${id}`, 'statement.issued', payload);
  } catch { /* kept and retried under its own policy */ }

  return {
    id, month, revision,
    charityTotalOre: totals.charity,
    makerTotalOre: totals.maker,
    vatTotalOre: totals.vat,
    lines,
    pdfUrl: `/api/staff/statements/${id}/pdf`,
    token,
  };
}

function statementHtml(month: string, revision: number, lines: StatementLine[], totals: { charity: number; maker: number; vat: number }): string {
  const money = (n: number) => (n < 0 ? `-DKK ${formatOre(-n)}` : `DKK ${formatOre(n)}`);
  const rows = lines.map((l) => {
    const g = l.grossOre < 0 ? `-DKK ${formatOre(-l.grossOre)}` : `DKK ${formatOre(l.grossOre)}`;
    const net = l.netOre < 0 ? `-DKK ${formatOre(-l.netOre)}` : `DKK ${formatOre(l.netOre)}`;
    const vat = l.vatOre < 0 ? `-DKK ${formatOre(-l.vatOre)}` : `DKK ${formatOre(l.vatOre)}`;
    const ch = l.charityOre < 0 ? `-DKK ${formatOre(-l.charityOre)}` : `DKK ${formatOre(l.charityOre)}`;
    const mk = l.makerOre < 0 ? `-DKK ${formatOre(-l.makerOre)}` : `DKK ${formatOre(l.makerOre)}`;
    return `<tr><td>Box ${l.boxNumber} ${l.reference} ${l.kind} gross ${g} net ${net} VAT ${vat} charity ${ch} maker ${mk}</td></tr>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 20mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #10202e; font-size: 10.5pt; }
    h1 { font-size: 17pt; letter-spacing: 0.04em; }
    .sub { color: #4a5b66; margin-top: 1mm; }
    table { width: 100%; border-collapse: collapse; margin-top: 8mm; }
    td { padding: 1.6mm 0; border-bottom: 0.3pt solid #c6d2da; white-space: nowrap; }
    .total { margin-top: 8mm; font-size: 12pt; font-weight: bold; }
  </style></head><body>
  <h1>Charity statement ${month}</h1>
  <p class="sub">Revision ${revision}</p>
  <p class="sub">${CHARITY_NAME}</p>
  <table>${rows}</table>
  <p class="total">Total charity share: ${money(totals.charity)}</p>
  </body></html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`pdf render failed ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw apiError(503, 'pdf_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export async function statements(): Promise<{ id: string; month: string; revision: number; charityTotalOre: number; makerTotalOre: number; vatTotalOre: number; pdfUrl: string; issuedAt: string }[]> {
  const rows = await query<{ id: string; month: string; revision: number; charity_total_ore: number; maker_total_ore: number; vat_total_ore: number; issued_at: Date }>(
    'SELECT id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore, issued_at FROM statements ORDER BY issued_at DESC, revision DESC',
  );
  return rows.map((r) => ({
    id: r.id, month: r.month, revision: r.revision,
    charityTotalOre: r.charity_total_ore, makerTotalOre: r.maker_total_ore, vatTotalOre: r.vat_total_ore,
    pdfUrl: `/api/staff/statements/${r.id}/pdf`,
    issuedAt: new Date(r.issued_at).toISOString(),
  }));
}
