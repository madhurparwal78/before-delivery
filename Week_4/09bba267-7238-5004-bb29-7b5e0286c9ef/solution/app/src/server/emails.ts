// The four e-mails the box office sends, as plain text.
import { formatMoney } from "../shared/rules.js";
import type { MailMessage } from "./smtp.js";
import type { Order } from "../shared/types.js";
import { config } from "./config.js";

const SIGN_OFF = ["", "Halyard Hall Box Office"];

export function receiptMail(order: Order): MailMessage {
  return {
    to: order.email,
    subject: `Your Halyard Hall tickets: order ${order.id}`,
    body: [
      `Order ${order.id}`,
      "",
      order.performanceTitle,
      order.startsAtVenue,
      "",
      ...order.tickets.map((t) => `${t.label} (${t.tierName}): face ${formatMoney(t.faceCents)}, fee ${formatMoney(t.seatFeeCents)}`),
      `Order fee ${formatMoney(order.orderFeeCents)}`,
      `Total ${formatMoney(order.totalCents)}`,
      ...SIGN_OFF,
    ].join("\n"),
  };
}

interface OfferMailFacts {
  to: string;
  token: string;
  seatLabel: string;
  performanceTitle: string;
  startsAtVenue: string;
  totalCents: number;
  acceptBy: string;
}

export function offerMail(offer: OfferMailFacts): MailMessage {
  return {
    to: offer.to,
    subject: `A seat is offered to you: ${offer.performanceTitle}`,
    body: [
      "A seat has come free and it is offered to you.",
      "",
      offer.seatLabel,
      offer.performanceTitle,
      offer.startsAtVenue,
      "",
      `Total ${formatMoney(offer.totalCents)}`,
      `Accept by ${offer.acceptBy}`,
      "",
      `${config.publicUrl}/offers/${offer.token}`,
      ...SIGN_OFF,
    ].join("\n"),
  };
}

export function exchangeMail(order: Order, fromLabel: string, toLabel: string, differenceCents: number): MailMessage {
  const difference = differenceCents > 0 ? `Charged ${formatMoney(differenceCents)}`
    : differenceCents < 0 ? `Refunded ${formatMoney(-differenceCents)}` : "No price difference";
  return {
    to: order.email,
    subject: `Your seat exchange: order ${order.id}`,
    body: [order.performanceTitle, order.startsAtVenue, "", `From ${fromLabel}`, `To ${toLabel}`, difference, ...SIGN_OFF].join("\n"),
  };
}

export function refundMail(order: Order, labels: string[], includesOrderFee: boolean, refundCents: number): MailMessage {
  return {
    to: order.email,
    subject: `Your refund: order ${order.id}`,
    body: [
      order.performanceTitle,
      order.startsAtVenue,
      "",
      ...labels,
      ...(includesOrderFee ? ["Order fee refunded"] : []),
      `Refunded ${formatMoney(refundCents)}`,
      ...SIGN_OFF,
    ].join("\n"),
  };
}
