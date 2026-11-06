/** The fitter's order actions: dispatch or fit, record delivery, and record the inspection once the registry agrees. */
import type { DeskOrder, RegCountry } from '../shared/types.js';
import { HOLIDAYS, ROAD_CLASS_NAMES } from './catalogue.js';
import { addDays, amsterdamToday, isRealDate, localInstants, weekday } from './clock.js';
import { query, sql, theRow, transaction } from './db.js';
import { fail, invalid, notFound } from './errors.js';
import { queueMail } from './mail.js';
import { inspectionMail } from './mailtext.js';
import { loadDeskOrder, loadOrder, orderRow } from './orders.js';
import { RegistryUnreachable, readPlate, registryUnreachable } from './registry.js';

const PLATE_COLOUR: Record<RegCountry, string> = { NL: 'yellow', BE: 'white', DE: 'white' };

export async function transition(orderId: string, to: unknown): Promise<DeskOrder> {
  if (to !== 'kit dispatched' && to !== 'fitted') throw invalid({ to: 'Choose kit dispatched or fitted.' });
  await transaction(async (client) => {
    const row = await orderRow(client, orderId, true);
    if (!row) throw notFound();
    if (row.state === 'in arrears') throw fail(409, 'in_arrears');
    const posted = row.fulfilment === 'posted';
    if (row.state !== 'paid in full' || (to === 'kit dispatched') !== posted) throw fail(409, 'illegal_transition');
    await query(client, 'UPDATE orders SET state = $2 WHERE id = $1', [orderId, to]);
  });
  return loadDeskOrder(sql, orderId);
}

/** 23:59 Amsterdam time on the 14th day after delivery, moved to the next day that is no weekend or holiday of the country. */
function withdrawalDeadline(deliveredOn: string, country: string): number {
  let day = addDays(deliveredOn, 14);
  const holidays = HOLIDAYS[country];
  while (weekday(day) === 0 || weekday(day) === 6 || holidays.includes(day)) day = addDays(day, 1);
  return localInstants(day, '23:59')[0];
}

export async function recordDelivery(orderId: string, deliveredOn: unknown): Promise<DeskOrder> {
  await transaction(async (client) => {
    const row = await orderRow(client, orderId, true);
    if (!row) throw notFound();
    if (row.state !== 'kit dispatched' || row.delivered_on !== null) throw fail(409, 'illegal_transition');
    if (typeof deliveredOn !== 'string' || !isRealDate(deliveredOn)) throw invalid({ deliveredOn: 'Enter a date as YYYY-MM-DD.' });
    if (deliveredOn > amsterdamToday()) throw invalid({ deliveredOn: 'The delivery date cannot be in the future.' });
    await query(client, 'UPDATE orders SET delivered_on = $2, withdrawal_deadline = $3 WHERE id = $1', [
      orderId, deliveredOn, new Date(withdrawalDeadline(deliveredOn, row.delivery_country)).toISOString(),
    ]);
  });
  return loadDeskOrder(sql, orderId);
}

/** Inspection passes only when a fresh registry read shows the new class and plate colour. Repeating it changes nothing. */
export async function recordInspection(orderId: string): Promise<DeskOrder> {
  await transaction(async (client) => {
    const row = await orderRow(client, orderId, true);
    if (!row) throw notFound();
    if (row.state === 'inspection passed') return;
    if (row.kind !== 'kit' || !row.class_move || (row.state !== 'kit dispatched' && row.state !== 'fitted')) throw fail(409, 'illegal_transition');
    const { donor } = row;
    const country = donor.country;
    let read;
    try {
      read = await readPlate(donor.plate, country);
    } catch (error) {
      if (error instanceof RegistryUnreachable) throw registryUnreachable();
      throw error;
    }
    if (!read || read.roadClass !== 45 || read.plateColour !== PLATE_COLOUR[country]) throw fail(409, 'registry_not_updated');
    await query(client, "UPDATE orders SET state = 'inspection passed' WHERE id = $1", [orderId]);
    const order = await loadOrder(client, orderId);
    const fee = order.lines.filter((l) => l.code.startsWith('INSPECT-'))[0];
    const owner = await theRow<{ email: string }>(client, 'SELECT email FROM users WHERE id = $1', [row.user_id]);
    const mail = inspectionMail(order, donor.plate, ROAD_CLASS_NAMES[country][45], fee.grossCents);
    await queueMail(client, `inspection:${orderId}`, owner.email, mail.subject, mail.body);
  });
  return loadDeskOrder(sql, orderId);
}
