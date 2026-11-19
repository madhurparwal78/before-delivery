import { isDateObject } from "../values.js";
/**
 * The single definition of path resolution (DP-03). `a.b` reaches into nested
 * objects, `items.0.sku` reaches an array position, and a path through an array
 * of objects reaches every element's field.
 */
export function splitPath(path) {
    return path.split(".");
}
/**
 * Values at a path, fanning out through arrays of objects. Numeric segments
 * address array positions and are not fanned. The array itself is yielded when
 * it is the final segment, so whole-array matching works.
 */
export function* pathFanout(v, parts) {
    if (parts.length === 0) {
        yield v;
        return;
    }
    const [head, ...rest] = parts;
    if (Array.isArray(v)) {
        if (/^\d+$/.test(head)) {
            const idx = Number(head);
            if (idx < v.length)
                yield* pathFanout(v[idx], rest);
            return;
        }
        for (const el of v)
            yield* pathFanout(el, parts);
        return;
    }
    if (typeof v !== "object" || v === null || isDateObject(v))
        return;
    if (!Object.prototype.hasOwnProperty.call(v, head))
        return;
    yield* pathFanout(v[head], rest);
}
/** The single value at a path for projection copies and group keys: no fan-out through arrays. */
export function getPathValue(v, parts) {
    if (parts.length === 0)
        return v;
    const [head, ...rest] = parts;
    if (Array.isArray(v)) {
        if (!/^\d+$/.test(head))
            return undefined;
        const idx = Number(head);
        if (idx >= v.length)
            return undefined;
        return getPathValue(v[idx], rest);
    }
    if (typeof v !== "object" || v === null || isDateObject(v))
        return undefined;
    if (!Object.prototype.hasOwnProperty.call(v, head))
        return undefined;
    return getPathValue(v[head], rest);
}
