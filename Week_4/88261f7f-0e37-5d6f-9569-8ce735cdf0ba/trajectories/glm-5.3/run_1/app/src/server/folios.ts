import type { Request, Response } from 'express';
import type pg from 'pg';
import { withTransaction, id } from './db.js';
import { err } from './errors.js';
import { hotelNow } from './guards.js';
import { serializeInvoice } from './serialize.js';
import { publish } from './live.js';
import { FolioRow, EntryRow, StayRow, stayFolios, folioEntries, folioBalance, nextFolioLetter, stayNights } from './store.js';
import type { Folio } from '../shared/types.js';

export async function createFolio(req: Request, res: Response) {
  const user = req.user!;
  const folio = await withTransaction(async client => {
    const stay = await stayOf(client, user.hotelId, req.params.id);
    const errors: Record<string, string> = {};
    const payerName = typeof req.body.payerName === 'string' ? req.body.payerName.trim() : '';
    const payerEmail = typeof req.body.payerEmail === 'string' ? req.body.payerEmail.trim() : '';
    if (!payerName) errors.payerName = 'Enter the payer\'s name.';
    if (!payerEmail) errors.payerEmail = 'Enter the payer\'s email address.';
    if (Object.keys(errors).length) throw err.validations(errors);
    const folios = await stayFolios(client, stay.id);
    const letter = nextFolioLetter(folios.map(f => f.letter));
    const folioId = id('f');
    await client.query(
      `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
      [folioId, user.hotelId, stay.id, `Folio ${letter}`, payerName, payerEmail, letter]);
    return serializeFolio(client, folioId);
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId: req.params.id });
  res.status(201).json(folio);
}

async function stayOf(client: pg.PoolClient, hotelId: string, stayId: string): Promise<StayRow> {
  const res = await client.query('SELECT * FROM stays WHERE id = $1 AND hotel_id = $2', [stayId, hotelId]);
  if (!res.rows[0]) throw err.notFound();
  return res.rows[0] as StayRow;
}

async function folioOf(client: pg.PoolClient, hotelId: string, folioId: string): Promise<FolioRow> {
  const res = await client.query('SELECT * FROM folios WHERE id = $1 AND hotel_id = $2', [folioId, hotelId]);
  if (!res.rows[0]) throw err.notFound();
  return res.rows[0] as FolioRow;
}

export async function serializeFolio(client: pg.PoolClient, folioId: string): Promise<Folio> {
  const res = await client.query('SELECT * FROM folios WHERE id = $1', [folioId]);
  const f = res.rows[0] as FolioRow;
  const entries = await folioEntries(client, folioId);
  const invoiceRes = await client.query('SELECT * FROM invoices WHERE folio_id = $1', [folioId]);
  const invoiceRow = invoiceRes.rows[0];
  return {
    id: f.id, name: f.name, payerName: f.payer_name, payerEmail: f.payer_email,
    state: f.state, balanceCents: folioBalance(entries),
    entries: entries.map(serializeEntryRow),
    invoice: invoiceRow ? serializeInvoice(invoiceRow) : null
  };
}

function serializeEntryRow(e: EntryRow) {
  return {
    id: e.id, kind: e.kind, date: e.date, description: e.description,
    amountCents: e.amount_cents, roomNumber: e.room_number,
    reversesEntryId: e.reverses_entry_id, splitOfEntryId: e.split_of_entry_id
  };
}

export async function patchFolio(req: Request, res: Response) {
  const user = req.user!;
  const folio = await withTransaction(async client => {
    const f = await folioOf(client, user.hotelId, req.params.id);
    if (f.state === 'closed') throw err.conflict('This folio is closed.');
    const errors: Record<string, string> = {};
    const payerName = typeof req.body.payerName === 'string' ? req.body.payerName.trim() : '';
    const payerEmail = typeof req.body.payerEmail === 'string' ? req.body.payerEmail.trim() : '';
    if (req.body.payerName !== undefined && !payerName) errors.payerName = 'Enter the payer\'s name.';
    if (req.body.payerEmail !== undefined && !payerEmail) errors.payerEmail = 'Enter the payer\'s email address.';
    if (Object.keys(errors).length) throw err.validations(errors);
    const upd = await client.query(
      'UPDATE folios SET payer_name = COALESCE($1, payer_name), payer_email = COALESCE($2, payer_email) WHERE id = $3 RETURNING *',
      [
        req.body.payerName !== undefined ? payerName : null,
        req.body.payerEmail !== undefined ? payerEmail : null,
        f.id
      ]);
    return serializeFolio(client, upd.rows[0].id);
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId: (folio as Folio).id });
  res.json(folio);
}

export async function addCharge(req: Request, res: Response) {
  const user = req.user!;
  const { entry, stayId } = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const f = await folioOf(client, user.hotelId, req.params.id);
    if (f.state === 'closed') throw err.conflict('This folio is closed.');
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const amountCents = req.body.amountCents;
    if (!description) throw err.validation('description', 'Enter a description.');
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
      throw err.validation('amountCents', 'Enter an amount above zero.');
    }
    const entryId = id('e');
    await client.query(
      `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
       VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
      [entryId, f.id, hotel.business_date, description, amountCents, null]);
    const entryRes = await client.query('SELECT * FROM entries WHERE id = $1', [entryId]);
    return { entry: serializeEntryRow(entryRes.rows[0] as EntryRow), stayId: f.stay_id };
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId });
  res.status(201).json(entry);
}

