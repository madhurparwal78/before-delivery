/** The wording of the five mails. Every money figure carries its status word. */
import { money } from '../shared/money.js';
import type { Order, Refund, Stage } from '../shared/types.js';

interface Mail { subject: string; body: string }

export function receiptMail(order: Order, stage: Stage): Mail {
  const names = new Map(order.lines.map((l) => [l.id, l.name]));
  const gross = stage.amountCents;
  const vat = stage.vatCents;
  const split = stage.allocations.map((a) => `  ${names.get(a.lineId)}: ${money(a.grossCents)} paid, VAT ${money(a.vatCents)} paid, net ${money(a.netCents)} paid`);
  return {
    subject: `VAT receipt: ${stage.label} for order ${order.number}`,
    body: [
      `Thank you. Your ${stage.label.toLowerCase()} for order ${order.number} is confirmed.`, '',
      `Paid amount: ${money(gross)} paid`, `VAT: ${money(vat)} paid`, `Net: ${money(gross - vat)} paid`, '',
      'Split per line:', ...split, '',
    ].join('\n'),
  };
}

export function creditNoteMail(order: Order, refund: Refund): Mail {
    return {
    subject: `Credit note for order ${order.number}: ${money(refund.returnedCents)} returned`,
    body: [
      `Credit note for order ${order.number}.`, '',
      `Line: ${order.lines.filter((l) => l.id === refund.lineId)[0].name}`, `Returned amount: ${money(refund.returnedCents)} returned`,
      `VAT reversed: ${money(refund.vatCents)} returned`, '',
    ].join('\n'),
  };
}

export function vatCorrectionMail(order: Order, corrections: { label: string; before: number; after: number }[]): Mail {
  const total = corrections.reduce((sum, c) => sum + (c.after - c.before), 0);
  return {
    subject: `VAT correction for order ${order.number}: ${money(total)} corrected`,
    body: [
      `Your order ${order.number} is now fitted at the workshop, so the VAT on the stages you paid is corrected.`, '',
      ...corrections.map((c) => `${c.label}: VAT was ${money(c.before)} paid, now ${money(c.after)} paid, correction ${money(c.after - c.before)} corrected`),
      '', `Total correction: ${money(total)} corrected`, '',
    ].join('\n'),
  };
}

export function inspectionMail(order: Order, plate: string, className: string, feeCents: number): Mail {
  return {
    subject: `Inspection recorded for order ${order.number}`,
    body: [
      `The registry shows the new class for order ${order.number}. Fit the new plate before riding.`, '',
      `Plate: ${plate}`, `New class: ${className}`, `Inspection fee: ${money(feeCents)} paid`, '',
    ].join('\n'),
  };
}

export function rideMail(bikeName: string, date: string, time: string, rideId: string): Mail {
  return {
    subject: `Test ride confirmed: ${bikeName} on ${date} at ${time}`,
    body: [`Your test ride is confirmed.`, '', `Bike: ${bikeName}`, `Date: ${date}`, `Time: ${time}`, `Ride address: /rides/${rideId}`, ''].join('\n'),
  };
}
