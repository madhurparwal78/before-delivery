import { one, pool, withTransaction } from '../db';
import { Db } from '../db';
import { addDays } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import { DESK_ROLES } from '../domain/roles';
import { arePercentsValid, splitShares } from '../../shared/split';
import {
  errorTexts,
  failure,
  invalid,
  notFoundError,
  outageTexts,
  validationTexts,
} from '../http/errors';
import { Router } from '../http/router';
import { Hotel } from '../repo/hotels';
import {
  balanceOf,
  createFolio,
  entryDescriptions,
  entryIsLocked,
  EntryView,
  FolioRecord,
  invoicePdfUrl,
  insertEntry,
  isValidPayerEmail,
  listFolios,
  loadEntryRecord,
  loadFolioRecord,
} from '../repo/folios';
import { loadStayRecordById, roomForNight, segmentsOf, StayRecord } from '../repo/stays';
import { getObject, invoiceObjectKey, putObject } from '../services/fileStore';
import { mailTexts, sendMessage } from '../services/mail';
import { renderPdf } from '../services/pdf';
import { ProviderDownError } from '../services/providers';
import { publishStayChange } from './changes';
import { hotelOf, integerField, textField } from './support';

interface FolioContext {
  folio: FolioRecord;
  stay: StayRecord;
}

async function folioInHotel(db: Db, hotel: Hotel, folioId: string): Promise<FolioContext> {
  const folio = await loadFolioRecord(db, folioId);
  if (!folio) throw notFoundError();
  const stay = await loadStayRecordById(db, folio.stayId);
  if (!stay || stay.hotelId !== hotel.id) throw notFoundError();
  return { folio, stay };
}

function requireOpen(folio: FolioRecord): void {
  if (folio.state === 'closed') throw failure(409, errorTexts.folioClosed);
}

async function foliosOfStay(db: Db, stayId: string): Promise<unknown> {
  return { folios: await listFolios(db, stayId) };
}

async function folioJson(db: Db, stayId: string, folioId: string): Promise<unknown> {
  const folios = await listFolios(db, stayId);
  const found = folios.find((folio) => folio.id === folioId);
  if (!found) throw notFoundError();
  return found;
}

async function guestOf(db: Db, guestId: string): Promise<{ name: string; email: string }> {
  const guest = await one<{ name: string; email: string }>(
    db,
    'select name, email from guests where id = $1',
    [guestId],
  );
  return guest ?? { name: '', email: '' };
}

/** The exact text lines the stored invoice PDF carries. */
async function invoiceLines(
  db: Db,
  hotel: Hotel,
  stay: StayRecord,
  folio: FolioRecord,
  entries: EntryView[],
  invoiceNumber: string,
  billToName: string,
): Promise<string[]> {
  const segments = await segmentsOf(db, stay.id);
  const lastNight = roomForNight(segments, addDays(stay.departure, -1));
  const charges = entries
    .filter((entry) => entry.kind === 'charge')
    .reduce((total, entry) => total + entry.amountCents, 0);
  const payments = entries
    .filter((entry) => entry.kind === 'payment')
    .reduce((total, entry) => total + entry.amountCents, 0);
  return [
    `Invoice ${invoiceNumber}`,
    hotel.name,
    `Bill to: ${billToName}`,
    `Stay: ${stay.arrival} to ${stay.departure}`,
    `Room ${lastNight ? lastNight.roomNumber : ''}`,
    ...entries.map((entry) => `${entry.date} ${entry.description} ${formatMoney(entry.amountCents)}`),
    `Total: ${formatMoney(charges)}`,
    `Paid: ${formatMoney(payments)}`,
    `Balance: ${formatMoney(charges - payments)}`,
  ];
}

function invoiceNumberText(sequence: number): string {
  return `INV-${String(sequence).padStart(6, '0')}`;
}

