import { splitPath, getPathValue } from "./paths.js";
export class ProjectionError extends Error {
}
export function parseProjection(raw, withCopies) {
    if (raw === null || raw === undefined)
        return { mode: "none", paths: [], dropId: false, copies: [] };
    if (typeof raw !== "object" || Array.isArray(raw))
        throw new ProjectionError("invalid_projection");
    const obj = raw;
    const include = [];
    const exclude = [];
    const copies = [];
    let dropId = false;
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === 1 || v === true) {
            if (k !== "_id")
                include.push(k);
        }
        else if (v === 0 || v === false) {
            if (k === "_id")
                dropId = true;
            else
                exclude.push(k);
        }
        else if (withCopies && typeof v === "string" && v.startsWith("$") && v.length > 1) {
            copies.push({ name: k, source: v.slice(1) });
        }
        else {
            throw new ProjectionError("invalid_projection");
        }
    }
    if (include.length > 0 && exclude.length > 0)
        throw new ProjectionError("invalid_projection");
    if (copies.length > 0 && exclude.length > 0)
        throw new ProjectionError("invalid_projection");
    if (include.length > 0 || copies.length > 0) {
        return { mode: "include", paths: include, dropId, copies };
    }
    if (exclude.length > 0)
        return { mode: "exclude", paths: exclude, dropId, copies: [] };
    // only {"_id":1} or {"_id":0}: the former keeps _id alone
    return { mode: "none", paths: [], dropId, copies: [] };
}
/** Keep a subtree by inclusion: paths through arrays of objects keep the field in each element. */
function includeSubtree(v, parts) {
    if (parts.length === 0)
        return { hit: true, value: v };
    if (Array.isArray(v)) {
        const out = [];
        let hit = false;
        for (const el of v) {
            const r = includeSubtree(el, parts);
            out.push(r.hit ? r.value : {});
            hit = hit || r.hit;
        }
        return { hit, value: out };
    }
    if (typeof v !== "object" || v === null)
        return { hit: false, value: null };
    const [head, ...rest] = parts;
    if (!Object.prototype.hasOwnProperty.call(v, head))
        return { hit: false, value: null };
    const r = includeSubtree(v[head], rest);
    if (!r.hit)
        return { hit: false, value: null };
    const out = {};
    out[head] = r.value;
    return { hit: true, value: out };
}
/** Prune a subtree by exclusion. */
function excludeSubtree(v, parts) {
    if (parts.length === 0)
        return null;
    if (Array.isArray(v))
        return v.map(el => excludeSubtree(el, parts));
    if (typeof v !== "object" || v === null)
        return v;
    const [head, ...rest] = parts;
    if (!Object.prototype.hasOwnProperty.call(v, head))
        return v;
    if (rest.length === 0) {
        const out = { ...v };
        delete out[head];
        return out;
    }
    const inner = excludeSubtree(v[head], rest);
    return { ...v, [head]: inner };
}
export function applyProjection(doc, spec) {
    if (spec.mode === "none")
        return spec.dropId ? withoutId(doc) : doc;
    if (spec.mode === "exclude") {
        let out = doc;
        for (const p of spec.paths)
            out = excludeSubtree(out, splitPath(p));
        return spec.dropId ? withoutId(out) : out;
    }
    // inclusion
    const out = {};
    if (!spec.dropId)
        out["_id"] = doc["_id"];
    for (const k of Object.keys(doc)) {
        const specPath = spec.paths.find(p => p === k || p.startsWith(k + "."));
        if (!specPath)
            continue;
        if (specPath === k) {
            out[k] = doc[k];
        }
        else {
            const r = includeSubtree(doc[k], splitPath(specPath).slice(1));
            if (r.hit)
                mergeInto(out, k, r.value);
        }
    }
    for (const copy of spec.copies) {
        const v = getPathValue(doc, splitPath(copy.source));
        if (v !== undefined)
            setDotted(out, splitPath(copy.name), v);
    }
    return out;
}
function withoutId(doc) {
    const out = {};
    for (const k of Object.keys(doc))
        if (k !== "_id")
            out[k] = doc[k];
    return out;
}
function mergeInto(target, key, fragment) {
    const existing = target[key];
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing) &&
        typeof fragment === "object" && fragment !== null && !Array.isArray(fragment)) {
        target[key] = deepMerge(existing, fragment);
    }
    else {
        target[key] = fragment;
    }
}
function deepMerge(a, b) {
    const out = { ...a };
    for (const k of Object.keys(b)) {
        const bv = b[k];
        const av = out[k];
        if (typeof av === "object" && av !== null && !Array.isArray(av) && typeof bv === "object" && bv !== null && !Array.isArray(bv)) {
            out[k] = deepMerge(av, bv);
        }
        else {
            out[k] = bv;
        }
    }
    return out;
}
function setDotted(target, parts, value) {
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        const next = cur[p];
        if (typeof next !== "object" || next === null || Array.isArray(next))
            cur[p] = {};
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}
