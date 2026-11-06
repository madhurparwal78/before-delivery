import { money } from './format-helpers.js';
import { printCutoff, printTimeSec, practiceZoneName } from './time.js';
export const HOOF_NAMES = { LF: 'Left fore', RF: 'Right fore', LH: 'Left hind', RH: 'Right hind' };
export { money };
export const emails = {
    bookingConfirmedEmail,
    bookingCancelledEmail,
    horseExcusedEmail,
    waitlistOfferEmail,
    offerLapsedEmail,
    visitSummaryEmail,
    dueReminderEmail,
    dunningEmail,
    outstandingAlertEmail,
    vetLinkEmail
};
export function bookingConfirmedEmail(horse, ctx, cutoff) {
    return {
        subject: `Booked: ${horse} at ${ctx.barnName} on ${ctx.businessDate}`,
        body: `${horse} is booked at ${ctx.slotTime} at ${ctx.barnName} on ${ctx.businessDate}.\nCancel by ${printCutoff(cutoff)}. Cancelling after the cutoff keeps the trip share.`
    };
}
export function bookingCancelledEmail(horse, ctx, tripShareApplies, depositCents, refunded) {
    const lines = [
        `${horse} at ${ctx.barnName} on ${ctx.businessDate} is cancelled.`,
        tripShareApplies ? 'A trip share still applies.' : 'No trip share applies.'
    ];
    if (depositCents > 0) {
        lines.push(refunded
            ? ` Your ${money(depositCents)} deposit will be refunded.`
            : ` Your ${money(depositCents)} deposit is kept and set against the trip share.`);
    }
    return { subject: `Cancelled: ${horse} at ${ctx.barnName} on ${ctx.businessDate}`, body: lines.join('') };
}
export function horseExcusedEmail(horse, ctx, depositCents) {
    const body = `${horse} at ${ctx.barnName} on ${ctx.businessDate} is excused from this day. No trip share applies.` +
        (depositCents > 0 ? ` Your ${money(depositCents)} deposit will be refunded.` : '');
    return { subject: `Excused: ${horse} at ${ctx.barnName} on ${ctx.businessDate}`, body };
}
export function waitlistOfferEmail(horse, ctx, holdEndsAt) {
    return {
        subject: `Slot offered: ${horse} at ${ctx.barnName} on ${ctx.businessDate}`,
        body: `A slot opened for ${horse} at ${ctx.barnName} on ${ctx.businessDate}. Hold ends at ${printTimeSec(holdEndsAt)} (${practiceZoneName()}).`
    };
}
export function offerLapsedEmail(horse, ctx) {
    return {
        subject: `Slot offer lapsed: ${horse} at ${ctx.barnName} on ${ctx.businessDate}`,
        body: `The slot offered for ${horse} at ${ctx.barnName} on ${ctx.businessDate} was not confirmed in time.`
    };
}
export function visitSummaryEmail(horse, businessDate, items, totalCents, nextDue) {
    const lines = items.map(i => `${i.description}: ${i.amount_cents < 0 ? money(i.amount_cents) : money(i.amount_cents)}`);
    lines.push(`Invoice total ${money(totalCents)}`);
    if (nextDue)
        lines.push(`Next due ${nextDue}`);
    return { subject: `Visit summary: ${horse} on ${businessDate}`, body: lines.join('\n') };
}
export function dueReminderEmail(horse, date) {
    return { subject: `Due soon: ${horse} by ${date}`, body: `${horse} is due for the farrier by ${date}.` };
}
export function dunningEmail(state, horse, date, nextTry) {
    switch (state) {
        case 'past_due':
            return { subject: `Payment failed: ${horse} on ${date}`, body: `We will try again on ${nextTry ?? date}.` };
        case 'retry_1':
            return { subject: `Second payment attempt failed: ${horse} on ${date}`, body: `We will try again on ${nextTry ?? date}.` };
        case 'retry_2':
            return { subject: `Third payment attempt failed: ${horse} on ${date}`, body: `We will try again on ${nextTry ?? date}.` };
        case 'blocked':
            return { subject: `Account on hold: ${horse} on ${date}`, body: 'New bookings are on hold until this invoice is paid.' };
        case 'cleared':
            return { subject: `Payment received: ${horse} on ${date}`, body: 'Thank you; the invoice is paid.' };
    }
}
export function outstandingAlertEmail(thresholdCents, outstandingCents) {
    return {
        subject: `Outstanding balance over ${money(thresholdCents)}`,
        body: `Outstanding balance is ${money(outstandingCents)}, over the ${money(thresholdCents)} threshold.`
    };
}
export function vetLinkEmail(horse, url, expiresAt) {
    return {
        subject: `Hoof comparison for ${horse}`,
        body: `You can view the hoof comparison for ${horse} here:\n${url}\nThis link works until ${printCutoff(expiresAt).replace(' (', ' (')}.`
    };
}
