// Every mail the app sends (brief: Services — Mailpit). Transfer mails and pass PDFs carry no buyer email,
// proof, rate wording, price, voucher code or payment reference.
import { dateText, deadlineText } from "../../shared/brussels.ts";
import { euro } from "../../shared/money.ts";
import { appOrigin } from "../http.ts";
import type { Mail } from "./outbox.ts";
import type { MailAttachment } from "../services/smtp.ts";

type MailLine = { title: string; holder_name: string; list_cents: number; group_discount_cents: number; voucher_cents: number; charged_cents: number };

const SIGNATURE = "\n\nKerf Frequencies — Kerf Collective, Brussels";

function lineTable(lines: readonly MailLine[]): string {
  return lines.map((l) => {
    const parts = [`${l.title} — ${l.holder_name}`, `  Price ${euro(l.list_cents)}`];
    if (l.group_discount_cents) parts.push(`  Group discount −${euro(l.group_discount_cents)}`);
    if (l.voucher_cents) parts.push(`  Voucher −${euro(l.voucher_cents)}`);
    parts.push(`  To pay ${euro(l.charged_cents)}`);
    return parts.join("\n");
  }).join("\n\n");
}

const total = (lines: readonly MailLine[]) => euro(lines.reduce((s, l) => s + l.charged_cents, 0));

export const mails = {
  orderConfirmed: (to: string, ref: string, lines: readonly MailLine[], passes: MailAttachment[]): Mail => ({
    to, subject: `Your Kerf Frequencies order ${ref}`, attachments: passes,
    body: `Thank you — order ${ref} is confirmed.\n\n${lineTable(lines)}\n\nTotal ${total(lines)}\n\nYour passes are attached, one PDF per ticket. Show the QR code at the venue door.\n${appOrigin()}/tickets${SIGNATURE}`,
  }),
  orderReceivedReduced: (to: string, ref: string, orderId: string, lines: readonly MailLine[], deadline: Date): Mail => ({
    to, subject: `Your Kerf Frequencies order ${ref}`,
    body: `We received order ${ref} at the reduced rate.\n\n${lineTable(lines)}\n\nTotal ${total(lines)}\n\nUpload your proof of eligibility by ${deadlineText(deadline.getTime())} (Brussels time):\n${appOrigin()}/orders/${orderId}\n\nYour payment is authorised, not taken. We only take it once box office approves your rate, and release it if they don't or if the deadline passes.${SIGNATURE}`,
  }),
  proofApproved: (to: string, ref: string, passes: MailAttachment[]): Mail => ({
    to, subject: `Reduced rate approved — order ${ref}`, attachments: passes,
    body: `Your reduced rate is approved and the payment for order ${ref} has been taken.\n\nYour passes are attached, one PDF per ticket.${SIGNATURE}`,
  }),
  proofRejected: (to: string, ref: string, reason: string): Mail => ({
    to, subject: `Reduced rate not approved — order ${ref}`,
    body: `Box office could not approve the reduced rate for order ${ref}.\n\nReason: ${reason}\n\nYour payment authorisation was released; nothing was taken.${SIGNATURE}`,
  }),
  proofLapsed: (to: string, ref: string): Mail => ({
    to, subject: `Reduced-rate hold expired — order ${ref}`,
    body: `The proof deadline for order ${ref} passed without a decision, so your payment authorisation was released. Nothing was taken.${SIGNATURE}`,
  }),
  refundNotice: (to: string, ref: string, items: readonly { title: string; holder_name: string }[], cardCents: number, voucherCents: number, released: boolean): Mail => ({
    to, subject: `Refund for order ${ref}`,
    body: `These items on order ${ref} are refunded:\n\n${items.map((i) => `- ${i.title} — ${i.holder_name}`).join("\n")}\n\n${released ? "The payment authorisation for these items was released; nothing was taken for them." : `Card refund: ${euro(cardCents)}`}${voucherCents ? `\nReturned to your gift voucher: ${euro(voucherCents)}` : ""}\n\nEvery other item on the order stays valid.${SIGNATURE}`,
  }),
  transferSent: (to: string, ref: string, item: string, recipient: string): Mail => ({
    to, subject: `You transferred a ticket — order ${ref}`,
    body: `You transferred ${item} to ${recipient}. They get a new pass; your old pass for this ticket no longer scans.${SIGNATURE}`,
  }),
  transferReceived: (to: string, face: { holder: string; item: string; when: string; venue: string }, pass: MailAttachment): Mail => ({
    to, subject: `A ticket for ${face.item} is yours`, attachments: [pass],
    body: `Hello ${face.holder},\n\nA ticket was transferred to you.\n\n${face.item}\n${face.when}\n${face.venue}\n\nYour pass is attached. Show its QR code at the door.${SIGNATURE}`,
  }),
  invoiceIssued: (to: string, number: string, lines: readonly { description: string; amount_cents: number }[], amount: number, due: Date): Mail => ({
    to, subject: `Invoice ${number} from Kerf Collective`,
    body: `Invoice ${number}\n\n${lines.map((l) => `- ${l.description}: ${euro(l.amount_cents)}`).join("\n")}\n\nAmount: ${euro(amount)}\nDue on ${dateText(due.getTime())}; we collect it on that date.${SIGNATURE}`,
  }),
  creditNote: (to: string, number: string, invoiceNumber: string, lines: readonly { description: string; amount_cents: number }[], amount: number): Mail => ({
    to, subject: `Credit note ${number} from Kerf Collective`,
    body: `Credit note ${number} against invoice ${invoiceNumber}\n\n${lines.map((l) => `- ${l.description}: ${euro(l.amount_cents)}`).join("\n")}\n\nCredited: ${euro(amount)}${SIGNATURE}`,
  }),
  bankReturn: (to: string, number: string, nextRetry: Date | null): Mail => ({
    to, subject: `Payment returned — invoice ${number}`,
    body: `The bank returned the payment for invoice ${number}.\n\n${nextRetry ? `We will try to collect it again on ${dateText(nextRetry.getTime())}.` : `Invoice ${number} is written off.`}${SIGNATURE}`,
  }),
};
