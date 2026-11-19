import { compareValues } from "../values.js";
import { splitPath, pathFanout } from "./paths.js";
/**
 * Sorting (DP-09, DP-10): the single comparison order, arrays by smallest or
 * largest element, and ties broken by `_id` ascending.
 */
export function sortValue(doc, key) {
    const parts = splitPath(key.path);
    // Map each value at the path to its sort proxy: an array becomes its smallest
    // (ascending) or largest (descending) element, an empty array becomes null.
    const proxies = [];
    for (const v of pathFanout(doc, parts)) {
        if (!Array.isArray(v)) {
            proxies.push(v);
            continue;
        }
        if (v.length === 0) {
            proxies.push(null);
            continue;
        }
        let best = v[0];
        for (const el of v) {
            const cmp = compareValues(el, best);
            if (key.dir === 1 ? cmp < 0 : cmp > 0)
                best = el;
        }
        proxies.push(best);
    }
    if (proxies.length === 0)
        return null; // missing sorts as null
    let best = proxies[0];
    for (const v of proxies) {
        const cmp = compareValues(v, best);
        if (key.dir === 1 ? cmp < 0 : cmp > 0)
            best = v;
    }
    return best;
}
function compareIds(a, b) {
    const idA = String(a["_id"] ?? "");
    const idB = String(b["_id"] ?? "");
    return idA < idB ? -1 : idA > idB ? 1 : 0;
}
export function compareBySortKeys(a, b, keys) {
    for (const key of keys) {
        const cmp = compareValues(sortValue(a, key), sortValue(b, key));
        if (cmp !== 0)
            return cmp * key.dir;
    }
    return compareIds(a, b);
}
export function sortDocs(docs, keys) {
    const copy = [...docs];
    copy.sort(keys.length === 0 ? compareIds : (a, b) => compareBySortKeys(a, b, keys));
    return copy;
}
