import type { Request, Response } from 'express';
import type pg from 'pg';
import { withTransaction, id, pool } from './db.js';
import { err } from './errors.js';
import { serializeInvoice } from './serialize.js';
import { publish } from './live.js';
import { FolioRow, EntryRow, folioEntries, folioBalance } from './store.js';
import { renderPdf, renderInvoiceHtml } from './pdf.js';
import { putObject, getObject, invoiceKey } from './storage.js';
import { sendMail } from './mail.js';
import { config } from './config.js';
import { formatMoney } from '../shared/format.js';
import type { Invoice } from '../shared/types.js';

async function folioOf(client: pg.PoolClient, hotelId: string, folioId: string): Promise<FolioRow> {
  const res = await client.query('SELECT * FROM folios WHERE id = $1 AND hotel_id = $2', [folioId, hotelId]);
  if (!res.rows[0]) throw err.notFound();
  return res.rows[0] as FolioRow;
}

/** Close a folio at zero balance: render PDF, store it, take the number, all or nothing. */
export async function closeFolio(req: Request, res: Response) {
  const user = req.user!;
  const hotelId = user.hotelId;

  // Pre-checks and data outside the number-taking step
  const prepared = await pool.connect();
  let folio: FolioRow;
  let entries: EntryRow[];
  try {
    await prepared.query('BEGIN');
    folio = await folioOf(prepared, hotelId, req.params.id);
    if (folio.state === 'closed') throw err.conflict('This folio is closed.');
    entries = await folioEntries(prepared, folio.id);
    if (entries.length === 0) throw err.conflict('This folio has no entries.');
    const balance = folioBalance(entries);
    if (balance !== 0) throw err.conflict(`This folio still has a balance of ${formatMoney(balance)}.`);

    const stayRes = await prepared.query('SELECT * FROM stays WHERE id = $1', [folio.stay_id]);
    const stay = stayRes.rows[0];
    const lastRoomRes = await prepared.query(
      `SELECT r.number FROM stay_nights sn JOIN rooms r ON r.id = sn.room_id
       WHERE sn.stay_id = $1 ORDER BY sn.date DESC LIMIT 1`, [stay.id]);
    const roomNumber = lastRoomRes.rows[0]?.number ?? '';

    const lines = entries.map(e => ({ date: e.date, description: e.description, amountCents: e.amount_cents }));
    const totalCents = entries.filter(e => e.kind === 'charge').reduce((s, e) => s + e.amount_cents, 0);
    const paidCents = entries.filter(e => e.kind === 'payment').reduce((s, e) => s + e.amount_cents, 0);

    const hotelRes = await prepared.query('SELECT name FROM hotels WHERE id = $1', [hotelId]);
    const invoiceId = id('i');
    // Reserve the number inside this transaction; a failure rolls it back so no number is consumed
    const reserved = await prepared.query(
      `UPDATE hotels SET next_invoice_number = next_invoice_number + 1
       WHERE id = $1 RETURNING (next_invoice_number - 1) AS taken`, [hotelId]);
    const seq = reserved.rows[0].taken as number;
    const number = `INV-${String(seq).padStart(6, '0')}`;
    const key = invoiceKey(hotelId, number);

    const html = renderInvoiceHtml({
      number, hotelName: hotelRes.rows[0].name, billTo: folio.payer_name,
      arrival: stay.arrival, departure: stay.departure, roomNumber,
      lines, totalCents, paidCents, money: formatMoney
    });

    let pdf: Buffer;
    try {
      pdf = await renderPdf(html);
    } catch {
      throw err.unavailable('The invoice could not be created. The PDF service is unavailable. Nothing was saved.');
    }
    try {
      await putObject(key, pdf, 'application/pdf');
    } catch {
      throw err.unavailable('The invoice could not be created. The file store is unavailable. Nothing was saved.');
    }
    await prepared.query(
      `INSERT INTO invoices (id, hotel_id, folio_id, number, state, mail_state, bill_to_name, payer_email, pdf_key)
       VALUES ($1,$2,$3,$4,'issued','not_sent',$5,$6,$7)`,
      [invoiceId, hotelId, folio.id, number, folio.payer_name, folio.payer_email, key]);
    await prepared.query(`UPDATE folios SET state='closed' WHERE id=$1`, [folio.id]);
    await prepared.query('COMMIT');

    const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    publish(hotelId, { type: 'stay', notice: null, stayId: folio.stay_id });
    res.json({ invoice: serializeInvoice(invRes.rows[0]) });
    return;
  } catch (e) {
    try { await prepared.query('ROLLBACK'); } catch { /* already failed */ }
    throw e;
  } finally {
    prepared.release();
  }
}

export async function emailInvoice(req: Request, res: Response) {
  const user = req.user!;
  const invRes = await pool.query(
    'SELECT i.*, f.hotel_id AS hotel_id, f.stay_id AS stay_id FROM invoices i JOIN folios f ON f.id = i.folio_id WHERE i.id = $1',
    [req.params.id]);
  const row = invRes.rows[0];
  if (!row || row.hotel_id !== user.hotelId) throw err.notFound();
  const invoice = row;
  const email = invoice.payer_email?.trim();
  if (!email) throw err.validation('payerEmail', 'Enter the payer\'s email address.');
  let pdf: Buffer;
  try {
    pdf = await getObject(invoice.pdf_key);
  } catch {
    throw err.unavailable('The file store is unavailable.');
  }
  const hotelRes = await pool.query('SELECT name FROM hotels WHERE id = $1', [user.hotelId]);
  try {
    await sendMail({
      to: email, from: config.mailFrom,
      subject: `Invoice ${invoice.number} from ${hotelRes.rows[0].name}`,
      text: `Your invoice ${invoice.number} is attached.\n`,
      attachments: [{ filename: `${invoice.number}.pdf`, contentType: 'application/pdf', content: pdf }]
    });
  } catch {
    throw err.unavailable('The invoice could not be emailed. The mail service is unavailable.');
  }
  await pool.query(`UPDATE invoices SET mail_state='sent' WHERE id=$1`, [invoice.id]);
  const updated = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  publish(user.hotelId, { type: 'stay', notice: null, stayId: invoice.stay_id });
  res.json(serializeInvoice(updated.rows[0]));
}

export async function downloadInvoice(req: Request, res: Response) {
  const user = req.user!;
  const invRes = await pool.query(
    'SELECT i.*, f.hotel_id AS hotel_id FROM invoices i JOIN folios f ON f.id = i.folio_id WHERE i.id = $1',
    [req.params.id]);
  const row = invRes.rows[0];
  if (!row || row.hotel_id !== user.hotelId) throw err.notFound();
  let pdf: Buffer;
  try {
    pdf = await getObject(row.pdf_key);
  } catch {
    throw err.unavailable('The file store is unavailable.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${row.number}.pdf"`);
  res.send(pdf);
}
