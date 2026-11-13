// Single-line text: programme titles and rental set publishers.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
/** Any character from U+0000 to U+001F or U+007F. */
export function hasControlCharacter(value) {
    return CONTROL_CHARACTER.test(value);
}
/** One line of 1 to 120 characters after trimming spaces; the control-character check comes first. */
export function singleLineText(value, label) {
    if (typeof value === "string" && hasControlCharacter(value)) {
        return { ok: false, message: `${label} must be one line of text.` };
    }
    const text = typeof value === "string" ? value.replace(/^ +| +$/g, "") : "";
    const length = [...text].length;
    if (length < 1 || length > 120)
        return { ok: false, message: `${label} must be 1 to 120 characters.` };
    return { ok: true, text };
}