export function registerFolioRoutes(router: Router): void {
  router.add({
    method: 'PATCH',
    pattern: '/api/folios/:id',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const { folio, stay } = await folioInHotel(pool, hotel, ctx.params.id);
      requireOpen(folio);
      const payerName = textField(ctx.body, 'payerName');
      const payerEmail = textField(ctx.body, 'payerEmail');
      if (!isValidPayerEmail(payerEmail)) {
        throw invalid({ payerEmail: validationTexts.payerEmail });
      }
      const json = await withTransaction(async (db) => {
        await db.query('update folios set payer_name = $2, payer_email = $3 where id = $1', [
          folio.id,
          payerName,
          payerEmail,
        ]);
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return folioJson(db, stay.id, folio.id);
      });
      return { status: 200, json };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/folios/:id/charges',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const { folio, stay } = await folioInHotel(pool, hotel, ctx.params.id);
      requireOpen(folio);
      const amountCents = integerField(ctx.body, 'amountCents');
      if (amountCents === null || amountCents <= 0) {
        throw invalid({ amountCents: validationTexts.amountAboveZero });
      }
      const description = textField(ctx.body, 'description').trim();
      if (description === '') throw invalid({ description: 'Enter a description.' });
      const entry = await withTransaction(async (db) => {
        const created = await insertEntry(db, {
          folioId: folio.id,
          kind: 'charge',
          date: hotel.businessDate,
          description,
          amountCents,
        });
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return created;
      });
      return { status: 201, json: entry };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/folios/:id/payments',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const { folio, stay } = await folioInHotel(pool, hotel, ctx.params.id);
      requireOpen(folio);
      const method = textField(ctx.body, 'method');
      const amountCents = integerField(ctx.body, 'amountCents');
      const reference = textField(ctx.body, 'reference').trim();
      const errors: Record<string, string> = {};
      if (method !== 'cash' && method !== 'card') errors.method = 'Choose a payment method.';
      if (amountCents === null || amountCents <= 0) {
        errors.amountCents = validationTexts.amountAboveZero;
      }
      if (method === 'card' && reference === '') errors.reference = validationTexts.terminalReference;
      if (Object.keys(errors).length > 0) throw invalid(errors);
      const entry = await withTransaction(async (db) => {
        const created = await insertEntry(db, {
          folioId: folio.id,
          kind: 'payment',
          date: hotel.businessDate,
          description:
            method === 'cash'
              ? entryDescriptions.cashPayment
              : entryDescriptions.cardPayment(reference),
          amountCents: amountCents as number,
        });
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return created;
      });
      return { status: 201, json: entry };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/entries/:id/reverse',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const entry = await loadEntryRecord(pool, ctx.params.id);
      if (!entry) throw notFoundError();
      const { folio, stay } = await folioInHotel(pool, hotel, entry.folioId);
      requireOpen(folio);
      if (await entryIsLocked(pool, entry)) throw failure(409, errorTexts.entryLocked);
      const created = await withTransaction(async (db) => {
        const reversal = await insertEntry(db, {
          folioId: folio.id,
          kind: entry.kind,
          date: hotel.businessDate,
          description: entryDescriptions.reversalOf(entry.description),
          amountCents: -entry.amountCents,
          roomNumber: entry.roomNumber,
          reversesEntryId: entry.id,
        });
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return reversal;
      });
      return { status: 201, json: created };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/entries/:id/split',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const entry = await loadEntryRecord(pool, ctx.params.id);
      if (!entry) throw notFoundError();
      const { folio, stay } = await folioInHotel(pool, hotel, entry.folioId);
      requireOpen(folio);
      if (entry.kind !== 'charge' || (await entryIsLocked(pool, entry))) {
        throw failure(409, errorTexts.entryLocked);
      }
      const percents = ctx.body.percents;
      if (!arePercentsValid(percents)) throw invalid({ percents: validationTexts.percents });
      const shares = splitShares(entry.amountCents, percents);
      const json = await withTransaction(async (db) => {
        await insertEntry(db, {
          folioId: folio.id,
          kind: 'charge',
          date: hotel.businessDate,
          description: entryDescriptions.reversalOf(entry.description),
          amountCents: -entry.amountCents,
          roomNumber: entry.roomNumber,
          reversesEntryId: entry.id,
        });
        const guest = await guestOf(db, stay.guestId);
        const existing = await listFolios(db, stay.id);
        const targetIds = existing.map((candidate) => candidate.id);
        while (targetIds.length < shares.length) {
          targetIds.push((await createFolio(db, stay.id, guest.name, guest.email)).id);
        }
        for (let index = 0; index < shares.length; index += 1) {
          await insertEntry(db, {
            folioId: targetIds[index],
            kind: 'charge',
            date: entry.date,
            description: entryDescriptions.share(entry.description, percents[index]),
            amountCents: shares[index],
            roomNumber: entry.roomNumber,
            splitOfEntryId: entry.id,
          });
        }
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
        return foliosOfStay(db, stay.id);
      });
      return { status: 201, json };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/entries/:id/move',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const entry = await loadEntryRecord(pool, ctx.params.id);
      if (!entry) throw notFoundError();
      const source = await folioInHotel(pool, hotel, entry.folioId);
      requireOpen(source.folio);
      const target = await folioInHotel(pool, hotel, textField(ctx.body, 'toFolioId'));
      if (target.stay.id !== source.stay.id) throw notFoundError();
      requireOpen(target.folio);
      const json = await withTransaction(async (db) => {
        await db.query('update entries set folio_id = $2 where id = $1', [entry.id, target.folio.id]);
        await publishStayChange(db, hotel, { type: 'stay', stayId: source.stay.id, notice: null });
        return foliosOfStay(db, source.stay.id);
      });
      return { status: 200, json };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/folios/:id/close',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const { folio, stay } = await folioInHotel(pool, hotel, ctx.params.id);
      requireOpen(folio);
      const folios = await listFolios(pool, stay.id);
      const current = folios.find((candidate) => candidate.id === folio.id);
      if (!current) throw notFoundError();
      if (current.entries.length === 0) throw failure(409, errorTexts.folioNoEntries);
      const balance = balanceOf(current.entries);
      if (balance !== 0) throw failure(409, errorTexts.folioHasBalance(balance));

      try {
        const json = await withTransaction(async (db) => {
          const sequence = await one<{ next_invoice_number: number }>(
            db,
            `update hotels set next_invoice_number = next_invoice_number + 1
              where id = $1 returning next_invoice_number - 1 as next_invoice_number`,
            [hotel.id],
          );
          const invoiceNumber = invoiceNumberText(sequence ? sequence.next_invoice_number : 1);
          const billToName = current.payerName;
          const lines = await invoiceLines(
            db,
            hotel,
            stay,
            folio,
            current.entries,
            invoiceNumber,
            billToName,
          );
          const pdf = await renderPdf(lines);
          const objectKey = invoiceObjectKey(hotel.id, invoiceNumber);
          await putObject(objectKey, pdf, 'application/pdf');
          await db.query(
            `insert into invoices (id, hotel_id, folio_id, number, state, mail_state,
                                   bill_to_name, payer_email, pdf_key)
             values ($1,$2,$3,$4,'issued','not_sent',$5,$6,$7)`,
            [
              `${hotel.id}:${invoiceNumber}`,
              hotel.id,
              folio.id,
              invoiceNumber,
              billToName,
              current.payerEmail,
              objectKey,
            ],
          );
          await db.query("update folios set state = 'closed' where id = $1", [folio.id]);
          await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
          return folioJson(db, stay.id, folio.id);
        });
        return { status: 200, json };
      } catch (error) {
        if (error instanceof ProviderDownError) {
          throw failure(
            503,
            error.provider === 'gotenberg'
              ? outageTexts.invoicePdfService
              : outageTexts.invoiceFileStore,
          );
        }
        throw error;
      }
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/invoices/:id/email',
    access: DESK_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const invoice = await one<{
        id: string;
        folio_id: string;
        number: string;
        mail_state: string;
        bill_to_name: string;
        payer_email: string;
        pdf_key: string;
      }>(
        pool,
        `select id, folio_id, number, mail_state, bill_to_name, payer_email, pdf_key
           from invoices where hotel_id = $1 and id = $2`,
        [hotel.id, ctx.params.id],
      );
      if (!invoice) throw notFoundError();
      const { stay } = await folioInHotel(pool, hotel, invoice.folio_id);
      const payerEmail = invoice.payer_email.trim();
      if (payerEmail === '' || !isValidPayerEmail(payerEmail)) {
        throw invalid({ payerEmail: validationTexts.payerEmail });
      }
      let pdf: Buffer;
      try {
        const stored = await getObject(invoice.pdf_key);
        if (!stored) throw notFoundError();
        pdf = stored.body;
      } catch (error) {
        if (error instanceof ProviderDownError) throw failure(503, outageTexts.fileStoreRead);
        throw error;
      }
      try {
        await sendMessage({
          to: payerEmail,
          subject: mailTexts.invoiceSubject(invoice.number, hotel.name),
          text: mailTexts.invoiceBody(invoice.number),
          attachment: {
            fileName: `${invoice.number}.pdf`,
            contentType: 'application/pdf',
            body: pdf,
          },
        });
      } catch (error) {
        if (error instanceof ProviderDownError) throw failure(503, outageTexts.invoiceMail);
        throw error;
      }
      await withTransaction(async (db) => {
        await db.query("update invoices set mail_state = 'sent' where id = $1", [invoice.id]);
        await publishStayChange(db, hotel, { type: 'stay', stayId: stay.id, notice: null });
      });
      return {
        status: 200,
        json: {
          id: invoice.id,
          number: invoice.number,
          state: 'issued',
          mailState: 'sent',
          billToName: invoice.bill_to_name,
          payerEmail: invoice.payer_email,
          pdfUrl: invoicePdfUrl(invoice.id),
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/invoices/:id/pdf',
    access: DESK_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const invoice = await one<{ pdf_key: string; number: string }>(
        pool,
        'select pdf_key, number from invoices where hotel_id = $1 and id = $2',
        [hotel.id, ctx.params.id],
      );
      if (!invoice) throw notFoundError();
      try {
        const stored = await getObject(invoice.pdf_key);
        if (!stored) throw notFoundError();
        return {
          status: 200,
          body: stored.body,
          contentType: 'application/pdf',
          headers: { 'content-disposition': `inline; filename="${invoice.number}.pdf"` },
        };
      } catch (error) {
        if (error instanceof ProviderDownError) throw failure(503, outageTexts.fileStoreRead);
        throw error;
      }
    },
  });
}