export async function addPayment(req: Request, res: Response) {
  const user = req.user!;
  const { entry, stayId } = await withTransaction(async client => {
    const hotel = await hotelRow(client, user.hotelId);
    const f = await folioOf(client, user.hotelId, req.params.id);
    if (f.state === 'closed') throw err.conflict('This folio is closed.');
    const method = req.body.method;
    if (method !== 'cash' && method !== 'card') throw err.validation('method', 'Choose a payment method.');
    const amountCents = req.body.amountCents;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
      throw err.validation('amountCents', 'Enter an amount above zero.');
    }
    const reference = typeof req.body.reference === 'string' ? req.body.reference.trim() : '';
    if (method === 'card' && !reference) throw err.validation('reference', 'Enter the terminal reference.');
    const description = method === 'cash' ? 'Cash payment' : `Card payment ${reference}`;
    const entryId = id('e');
    await client.query(
      `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents)
       VALUES ($1,$2,'payment',$3,$4,$5)`,
      [entryId, f.id, hotel.business_date, description, amountCents]);
    const entryRes = await client.query('SELECT * FROM entries WHERE id = $1', [entryId]);
    return { entry: serializeEntryRow(entryRes.rows[0] as EntryRow), stayId: f.stay_id };
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId });
  res.status(201).json(entry);
}

async function hotelRow(client: pg.PoolClient, hotelId: string) {
  const res = await client.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
  const row = res.rows[0];
  if (!row) throw err.notFound();
  return row as { id: string; name: string; time_zone: string; business_date: string; clock_fixed_at: Date | null };
}

