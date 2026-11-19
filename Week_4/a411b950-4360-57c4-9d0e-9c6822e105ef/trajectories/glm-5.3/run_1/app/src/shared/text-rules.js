/**
 * Text field rules shared by server validation and the browser. This module is
 * the single place that decides single-line text, multi-line text and bare
 * addresses (DP-46).
 */
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001F\u007F\u2028\u2029]/;
/** Single-line text: no control characters at all, no line or paragraph separators. */
export function isSingleLineText(text) {
    if (typeof text !== "string")
        return false;
    return !SINGLE_LINE_FORBIDDEN.test(text);
}
/** Multi-line text: line feed, carriage return and tab are allowed; nothing else from those ranges. */
export function isMultiLineText(text) {
    if (typeof text !== "string")
        return false;
    const stripped = text.replace(/[\n\r\t]/g, "");
    return !/[\u0000-\u001F\u007F\u2028\u2029]/.test(stripped);
}
const BARE_ADDRESS = /^[^\s<>,;"()]{1,64}@[^\s<>,;"()]+$/;
/** A bare address: one @, a dotted domain, no whitespace or disallowed punctuation. */
export function isBareAddress(text) {
    if (typeof text !== "string")
        return false;
    if (text.length > 254)
        return false;
    const at = text.split("@");
    if (at.length !== 2 || at[0].length === 0)
        return false;
    if (!at[1].includes("."))
        return false;
    return BARE_ADDRESS.test(text);
}
export function charCount(text) {
    return Array.from(text).length;
}
