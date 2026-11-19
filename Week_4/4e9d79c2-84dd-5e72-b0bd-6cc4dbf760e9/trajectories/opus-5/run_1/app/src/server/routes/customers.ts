import { createHash } from 'node:crypto';
import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { CUSTOMER_SHEET_LIMIT, conflict, invalid, unsupportedMediaType } from '../errors.js';
import { copy } from '../copy.js';
import { requireDesk } from '../session.js';
import { hasContentType } from '../http.js';
import { isEmailAddress, isUkTelephone, readCsv } from '../../domain/text.js';
import { Language, isLanguage } from '../../domain/strings.js';
import {
  addCustomer,
  addReviewRow,
  bringBackCustomer,
  closeCustomer,
  customerById,
  customerHasHire,
  customerJson,
  fillEmptyFields,
  listCustomers,
  markErasingCustomers,
  markSheetSeen,
  matchesForSheetRow,
  removeCustomer,
  renameCustomer,
  reviewList,
  sheetSeen,
} from '../data/customers.js';
import { renameDocumentCustomer } from '../data/documents.js';
import { query } from '../db.js';

export const customerRoutes: Route[] = [
  route('GET', '/api/customers', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    await markErasingCustomers(desk.id, Date.now());
    const customers = await listCustomers(desk.id, {
      q: ctx.cappedQuery('q'),
      state: ctx.queryValue('state'),
    });
    ctx.json(200, { customers: customers.map(customerJson) });
  }),

  route('POST', '/api/customers', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const fields: Record<string, string> = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') fields.name = copy.enterName;
    if (!isEmailAddress(body.email)) fields.email = copy.enterEmail;
    if (!isUkTelephone(body.telephone)) fields.telephone = copy.enterTelephone;
    const language = body.language ?? 'en';
    if (!isLanguage(language)) fields.language = 'Choose a language.';
    if (Object.keys(fields).length > 0) throw invalid(Object.values(fields)[0], fields);
    const customer = await addCustomer(desk.id, {
      name,
      email: (body.email as string).trim(),
      telephone: (body.telephone as string).trim(),
      language: language as Language,
    });
    ctx.json(201, customerJson(customer));
  }),

  route('GET', '/api/customers/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    await markErasingCustomers(desk.id, Date.now());
    const customer = assertKnown(await customerById(desk.id, pathParam(ctx, 'id')));
    ctx.json(200, customerJson(customer));
  }),

  route('PATCH', '/api/customers/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    assertKnown(await customerById(desk.id, id));
    const body = await jsonBody(ctx);
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name === '') throw invalid(copy.enterName, { name: copy.enterName });
      await renameCustomer(desk.id, id, name);
      await renameHiresDocuments(desk.id, id, name);
    }
    ctx.json(200, customerJson(assertKnown(await customerById(desk.id, id))));
  }),

  route('DELETE', '/api/customers/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    assertKnown(await customerById(desk.id, id));
    if (await customerHasHire(desk.id, id)) throw conflict('customerHasHire', copy.customerHasHire);
    await removeCustomer(desk.id, id);
    ctx.send(204, '');
  }),

  route('POST', '/api/customers/:id/close', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    await jsonBody(ctx);
    const customer = assertKnown(await customerById(desk.id, id));
    if (customer.state !== 'active') throw conflict('alreadyClosed', 'That customer is already closed.');
    ctx.json(200, customerJson(await closeCustomer(desk.id, id)));
  }),

  route('POST', '/api/customers/:id/bring-back', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    await jsonBody(ctx);
    const customer = assertKnown(await customerById(desk.id, id));
    if (customer.state === 'active') throw conflict('notClosed', 'That customer is not closed.');
    if (customer.state === 'erasing' || (customer.eraseAt !== null && customer.eraseAt <= Date.now())) {
      throw conflict('waitOver', copy.bringBackOver);
    }
    ctx.json(200, customerJson(await bringBackCustomer(desk.id, id)));
  }),

  route(
    'POST',
    '/api/customers/import',
    'session',
    async (ctx) => {
      const desk = requireDesk(ctx);
      const raw = await ctx.body(CUSTOMER_SHEET_LIMIT);
      if (!hasContentType(ctx, 'text/csv')) throw unsupportedMediaType();
      const text = raw.toString('utf8');
      const lines = readCsv(text).filter((line) => line.cells.some((cell) => cell.trim() !== ''));
      const header = lines[0];
      const wanted = ['name', 'email', 'telephone', 'notes'];
      if (!header || header.cells.map((cell) => cell.trim().toLowerCase()).join(',') !== wanted.join(',')) {
        throw invalid('The first line has to read Name,Email,Telephone,Notes.');
      }
      const hash = createHash('sha256').update(text).digest('hex');
      if (await sheetSeen(desk.id, hash)) {
        ctx.json(200, { added: 0, filled: 0, reviewList: await reviewList(desk.id) });
        return;
      }
      let added = 0;
      let filled = 0;
      for (const line of lines.slice(1)) {
        const [name = '', email = '', telephone = '', notes = ''] = line.cells.map((cell) => cell.trim());
        const matches = await matchesForSheetRow(desk.id, email, telephone);
        if (matches.length > 1) {
          await addReviewRow(desk.id, line.row, copy.matchesTwoCustomers);
          continue;
        }
        if (matches.length === 1) {
          await fillEmptyFields(desk.id, matches[0].id, { email, telephone, notes });
          filled += 1;
          continue;
        }
        await addCustomer(desk.id, {
          name: name === '' ? email : name,
          email,
          telephone,
          language: 'en',
          notes,
        });
        added += 1;
      }
      await markSheetSeen(desk.id, hash);
      ctx.json(200, { added, filled, reviewList: await reviewList(desk.id) });
    },
    { limit: CUSTOMER_SHEET_LIMIT },
  ),

  route('GET', '/api/customers/review', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.json(200, { reviewList: await reviewList(desk.id) });
  }),
];

async function renameHiresDocuments(deskId: string, customerId: string, name: string): Promise<void> {
  const hires = await query<{ id: string }>('select id from enquiries where desk_id = $1 and customer_id = $2', [
    deskId,
    customerId,
  ]);
  for (const hire of hires) {
    await renameDocumentCustomer(deskId, hire.id, name);
  }
}
