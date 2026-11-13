// Text length counting, display names and download file names. Counted in Unicode code
// points, inclusive at the limit, exactly as submitted.
import { TEXT_LIMITS } from '../shared/terms.js';
export function countCodePoints(text) {
    let count = 0;
    for (const _ of text)
        count++;
    return count;
}
export function lengthInRange(text, min, max) {
    const n = countCodePoints(text);
    return n >= min && n <= max;
}
export function isBlank(text) {
    return text.trim().length === 0;
}
/** The material display name: directory part removed, control characters removed, cut to
 * the first 120 code points, with `file` when nothing is left. No Unicode normalisation. */
export function displayName(submittedName) {
    let name = submittedName;
    const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    if (lastSlash !== -1)
        name = name.slice(lastSlash + 1);
    let cleaned = '';
    for (const ch of name) {
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 0x001f || code === 0x007f)
            continue;
        cleaned += ch;
    }
    let cut = '';
    let count = 0;
    for (const ch of cleaned) {
        if (count >= TEXT_LIMITS.material_name)
            break;
        cut += ch;
        count++;
    }
    return cut.length === 0 ? 'file' : cut;
}
const RFC5987_SAFE = new Set('!#$&+-.^_`|~'.split(''));
/** ASCII fallback for Content-Disposition: printable ASCII only, `"` and `\` become `_`. */
export function downloadFallbackName(name) {
    let out = '';
    for (const ch of name) {
        const code = ch.codePointAt(0) ?? 0;
        if (code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== '\\') {
            out += ch;
        }
        else {
            out += '_';
        }
    }
    return out;
}
/** RFC 5987 encoding of the UTF-8 bytes: letters, digits and the safe set stay, every other
 * byte becomes %XX with uppercase hexadecimal digits. */
export function downloadEncodedName(name) {
    const bytes = Buffer.from(name, 'utf8');
    let out = '';
    for (const byte of bytes) {
        const ch = String.fromCharCode(byte);
        if ((byte >= 0x41 && byte <= 0x5a) || // A-Z
            (byte >= 0x61 && byte <= 0x7a) || // a-z
            (byte >= 0x30 && byte <= 0x39) || // 0-9
            RFC5987_SAFE.has(ch)) {
            out += ch;
        }
        else {
            out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
        }
    }
    return out;
}
