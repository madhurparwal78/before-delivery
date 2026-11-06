// Customer emails: subject in the customer's locale, body in their locale, ten hyphens, then the other locale.
// Only public identifiers appear; user-entered text never reaches a header.
import { CADENCE_LABELS, coreScent, dropScent, pick, TAX_LABELS, TOPICS } from '../shared/catalog.js';
import { copy } from '../shared/copy.js';
import { formatMoney, formatRate } from '../shared/money.js';
import { clockTime } from '../shared/toronto.js';
const OTHER = { 'en-CA': 'fr-CA', 'fr-CA': 'en-CA' };
function bilingual(locale, block) {
    return [...block(copy(locale), locale), '----------', ...block(copy(OTHER[locale]), OTHER[locale])].join('\n');
}
const taxText = (m, locale, tax) => m.mail.tax(pick(TAX_LABELS[tax.code], locale), formatRate(tax.rate, locale), formatMoney(tax.amount.cents, locale));
const dropName = (slug, locale) => pick(dropScent(slug)?.name ?? { en: slug, fr: slug }, locale);
export function stepupCodeNotice(number, email, locale, code, expiresAt) {
    return {
        key: `code.${number}`,
        kind: 'stepup_code',
        recipient: email,
        locale,
        subject: copy(locale).mail.codeSubject(code),
        publicSubject: copy(locale).mail.codeSubject('••••••'),
        body: bilingual(locale, (m, l) => m.mail.codeLines(code, clockTime(expiresAt, l))),
    };
}
export function orderNotice(order) {
    return {
        key: `order.${order.number}`,
        kind: 'order_confirmation',
        recipient: order.email,
        locale: order.locale,
        subject: copy(order.locale).mail.orderSubject(order.number),
        publicSubject: copy(order.locale).mail.orderSubject(order.number),
        body: bilingual(order.locale, (m, l) => [
            m.mail.order(order.number),
            ...order.lines.map((line) => m.mail.barLine(line.bar, line.batch, dropName(line.scent, l), formatMoney(line.unit_cents, l))),
            m.mail.subtotal(formatMoney(order.subtotal, l)),
            m.mail.shipping(formatMoney(order.shipping, l)),
            ...order.taxes.map((tax) => taxText(m, l, tax)),
            m.mail.total(formatMoney(order.total, l)),
            m.mail.shipsOn(order.shipOn),
        ]),
    };
}
export function subscriptionNotice(sub) {
    return {
        key: `subscription.${sub.number}`,
        kind: 'subscription_started',
        recipient: sub.email,
        locale: sub.locale,
        subject: copy(sub.locale).mail.subSubject(sub.number),
        publicSubject: copy(sub.locale).mail.subSubject(sub.number),
        body: bilingual(sub.locale, (m, l) => [
            m.mail.subscription(sub.number),
            m.mail.trio(pick(coreScent(sub.scent)?.name ?? { en: sub.scent, fr: sub.scent }, l)),
            m.mail.cadence(pick(CADENCE_LABELS[sub.cadence], l)),
            m.mail.subtotal(formatMoney(sub.subtotal, l)),
            m.mail.discount(formatMoney(sub.discount, l)),
            ...sub.taxes.map((tax) => taxText(m, l, tax)),
            m.mail.total(formatMoney(sub.total, l)),
            m.mail.charged(formatMoney(sub.chargedToday, l)),
            m.mail.nextBill(sub.nextBillDate),
        ]),
    };
}
export function refundNotice(refund, email, locale) {
    return {
        key: `refund.${refund.number}`,
        kind: 'refund',
        recipient: email,
        locale,
        subject: copy(locale).mail.refundSubject(refund.number, refund.order),
        publicSubject: copy(locale).mail.refundSubject(refund.number, refund.order),
        body: bilingual(locale, (m, l) => [
            m.mail.refund(refund.number),
            m.mail.order(refund.order),
            ...refund.bars.map((bar) => m.mail.barPlain(bar.bar, bar.batch, dropName(bar.scent, l))),
            m.mail.refunded(formatMoney(refund.amount, l)),
            m.mail.refundNote,
        ]),
    };
}
export function creditNotice(number, amount, email, locale) {
    return {
        key: `credit.${number}`,
        kind: 'credit',
        recipient: email,
        locale,
        subject: copy(locale).mail.creditSubject(number),
        publicSubject: copy(locale).mail.creditSubject(number),
        body: bilingual(locale, (m, l) => [m.mail.credit(number), m.mail.amount(formatMoney(amount, l)), m.mail.creditNote]),
    };
}
export function contactNotice(number, name, email, topic, locale) {
    const label = TOPICS.find((t) => t.value === topic)?.label ?? { en: topic, fr: topic };
    return {
        key: `contact.${number}`,
        kind: 'contact_reply',
        recipient: email,
        locale,
        subject: copy(locale).mail.contactSubject(number),
        publicSubject: copy(locale).mail.contactSubject(number),
        body: bilingual(locale, (m, l) => [m.mail.reference(number), m.mail.topic(pick(label, l)), m.mail.thanks(name)]),
    };
}
