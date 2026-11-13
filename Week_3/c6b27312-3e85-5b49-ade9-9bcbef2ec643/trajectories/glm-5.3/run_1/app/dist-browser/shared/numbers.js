// House rule H1: number grammar and House rule H2: number rendering and rounding.
export const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/;
export function matchesNumberGrammar(text) {
    return NUMBER_RE.test(text);
}
/** Value of a grammar-conforming text; -0 normalises to 0. */
export function grammarValue(text) {
    const n = Number(text);
    return n === 0 ? 0 : n;
}
/** Round half to even on the exact binary value, to dp decimals. */
export function roundHalfEven(n, dp) {
    if (!Number.isFinite(n))
        return n;
    const scaled = n * 10 ** dp;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    let r;
    if (diff > 0.5)
        r = floor + 1;
    else if (diff < 0.5)
        r = floor;
    else
        r = floor % 2 === 0 ? floor : floor + 1;
    const out = r / 10 ** dp;
    return Object.is(out, -0) ? 0 : out;
}
/** JS String(n) with -0 written 0 (canonical JSON numbers). */
export function canonicalNumber(n) {
    if (n === 0)
        return "0";
    return String(n);
}
function group(n) {
    return n.replace(/\B(?=(?:[0-9]{3})+\b)/g, "\u2009");
}
/**
 * A number a person reads, per H2.
 * dp is the max decimals; exact shows exactly dp decimals.
 */
export function formatNumber(n, dp, opts = {}) {
    const { exact = false, unit, sign = false } = opts;
    if (!Number.isFinite(n))
        return String(n);
    const raw = roundHalfEven(n, dp).toFixed(dp);
    const negative = raw.startsWith("-") || (sign && Object.is(n, -0));
    const mag = negative && raw.startsWith("-") ? raw.slice(1) : raw;
    const [intPart, fracPart = ""] = mag.split(".");
    let body = group(intPart) + (fracPart ? "." + fracPart : "");
    if (!exact)
        body = body.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const out = (negative ? "\u2212" : "") + body;
    if (unit)
        return out + "\u202F" + unit;
    return out;
}
/** Format with exactly dp decimals (volumes, cost band ends, Span readout). */
export const formatFixed = (n, dp) => formatNumber(n, dp, { exact: true });
/** Display a parameter value at display precision. */
export const formatPlain = (n, dp = 2) => formatNumber(n, dp);
/** Format a bounding box dimension: max 2 decimals, trailing zeros dropped. */
export const formatBBox = (n) => formatNumber(n, 2);
/** Format a bounding box triple: `<x> × <y> × <z> mm`. */
export function formatBBoxTriple(b) {
    return `${formatBBox(b[0])} \u00d7 ${formatBBox(b[1])} \u00d7 ${formatBBox(b[2])}\u202Fmm`;
}
/** Millimetres to inches display, one more decimal than mm precision. */
export function mmToInchText(mm, mmPrecision) {
    return formatNumber(mm / 25.4, mmPrecision + 1, { exact: true });
}
/** A count before an ordinary noun uses an ordinary space. */
export const formatCount = (n, noun) => `${formatNumber(n, 0, { exact: true })} ${noun}`;
/** One significant figure, used for cost band ends. */
export function formatSignificant1(n) {
    if (n === 0)
        return "0";
    const mag = Math.abs(n);
    const exp = Math.floor(Math.log10(mag));
    const r = roundHalfEven(mag / 10 ** exp, 0) * 10 ** exp;
    const digits = Math.max(0, -exp);
    return (n < 0 ? "\u2212" : "") + r.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
/** Compare by Unicode code point of the stored composed form (H3). */
export function cmpCodePoint(a, b) {
    const la = [...a].length, lb = [...b].length;
    const n = Math.min(la, lb);
    for (let i = 0; i < n; i++) {
        const ca = a.codePointAt(i), cb = b.codePointAt(i);
        if (ca !== cb)
            return ca - cb;
        if (ca > 0xffff)
            i++;
    }
    return la - lb;
}
export const cmpNumericDesc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
export const cmpNumericAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