export async function reverseEntry(req: Request, res: Response) {
  const user = req.user!;
  const { entry, stayId } = await withTransaction(async client => {
    const entryRes = await client.query(
      `SELECT e.*, f.hotel_id AS hotel_id, f.stay_id AS stay_id FROM entries e JOIN folios f ON f.id = e.folio_id WHERE e.id = $1`,
      [req.params.id]);
    const row = entryRes.rows[0];
    if (!row || row.hotel_id !== user.hotelId) throw err.notFound();
    const original = row as EntryRow & { hotel_id: string; stay_id: string };
    const f = await folioOf(client, user.hotelId, original.folio_id);
    if (f.state === 'closed') throw err.conflict('This folio is closed.');
    if (original.reverses_entry_id || original.split_of_entry_id) {
      throw err.conflict('This entry cannot be changed again.');
    }
    const already = await client.query('SELECT 1 FROM entries WHERE reverses_entry_id = $1 OR split_of_entry_id = $1', [original.id]);
    if (already.rows[0]) throw err.conflict('This entry cannot be changed again.');
    const entryId = id('e');
    await client.query(
      `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number, reverses_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entryId, original.folio_id, original.kind, original.date, `Reversal of ${original.description}`,
        -original.amount_cents, original.room_number, original.id]);
    const newEntryRes = await client.query('SELECT * FROM entries WHERE id = $1', [entryId]);
    return { entry: serializeEntryRow(newEntryRes.rows[0] as EntryRow), stayId: original.stay_id };
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId });
  res.status(201).json(entry);
}

export async function splitEntry(req: Request, res: Response) {
  const user = req.user!;
  const { folios, stayId } = await withTransaction(async client => {
    const entryRes = await client.query(
      `SELECT e.*, f.hotel_id AS hotel_id, f.stay_id AS stay_id FROM entries e JOIN folios f ON f.id = e.folio_id WHERE e.id = $1`,
      [req.params.id]);
    const row = entryRes.rows[0];
    if (!row || row.hotel_id !== user.hotelId) throw err.notFound();
    const original = row as EntryRow & { hotel_id: string; stay_id: string };
    if (original.kind === 'payment') throw err.conflict('This entry cannot be changed again.');
    const folio = await folioOf(client, user.hotelId, original.folio_id);
    if (folio.state === 'closed') throw err.conflict('This folio is closed.');
    if (original.reverses_entry_id || original.split_of_entry_id) {
      throw err.conflict('This entry cannot be changed again.');
    }
    const already = await client.query('SELECT 1 FROM entries WHERE reverses_entry_id = $1 OR split_of_entry_id = $1', [original.id]);
    if (already.rows[0]) throw err.conflict('This entry cannot be changed again.');

    const percents = req.body.percents;
    if (!Array.isArray(percents) || percents.length < 2 || percents.length > 4 ||
        !percents.every((p: unknown) => typeof p === 'number' && Number.isInteger(p) && p >= 0) ||
        percents.reduce((s: number, p: number) => s + p, 0) !== 100) {
      throw err.validation('percents', 'Enter 2 to 4 whole percentages that add up to 100.');
    }

    // reversal of the original on its folio
    await client.query(
      `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number, reverses_entry_id)
       VALUES ($1,$2,'charge',$3,$4,$5,$6,$7)`,
      [id('e'), original.folio_id, original.date, `Reversal of ${original.description}`, -original.amount_cents, original.room_number, original.id]);

    // shares: rounded down, remainder cents to folios in letter order starting with Folio A
    const shares = percents.map((p: number) => Math.floor(original.amount_cents * p / 100));
    let remainder = original.amount_cents - shares.reduce((s: number, x: number) => s + x, 0);
    const stayFoliosRow = await stayFolios(client, original.stay_id);
    const targetFolios: FolioRow[] = [];
    for (let i = 0; i < percents.length; i++) {
      let folioForShare = stayFoliosRow[i];
      if (!folioForShare) {
        const letter = nextFolioLetter(stayFoliosRow.map(f => f.letter));
        const newId = id('f');
        const guestRes = await client.query(
          'SELECT g.name, g.email FROM stays s JOIN guests g ON g.id = s.guest_id WHERE s.id = $1', [original.stay_id]);
        await client.query(
          `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
          [newId, user.hotelId, original.stay_id, `Folio ${letter}`, guestRes.rows[0].name, guestRes.rows[0].email, letter]);
        const created = (await client.query('SELECT * FROM folios WHERE id = $1', [newId])).rows[0] as FolioRow;
        folioForShare = created;
        stayFoliosRow.push(created);
      }
      targetFolios.push(folioForShare);
    }
    // remainder cents go one at a time to the folios in letter order, starting with Folio A
    const order = [...targetFolios].sort((a, b) => a.letter.localeCompare(b.letter));
    let li = 0;
    while (remainder > 0) {
      const folioForRemainder = order[li % order.length];
      const idx = targetFolios.indexOf(folioForRemainder);
      shares[idx]++;
      remainder--;
      li++;
    }
    for (let i = 0; i < targetFolios.length; i++) {
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number, split_of_entry_id)
         VALUES ($1,$2,'charge',$3,$4,$5,$6,$7)`,
        [id('e'), targetFolios[i].id, original.date,
          `${original.description} (${percents[i]}%)`, shares[i], original.room_number, original.id]);
    }
    // return the stay's folios in letter order, once each
    const finalFolios = [...stayFoliosRow].sort((a, b) => a.letter.localeCompare(b.letter));
    const serializedFolios = [];
    for (const f of finalFolios) serializedFolios.push(await serializeFolio(client, f.id));
    return { folios: serializedFolios, stayId: original.stay_id };
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId });
  res.status(201).json({ folios });
}

export async function moveEntry(req: Request, res: Response) {
  const user = req.user!;
  const { folios, stayId } = await withTransaction(async client => {
    const entryRes = await client.query(
      `SELECT e.*, f.hotel_id AS hotel_id, f.stay_id AS stay_id FROM entries e JOIN folios f ON f.id = e.folio_id WHERE e.id = $1`,
      [req.params.id]);
    const row = entryRes.rows[0];
    if (!row || row.hotel_id !== user.hotelId) throw err.notFound();
    const original = row as EntryRow & { hotel_id: string; stay_id: string };
    const source = await folioOf(client, user.hotelId, original.folio_id);
    if (source.state === 'closed') throw err.conflict('This folio is closed.');
    const target = await folioOf(client, user.hotelId, req.body.toFolioId);
    if (target.state === 'closed') throw err.conflict('This folio is closed.');
    if (target.stay_id !== source.stay_id) throw err.conflict('This entry cannot be moved to another stay.');
    if (original.reverses_entry_id || original.split_of_entry_id) {
      throw err.conflict('This entry cannot be changed again.');
    }
    await client.query('UPDATE entries SET folio_id = $1 WHERE id = $2', [target.id, original.id]);
    const sourceFolio = await serializeFolio(client, source.id);
    const targetFolio = await serializeFolio(client, target.id);
    return { folios: [sourceFolio, targetFolio], stayId: source.stay_id };
  });
  publish(user.hotelId, { type: 'stay', notice: null, stayId });
  res.json({ folios });
}
