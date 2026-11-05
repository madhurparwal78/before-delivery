"use strict";
// Money is integer cents end to end. The single place where typed dollar text
// becomes cents, and the single place where cents become display strings.
Object.defineProperty(exports, "__esModule", { value: true });
exports.dollarsTextToCents = dollarsTextToCents;
exports.centsToMoney = centsToMoney;
exports.centsToDollarsString = centsToDollarsString;
exports.dollarsNumberToCents = dollarsNumberToCents;
/** Parses dollars as a person types them into exact cents, or null if invalid. */
function dollarsTextToCents(text) {
    const t = text.trim();
    if (t.length === 0)
        return null;
    let rest = t;
    if (rest.startsWith("$"))
        rest = rest.slice(1);
    if (rest.length === 0)
        return null;
    let dollarsPart = rest;
    let centsPart = null;
    const dot = rest.indexOf(".");
    if (dot >= 0) {
        dollarsPart = rest.slice(0, dot);
        centsPart = rest.slice(dot + 1);
        if (centsPart.length < 1 || centsPart.length > 2 || !/^\d+$/.test(centsPart))
            return null;
    }
    if (dollarsPart.length === 0)
        return null;
    const groups = dollarsPart.split(",");
    if (groups.length > 1) {
        if (groups[0].length < 1 || groups[0].length > 3 || !/^\d+$/.test(groups[0]))
            return null;
        for (const g of groups.slice(1)) {
            if (!/^\d{3}$/.test(g))
                return null;
        }
    }
    else {
        if (!/^\d+$/.test(dollarsPart))
            return null;
    }
    const digits = groups.join("");
    const whole = parseInt(digits, 10);
    if (!Number.isSafeInteger(whole))
        return null;
    const cents = centsPart === null ? 0 : parseInt(centsPart.padEnd(2, "0"), 10);
    const total = whole * 100 + cents;
    if (!Number.isSafeInteger(total))
        return null;
    return total;
}
/** `$1,234.56` — display and email formatting, from cents. */
function centsToMoney(cents) {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    const wholeStr = String(whole);
    const grouped = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${neg ? "-" : ""}$${grouped}.${frac}`;
}
/** Exact dollars string for provider payloads, built by digit arithmetic. */
function centsToDollarsString(cents) {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    return `${neg ? "-" : ""}${whole}.${frac}`;
}
/** Interprets a provider amount (dollars) as cents without float error. */
function dollarsNumberToCents(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const rounded = Math.round(value * 100);
        if (Math.abs(value * 100 - rounded) < 0.005)
            return rounded;
        return null;
    }
    if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)) {
        return dollarsTextToCents(value);
    }
    return null;
}
