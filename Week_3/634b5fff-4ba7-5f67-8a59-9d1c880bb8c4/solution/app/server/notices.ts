import { MAIL_SUBJECTS } from "../shared/copy.js";
import { EDITION, EDITION_PRICE, plateOf } from "../shared/domain.js";
import { formatDkk } from "../shared/money.js";
import { formatCopenhagen } from "./clock.js";
import { config } from "./config.js";
import { orderRate, recipientOf, saleParts, type OrderRow } from "./orders.js";
import { pool } from "./db.js";
import type { Mail } from "./mail.js";

/** The emails the press sends; each is built from the order when it is sent. */

const orderLink = (order: OrderRow): string => `${config.publicUrl}/order/${order.reference}?token=${order.order_token}`;

const buyerMail = (order: OrderRow, subject: string, lines: string[]): Mail => ({
  to: order.buyer_email ?? "",
  subject,
  text: [`Dear ${order.buyer_name ?? ""},`, "", ...lines, "", `Your order: ${orderLink(order)}`, "", "Svovlstik Press"].join("\n"),
});

export type Template = "authorisation" | "transfer" | "receipt" | "lapse" | "refund" | "gift";

export const buildMail = async (template: Template, order: OrderRow, refundOre = 0): Promise<Mail> => {
  const box = `Box ${order.box_number} of ${EDITION}, plate ${plateOf(order.box_number)}`;
  switch (template) {
    case "authorisation":
      return buyerMail(order, MAIL_SUBJECTS.authorisation(order.box_number, order.reference), [
        `${box} is reserved for you.`,
        `Your card is authorised for ${formatDkk(EDITION_PRICE.totalOre)}. You have not been charged yet; the card is charged when the press packs your box.`,
      ]);
    case "transfer":
      return buyerMail(order, MAIL_SUBJECTS.transfer(order.box_number, order.reference), [
        `${box} is reserved while you pay by bank transfer.`,
        `Account: ${order.transfer_iban ?? ""}`,
        `Payment reference: ${order.transfer_reference ?? order.reference}`,
        `Amount: ${formatDkk(EDITION_PRICE.totalOre)}`,
        `Pay by: ${order.deadline_at ? formatCopenhagen(order.deadline_at) : ""}`,
      ]);
    case "receipt": {
      const parts = saleParts(await orderRate(pool, order));
      return buyerMail(order, MAIL_SUBJECTS.receipt(order.box_number, order.reference), [
        `${box}.`,
        `Total: ${formatDkk(EDITION_PRICE.totalOre)}`,
        `VAT: ${formatDkk(parts.vatOre)}`,
        `Courier: ${formatDkk(EDITION_PRICE.courierOre)}`,
        `Charity share: ${formatDkk(parts.charityOre)}`,
      ]);
    }
    case "lapse":
      return buyerMail(order, MAIL_SUBJECTS.lapse(order.box_number, order.reference), [
        `The bank transfer for ${box} did not arrive in time, so the box is back on the shelf.`,
      ]);
    case "refund":
      return buyerMail(order, MAIL_SUBJECTS.refund(order.box_number, order.reference), [
        `We have returned ${formatDkk(refundOre)} for ${box}.`,
      ]);
    case "gift": {
      const recipient = recipientOf(order);
      return {
        to: recipient.email,
        subject: MAIL_SUBJECTS.gift,
        text: [
          `Dear ${recipient.name},`, "",
          `${order.buyer_name ?? "Someone"} has sent you box ${order.box_number} of ${EDITION}, plate ${plateOf(order.box_number)}, from Svovlstik Press.`,
          "", order.gift_message ?? "", "", "Svovlstik Press",
        ].join("\n"),
      };
    }
  }
};
