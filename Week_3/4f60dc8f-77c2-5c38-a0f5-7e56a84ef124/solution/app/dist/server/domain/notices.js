// The words of every email and push: subjects, bodies and PDF documents, built from the locked quote.
import { formatMoney } from "../../shared/money.js";
import { fxLine, longDate, MILESTONE_LABELS, utcTime } from "../../shared/format.js";
const money = (ctx, minor) => formatMoney(minor, ctx.currency);
const quoteLines = (ctx) => ctx.quote.lines.map((line) => ({ description: `${line.title} × ${line.quantity}`, amount_minor: line.amount_minor }));
const rateLine = (ctx) => fxLine(ctx.currency, ctx.quote.fx_rate, ctx.quote.fx_locked, ctx.quote.fx_locked_at);
function quoteBlock(ctx) {
    return [
        "Locked quote",
        ...quoteLines(ctx).map((line) => `  ${line.description}: ${money(ctx, line.amount_minor)}`),
        `  Subtotal: ${money(ctx, ctx.quote.subtotal_minor)}`,
        `  VAT (20%): ${money(ctx, ctx.quote.vat_minor)}`,
        `  Total: ${money(ctx, ctx.quote.total_minor)}`,
        rateLine(ctx),
    ].join("\n");
}
function invoiceBlock(ctx, invoice) {
    return [`Invoice ${invoice.number} (${MILESTONE_LABELS[invoice.milestone]})`, ...invoice.lines.map((l) => `  ${l.description}: ${money(ctx, l.amount_minor)}`), `  Amount: ${money(ctx, invoice.amount_minor)}`].join("\n");
}
function document(ctx, title, headline, invoiceLines) {
    return {
        title,
        reference: ctx.reference,
        brandName: ctx.brandName,
        currency: ctx.currency,
        lines: quoteLines(ctx),
        subtotal_minor: ctx.quote.subtotal_minor,
        vat_minor: ctx.quote.vat_minor,
        total_minor: ctx.quote.total_minor,
        fxLine: rateLine(ctx),
        headline,
        ...(invoiceLines ? { invoiceLines } : {}),
    };
}
export function depositReceipt(ctx, to, depositMinor, invoiceNumber) {
    return {
        to,
        subject: `Deposit receipt: ${ctx.reference}`,
        text: [
            `Thank you. ${ctx.brandName}'s deposit for ${ctx.reference} is paid.`,
            "",
            `Deposit paid: ${money(ctx, depositMinor)} (invoice ${invoiceNumber})`,
            "",
            quoteBlock(ctx),
            "",
            "Milestone schedule",
            `  Deposit: ${money(ctx, ctx.quote.milestones.deposit_minor)}`,
            `  Look-dev: ${money(ctx, ctx.quote.milestones.look_dev_minor)}`,
            `  Final delivery: ${money(ctx, ctx.quote.milestones.final_delivery_minor)}`,
            "",
            `Your engagement: ${ctx.engagementUrl}`,
        ].join("\n"),
        pdf: { filename: `${ctx.reference}-deposit.pdf`, document: document(ctx, `Deposit receipt ${ctx.reference}`, { label: "Deposit paid", amount_minor: depositMinor }) },
    };
}
export function invoiceIssued(ctx, to, invoice) {
    return {
        to,
        subject: `Invoice ${invoice.number} issued: ${ctx.reference}`,
        text: [`${MILESTONE_LABELS[invoice.milestone]} invoice for ${ctx.reference}, ${ctx.brandName}.`, "", invoiceBlock(ctx, invoice), "", quoteBlock(ctx), "", `Pay it from your engagement page: ${ctx.engagementUrl}`].join("\n"),
        pdf: {
            filename: `${ctx.reference}-${invoice.number}.pdf`,
            document: document(ctx, `Invoice ${invoice.number}`, { label: "Amount due", amount_minor: invoice.amount_minor }, invoice.lines),
        },
    };
}
export function invoiceReceipt(ctx, to, invoice) {
    return {
        to,
        subject: `Receipt for invoice ${invoice.number}: ${ctx.reference}`,
        text: [`Thank you. Invoice ${invoice.number} for ${ctx.reference} is paid.`, "", invoiceBlock(ctx, invoice), "", quoteBlock(ctx), "", `Your engagement: ${ctx.engagementUrl}`].join("\n"),
    };
}
export function paymentFailed(ctx, to, invoice, overdueAt) {
    return {
        to,
        subject: `Payment failed for invoice ${invoice.number}: ${ctx.reference}`,
        text: [
            `A card payment for invoice ${invoice.number} (${ctx.reference}) was declined. Nothing was charged.`,
            `Pay by ${longDate(overdueAt)}, ${utcTime(overdueAt)} UTC to avoid an overdue notice.`,
            "",
            invoiceBlock(ctx, invoice),
            "",
            quoteBlock(ctx),
            "",
            `Pay it from your engagement page: ${ctx.engagementUrl}`,
        ].join("\n"),
    };
}
export function overdueNotice(ctx, to, invoice) {
    return {
        to,
        subject: `Invoice ${invoice.number} is overdue: ${ctx.reference}`,
        text: [`Invoice ${invoice.number} for ${ctx.reference} is now overdue.`, "", invoiceBlock(ctx, invoice), "", quoteBlock(ctx), "", `Pay it from your engagement page: ${ctx.engagementUrl}`].join("\n"),
    };
}
export function refundNotice(ctx, to, parts, refundedMinor) {
    return {
        to,
        subject: `Refund of ${money(ctx, refundedMinor)}: ${ctx.reference}`,
        text: [
            `${ctx.reference} for ${ctx.brandName} is cancelled, and a refund of ${money(ctx, refundedMinor)} is on its way to the card it was paid with.`,
            "",
            ...parts.map((part, index) => `  Refund part ${index + 1}: ${money(ctx, part.amount_minor)}`),
            `  Total refunded: ${money(ctx, refundedMinor)}`,
            "",
            quoteBlock(ctx),
            "",
            `Your engagement: ${ctx.engagementUrl}`,
        ].join("\n"),
    };
}
/** Only the reference, brand, milestone, link and expiry: no amounts, no other addresses, no storage details. */
export function reviewLinkEmail(reference, brandName, milestone, to, reviewUrl, expiresAt) {
    return {
        to,
        subject: milestone === "look_dev" ? `Look-dev stills ready for review: ${reference}` : `Final stills ready for review: ${reference}`,
        text: [
            `${MILESTONE_LABELS[milestone]} stills for ${reference} (${brandName}) are ready for your review.`,
            "",
            reviewUrl,
            "",
            `This link works until ${longDate(expiresAt)}, ${utcTime(expiresAt)} UTC.`,
        ].join("\n"),
    };
}
export const depositPush = (ctx, depositMinor) => ({ title: "Deposit paid", message: `${ctx.reference} · ${ctx.brandName} · ${money(ctx, depositMinor)}` });
export const revisionPush = (reference, milestone, round) => ({
    title: "Revision requested",
    message: `${reference} · ${MILESTONE_LABELS[milestone]} round ${round}`,
});
export const overduePush = (ctx, invoice) => ({
    title: "Invoice overdue",
    message: `${ctx.reference} · invoice ${invoice.number} · ${money(ctx, invoice.amount_minor)}`,
});
