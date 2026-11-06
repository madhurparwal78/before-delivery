import { FLAVOUR_NAMES, longDate, money, PROVINCE_NAMES, rateText } from "../shared/format.js";
import { config } from "./config.js";
import { rateLabel } from "./domain/money.js";
import { enqueueMail } from "./mail.js";
// Every email the shop sends, with the brief's subjects. Bodies hold no card data, provider
// ids, keys, tokens or any address other than the order's own ship-to.
const SIGN_OFF = "\nCeibo Shop & Cellar\nOrganic sparkling yerba mate, sparkled in small batches.\n";
function orderSummary(full) {
    const o = full.order;
    const lines = full.lines.map((l) => `  ${l.quantity} x ${FLAVOUR_NAMES[l.flavour] ?? l.flavour}    ${money(l.goods_cents)}`);
    return [
        ...lines,
        "",
        `  Subtotal    ${money(o.goods_cents)}`,
        ...(o.discount_cents > 0 ? [`  Subscribe & save (10%)    ${money(-o.discount_cents)}`] : []),
        `  Deposit    ${money(o.deposit_cents)}`,
        `  Shipping    ${o.shipping_cents === 0 ? "Free" : money(o.shipping_cents)}`,
        ...full.taxes.map((t) => `  ${t.name} (${rateText(rateLabel(t.rate_milli))}%)    ${money(t.cents)}`),
        `  Total    ${money(o.total_cents)}`,
        "",
        "Shipping to:",
        `  ${o.ship_to.name}`,
        `  ${o.ship_to.line1}${o.ship_to.line2 ? `, ${o.ship_to.line2}` : ""}`,
        `  ${o.ship_to.city} ${o.ship_to.province}  ${o.ship_to.postal_code}`,
        "",
        `Invoice (PDF): ${config.publicUrl}/api/orders/${o.number}/invoice.pdf`,
    ].join("\n");
}
export async function orderConfirmed(client, full) {
    const o = full.order;
    await enqueueMail(client, o.email, `Your Ceibo order ${o.number} is confirmed`, `Hi ${o.customer_name},\n\nThanks for your order. We're packing your crate for ${PROVINCE_NAMES[o.province] ?? o.province}.\n\n${orderSummary(full)}\n${SIGN_OFF}`);
}
export async function receiptCopy(full) {
    const o = full.order;
    await enqueueMail(null, o.email, `Your Ceibo order ${o.number} receipt (copy)`, `Hi ${o.customer_name},\n\nHere is a copy of your receipt.\n\n${orderSummary(full)}\n${SIGN_OFF}`);
}
export async function renewalPaid(client, full) {
    const o = full.order;
    await enqueueMail(client, o.email, `Your Ceibo box renewed: order ${o.number}`, `Hi ${o.customer_name},\n\nYour auto-delivery renewed and your next box is on its way to packing.\n\n${orderSummary(full)}\n${SIGN_OFF}`);
}
export async function upcomingRenewal(client, to, name, renewalDate, manageUrl) {
    await enqueueMail(client, to, `Your next Ceibo box renews on ${longDate(renewalDate)}`, `Hi ${name},\n\nYour next box renews on ${longDate(renewalDate)}. Changes made now apply to the box after that one.\n\nManage your auto-delivery: ${config.publicUrl}${manageUrl}\n${SIGN_OFF}`);
}
function changeCopy(change) {
    switch (change.kind) {
        case "pause":
            return ["Your Ceibo subscription is paused", `Your deliveries are paused. They restart on ${longDate(change.resumesOn)}.`];
        case "skip":
            return ["Your next Ceibo box is skipped", `We'll skip the box due on ${longDate(change.date)}.`];
        case "swap":
            return [`Your Ceibo box is now ${change.planLabel}`, `From ${longDate(change.date)} your box is the ${change.planLabel}.`];
        case "cancel":
            return [
                `Your Ceibo subscription will end on ${longDate(change.endDate)}`,
                `Your subscription ends on ${longDate(change.endDate)}. Nothing more will be charged after that.`,
            ];
    }
}
export async function changeApplied(client, to, name, change) {
    const [subject, line] = changeCopy(change);
    await enqueueMail(client, to, subject, `Hi ${name},\n\n${line}\n${SIGN_OFF}`);
}
export async function dunningMail(client, to, name, step, manageUrl) {
    const update = `Update your card: ${config.publicUrl}${manageUrl}/card`;
    const [subject, line] = step.kind === "failed"
        ? ["Your Ceibo renewal didn't go through", `We couldn't take payment for your renewal. We'll try again tomorrow.\n${update}`]
        : step.kind === "retry"
            ? [`Ceibo payment retry ${step.retry} of 3 didn't go through`, `Retry ${step.retry} of 3 didn't go through.\n${update}`]
            : step.kind === "hold"
                ? ["Your Ceibo deliveries are on hold", `Your deliveries are on hold because we couldn't take payment.\n${update}`]
                : ["Your Ceibo subscription has been cancelled", "Your subscription has been cancelled because payment couldn't be taken."];
    await enqueueMail(client, to, subject, `Hi ${name},\n\n${line}\n${SIGN_OFF}`);
}
export async function refundApplied(client, full, refund) {
    const o = full.order;
    const split = refund.split;
    const parts = [
        ...split.lines.flatMap((l) => [
            `  ${FLAVOUR_NAMES[l.flavour] ?? l.flavour} cans    ${money(l.goods_cents)}`,
            `  ${FLAVOUR_NAMES[l.flavour] ?? l.flavour} deposit    ${money(l.deposit_cents)}`,
        ]),
        `  Shipping    ${money(split.shipping_cents)}`,
        ...split.taxes.map((t) => `  ${t.name}    ${money(t.cents)}`),
        `  Total refunded    ${money(refund.amount_cents)}`,
    ];
    await enqueueMail(client, o.email, `Refund of ${money(refund.amount_cents)} for order ${o.number}`, `Hi ${o.customer_name},\n\nWe've refunded ${money(refund.amount_cents)} for order ${o.number}. It goes back to the card you paid with.\n\n${parts.join("\n")}\n${SIGN_OFF}`);
}
export async function applicationDecided(to, contact, business, approved) {
    await enqueueMail(null, to, `Your Ceibo stockist application was ${approved ? "approved" : "declined"}`, approved
        ? `Hi ${contact},\n\nGood news: ${business} is approved to stock Ceibo. We'll be in touch about your first order.\n${SIGN_OFF}`
        : `Hi ${contact},\n\nThanks for applying with ${business}. We can't take on new stockists in your area right now.\n${SIGN_OFF}`);
}
