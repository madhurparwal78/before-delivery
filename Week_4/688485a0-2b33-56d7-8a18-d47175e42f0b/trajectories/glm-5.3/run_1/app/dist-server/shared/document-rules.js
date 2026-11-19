import { isDateObject, compactJson, docByteSize, docDepth } from "./values.js";
/**
 * Document rules (DP-05): _id format, allowed values, field names, the size
 * limit and the depth limit, checked in the published order.
 */
const ID_RE = /^[0-9a-f]{24}$/;
/** First invalid field name in document order: a key starting with `$` (other than a date) or containing `.`. */
function firstBadField(v, prefix) {
    if (Array.isArray(v)) {
        for (const el of v) {
            const bad = firstBadField(el, prefix);
            if (bad)
                return bad;
        }
        return null;
    }
    if (typeof v !== "object" || v === null)
        return null;
    if (isDateObject(v))
        return null; // a date is a plain value
    for (const k of Object.keys(v)) {
        const path = prefix ? prefix + "." + k : k;
        if (k.startsWith("$") || k.includes("."))
            return path;
        const bad = firstBadField(v[k], path);
        if (bad)
            return bad;
    }
    return null;
}
/**
 * Check a document in the published order: _id, field names, size, depth.
 * `givenId` is the id the document must carry when present (PUT route).
 */
export function checkDocument(doc, limits, givenId) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
        return { ok: false, message: "not an object" };
    const obj = doc;
    // _id first
    if (Object.prototype.hasOwnProperty.call(obj, "_id")) {
        const id = obj["_id"];
        if (typeof id !== "string" || !ID_RE.test(id))
            return { ok: false, message: "invalid _id" };
        if (givenId !== undefined && id !== givenId)
            return { ok: false, message: "id mismatch", path: "_id" };
    }
    else if (givenId !== undefined) {
        return { ok: false, message: "invalid _id" };
    }
    // field names
    const badPath = firstBadField(obj, "");
    if (badPath)
        return { ok: false, message: "invalid field name at " + badPath, path: badPath };
    // size
    const size = docByteSize(obj);
    if (size > limits.maxDocBytes)
        return { ok: false, message: `document is larger than ${limits.maxDocBytes} bytes` };
    // depth
    if (docDepth(obj, 1) > limits.maxDepth)
        return { ok: false, message: `document is nested deeper than ${limits.maxDepth} levels` };
    const id = Object.prototype.hasOwnProperty.call(obj, "_id") ? obj["_id"] : "";
    return { ok: true, doc: obj, id };
}
/** A fresh 24-hex id. */
export function newId() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function isValidId(id) {
    return ID_RE.test(id);
}
export function documentCompactText(doc) {
    return compactJson(doc);
}
