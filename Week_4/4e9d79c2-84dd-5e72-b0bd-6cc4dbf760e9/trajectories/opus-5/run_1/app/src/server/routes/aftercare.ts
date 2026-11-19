import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, invalid } from '../errors.js';
import { copy } from '../copy.js';
import { makeId, one, query } from '../db.js';
import { requireDesk } from '../session.js';
import { RETURN_CHARGE_PENNIES, complaintReplyDue, holdingDate } from '../../domain/aftercare.js';
import { moneyString } from '../../domain/money.js';
import { instantString, isDateString, isTimeString, readWall, ukDateOf } from '../../domain/time.js';
import { customerById } from '../data/customers.js';
import { holidaysFor } from '../data/holidays.js';

type ComplaintRow = {
  id: string;
  customer_id: string;
  summary: string;
  received_date: string;
  received_time: string;
  reply_due: string;
  holiday_line: string | null;
};

type ItemRow = {
  id: string;
  description: string;
  found_on: string;
  held_to: string;
  state: string;
  owner_details: string | null;
  charge: number | null;
};

function complaintJson(row: ComplaintRow): Record<string, unknown> {
  return {
    id: row.id,
    customerId: row.customer_id,
    summary: row.summary,
    receivedAt: { date: row.received_date, time: row.received_time },
    replyDue: row.reply_due,
    holidayLine: row.holiday_line,
  };
}

/** `Past holding date` from the day after `heldTo`, decided at each read. */
function itemState(row: ItemRow, now: number): string {
  if (row.state === 'returned') return 'returned';
  return ukDateOf(now) > row.held_to ? 'pastHoldingDate' : 'held';
}

function itemJson(row: ItemRow, now: number): Record<string, unknown> {
  return {
    id: row.id,
    description: row.description,
    foundOn: row.found_on,
    heldTo: row.held_to,
    state: itemState(row, now),
    ownerDetails: row.owner_details,
    charge: row.charge === null ? null : moneyString(Number(row.charge)),
  };
}

export const aftercareRoutes: Route[] = [
  route('POST', '/api/complaints', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const customerId = typeof body.customerId === 'string' ? body.customerId : '';
    assertKnown(await customerById(desk.id, customerId));
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (summary === '') throw invalid('Write a summary.', { summary: 'Write a summary.' });
    const receivedAt = body.receivedAt;
    if (receivedAt === null || typeof receivedAt !== 'object' || Array.isArray(receivedAt)) {
      throw invalid(copy.enterDate, { receivedAt: copy.enterDate });
    }
    const asked = receivedAt as Record<string, unknown>;
    if (!isDateString(asked.date)) throw invalid(copy.enterDate, { receivedAt: copy.enterDate });
    if (!isTimeString(asked.time)) throw invalid(copy.chooseHourAndMinutes, { receivedAt: copy.chooseHourAndMinutes });
    const holidays = await holidaysFor(desk.id, Date.now());
    const replyDue = complaintReplyDue(asked.date, asked.time, holidays.holidays);
    const id = makeId('CP');
    await query(
      `insert into complaints (desk_id, id, customer_id, summary, received_date, received_time, reply_due, holiday_line, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [desk.id, id, customerId, summary, asked.date, asked.time, replyDue, holidays.line, Date.now()],
    );
    ctx.json(201, {
      id,
      customerId,
      summary,
      receivedAt: { date: asked.date, time: asked.time },
      replyDue,
      holidayLine: holidays.line,
      announcement: copy.complaintLogged,
    });
  }),

  route('GET', '/api/complaints', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const rows = await query<ComplaintRow>(
      `select id, customer_id, summary, received_date, received_time, reply_due, holiday_line
       from complaints where desk_id = $1 order by created_at desc, id`,
      [desk.id],
    );
    ctx.json(200, { complaints: rows.map(complaintJson) });
  }),

  route('POST', '/api/lost-property', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description === '') throw invalid('Name the item.', { description: 'Name the item.' });
    const foundOn = body.foundOn;
    if (!isDateString(foundOn)) throw invalid(copy.enterDate, { foundOn: copy.enterDate });
    const heldTo = holdingDate(foundOn);
    const id = makeId('LP');
    await query(
      `insert into lost_property (desk_id, id, description, found_on, held_to, state, created_at)
       values ($1,$2,$3,$4,$5,'held',$6)`,
      [desk.id, id, description, foundOn, heldTo, Date.now()],
    );
    ctx.json(201, { id, description, foundOn, heldTo, state: 'held', announcement: copy.itemLogged });
  }),

  route('GET', '/api/lost-property', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const rows = await query<ItemRow>(
      `select id, description, found_on, held_to, state, owner_details, charge from lost_property
       where desk_id = $1 order by created_at desc, id`,
      [desk.id],
    );
    const now = Date.now();
    ctx.json(200, { items: rows.map((row) => itemJson(row, now)) });
  }),

  route('POST', '/api/lost-property/:id/return', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    const row = assertKnown(
      await one<ItemRow>(
        `select id, description, found_on, held_to, state, owner_details, charge from lost_property
         where desk_id = $1 and id = $2`,
        [desk.id, id],
      ),
    );
    const body = await jsonBody(ctx);
    const ownerDetails = typeof body.ownerDetails === 'string' ? body.ownerDetails.trim() : '';
    if (ownerDetails === '') throw invalid(copy.recordOwnerFirst, { ownerDetails: copy.recordOwnerFirst });
    if (row.state === 'returned') throw conflict('alreadyReturned', 'That item has already gone back.');
    await query(
      "update lost_property set state = 'returned', owner_details = $3, charge = $4 where desk_id = $1 and id = $2",
      [desk.id, id, ownerDetails, RETURN_CHARGE_PENNIES],
    );
    ctx.json(200, {
      ...itemJson({ ...row, state: 'returned', owner_details: ownerDetails, charge: RETURN_CHARGE_PENNIES }, Date.now()),
      charge: moneyString(RETURN_CHARGE_PENNIES),
      announcement: copy.itemReturned,
    });
  }),
];

export { instantString };
