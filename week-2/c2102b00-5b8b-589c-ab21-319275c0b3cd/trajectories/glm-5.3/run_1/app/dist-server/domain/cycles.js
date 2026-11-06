"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CYCLE_FIELD_LABELS = void 0;
exports.checkCycleName = checkCycleName;
exports.parseCycleFields = parseCycleFields;
exports.resolveTimes = resolveTimes;
exports.crossFieldErrors = crossFieldErrors;
exports.validateProductIds = validateProductIds;
exports.draftValidation = draftValidation;
exports.createDraft = createDraft;
exports.patchCycle = patchCycle;
exports.openCycle = openCycle;
const db_1 = require("../db");
const errors_1 = require("../errors");
const club_1 = require("./club");
const time_1 = require("../time");
exports.CYCLE_FIELD_LABELS = {
    name: "Cycle name",
    cutoff_local: "Cutoff (club time)",
    pickup_start_local: "Pickup starts (club time)",
    pickup_end_local: "Pickup ends (club time)",
    product_ids: "Cases",
};
/** The single place that decides whether a cycle name is valid. */
function checkCycleName(name) {
    if (typeof name !== "string")
        return "Name the cycle in 1 to 60 characters on one line.";
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
        return "Name the cycle in 1 to 60 characters on one line.";
    }
    for (const ch of trimmed) {
        const cp = ch.codePointAt(0);
        if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
            return "Name the cycle in 1 to 60 characters on one line.";
        }
    }
    return null;
}
function parseCycleFields(body) {
    const out = {};
    const badType = (f) => errors_1.errors.validation({ [f]: "Use the published format." });
    if ("name" in body) {
        if (typeof body.name !== "string")
            throw badType("name");
        out.name = body.name;
    }
    for (const f of ["cutoff_local", "pickup_start_local", "pickup_end_local"]) {
        if (f in body) {
            if (typeof body[f] !== "string")
                throw badType(f);
            out[f] = body[f];
        }
    }
    if ("product_ids" in body) {
        const arr = body.product_ids;
        if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string"))
            throw badType("product_ids");
        out.product_ids = arr;
    }
    return out;
}
/** Validates given fields; times must exist in club time. */
function resolveTimes(fields, known) {
    const tz = (0, club_1.clubTimeZone)();
    const fieldErrors = {};
    const resolved = { ...known };
    if (fields.cutoff_local !== undefined) {
        const r = (0, time_1.localToInstant)(fields.cutoff_local, tz);
        if (r.kind === "gap")
            fieldErrors.cutoff_local = "That time doesn't exist in club time.";
        else if (r.kind === "bad")
            fieldErrors.cutoff_local = "Use YYYY-MM-DD HH:MM in club time.";
        else
            resolved.cutoffSec = Math.floor(r.instantMs / 1000);
    }
    if (fields.pickup_start_local !== undefined) {
        const r = (0, time_1.localToInstant)(fields.pickup_start_local, tz);
        if (r.kind === "gap")
            fieldErrors.pickup_start_local = "That time doesn't exist in club time.";
        else if (r.kind === "bad")
            fieldErrors.pickup_start_local = "Use YYYY-MM-DD HH:MM in club time.";
        else
            resolved.pickupStartSec = Math.floor(r.instantMs / 1000);
    }
    if (fields.pickup_end_local !== undefined) {
        const r = (0, time_1.localToInstant)(fields.pickup_end_local, tz);
        if (r.kind === "gap")
            fieldErrors.pickup_end_local = "That time doesn't exist in club time.";
        else if (r.kind === "bad")
            fieldErrors.pickup_end_local = "Use YYYY-MM-DD HH:MM in club time.";
        else
            resolved.pickupEndSec = Math.floor(r.instantMs / 1000);
    }
    return { resolved, fieldErrors };
}
/** Cross-field rules that only apply when both times are known. */
function crossFieldErrors(resolved) {
    const fieldErrors = {};
    if (resolved.pickupStartSec !== null && resolved.pickupEndSec !== null) {
        if (resolved.pickupEndSec <= resolved.pickupStartSec) {
            fieldErrors.pickup_end_local = "Pickup must end after it starts.";
        }
        else if (resolved.pickupEndSec - resolved.pickupStartSec > 12 * 3600) {
            fieldErrors.pickup_end_local = "Pickup can last at most 12 hours.";
        }
    }
    if (resolved.cutoffSec !== null && resolved.pickupStartSec !== null) {
        if (resolved.pickupStartSec <= resolved.cutoffSec) {
            fieldErrors.pickup_start_local = "Pickup must start after cutoff.";
        }
    }
    return fieldErrors;
}
function validateProductIds(ids) {
    if (ids === undefined)
        return {};
    const knownIds = new Set((0, club_1.catalogue)().map((p) => p.id));
    for (const id of ids) {
        if (!knownIds.has(id)) {
            return { product_ids: "Tick at least one case." };
        }
    }
    return {};
}
function draftValidation(fields, known) {
    const nameError = fields.name !== undefined ? checkCycleName(fields.name) : null;
    const { resolved, fieldErrors } = resolveTimes(fields, known);
    const cross = crossFieldErrors(resolved);
    const productError = validateProductIds(fields.product_ids);
    const all = {};
    if (nameError)
        all.name = nameError;
    for (const [k, v] of Object.entries({ ...fieldErrors, ...cross, ...productError })) {
        all[k] = v;
    }
    let products;
    if (fields.product_ids !== undefined && Object.keys(productError).length === 0) {
        products = fields.product_ids
            .map((id) => (0, club_1.catalogue)().find((p) => p.id === id))
            .filter((p) => p !== undefined);
    }
    return { resolved, fieldErrors: all, products };
}
function createDraft(fields, resolved, products) {
    const nowSec = Math.floor(Date.now() / 1000);
    const name = (fields.name ?? "Untitled cycle").trim();
    return (0, db_1.tx)(() => {
        const id = (0, club_1.nextCycleId)();
        const order = parseInt(id.replace("cy-", ""), 10);
        (0, db_1.run)("INSERT INTO cycles (id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at, created_at, sort_order) VALUES (?, ?, 'draft', 1, ?, ?, ?, ?, ?)", id, name.length > 0 ? name : "Untitled cycle", resolved.cutoffSec, resolved.pickupStartSec, resolved.pickupEndSec, nowSec, order);
        if (products !== undefined) {
            products.forEach((p, i) => {
                (0, db_1.run)("INSERT INTO cycle_products (cycle_id, product_id, sort_order) VALUES (?, ?, ?)", id, p.id, i + 1);
                (0, db_1.run)("INSERT INTO lines (cycle_id, product_id, version, status) VALUES (?, ?, 1, 'filling')", id, p.id);
            });
        }
        return (0, club_1.cycle)(id);
    });
}
function applyFields(cycleId, input, known) {
    if (input.name !== undefined) {
        (0, db_1.run)("UPDATE cycles SET name = ? WHERE id = ?", input.name.trim(), cycleId);
    }
    const cutoff = input.cutoffSec !== undefined ? input.cutoffSec : known.cutoff;
    const start = input.pickupStartSec !== undefined ? input.pickupStartSec : known.pickupStart;
    const end = input.pickupEndSec !== undefined ? input.pickupEndSec : known.pickupEnd;
    (0, db_1.run)("UPDATE cycles SET cutoff_at = ?, pickup_start_at = ?, pickup_end_at = ? WHERE id = ?", cutoff, start, end, cycleId);
    if (input.productIds !== null && input.productIds !== undefined) {
        const existing = (0, club_1.cycleProducts)(cycleId).map((p) => p.id);
        const toRemove = existing.filter((id) => !input.productIds.includes(id));
        const toAdd = input.productIds.filter((id) => !existing.includes(id));
        for (const id of toRemove) {
            (0, db_1.run)("DELETE FROM cycle_products WHERE cycle_id = ? AND product_id = ?", cycleId, id);
            (0, db_1.run)("DELETE FROM lines WHERE cycle_id = ? AND product_id = ?", cycleId, id);
        }
        let order = (0, db_1.all)("SELECT COALESCE(MAX(sort_order), 0) AS m FROM cycle_products WHERE cycle_id = ?", cycleId)[0]?.m ?? 0;
        for (const id of toAdd) {
            order += 1;
            (0, db_1.run)("INSERT INTO cycle_products (cycle_id, product_id, sort_order) VALUES (?, ?, ?)", cycleId, id, order);
            (0, db_1.run)("INSERT INTO lines (cycle_id, product_id, version, status) VALUES (?, ?, 1, 'filling')", cycleId, id);
        }
    }
}
/** Saves fields to a cycle under the edit rules, bumping the revision. */
function patchCycle(c, fields, nowSec) {
    const effStatus = c.status === "open" && c.cutoff_at !== null && nowSec >= c.cutoff_at ? "sealing" : c.status;
    const known = {
        cutoffSec: c.cutoff_at,
        pickupStartSec: c.pickup_start_at,
        pickupEndSec: c.pickup_end_at,
    };
    const { resolved, fieldErrors, products } = draftValidation(fields, known);
    const nowErrors = {};
    // State rules for which fields may be edited.
    if (effStatus !== "draft") {
        if (fields.name !== undefined || fields.product_ids !== undefined) {
            throw errors_1.errors.wrongCycleState();
        }
        if (fields.cutoff_local !== undefined) {
            if (c.status !== "open" || nowSec >= (c.cutoff_at ?? 0)) {
                throw errors_1.errors.wrongCycleState();
            }
            if (resolved.cutoffSec !== null && resolved.cutoffSec <= nowSec) {
                nowErrors.cutoff_local = "Cutoff must be in the future.";
            }
        }
        if (!["draft", "open", "sealing", "ordered", "received"].includes(effStatus)) {
            throw errors_1.errors.wrongCycleState();
        }
    }
    const allErrors = {};
    for (const [k, v] of Object.entries({ ...fieldErrors, ...nowErrors }))
        allErrors[k] = v;
    if (Object.keys(allErrors).length > 0)
        throw errors_1.errors.validation(allErrors);
    return (0, db_1.tx)(() => {
        const changed = (fields.name !== undefined && fields.name.trim() !== c.name) ||
            (fields.cutoff_local !== undefined && resolved.cutoffSec !== c.cutoff_at) ||
            (fields.pickup_start_local !== undefined && resolved.pickupStartSec !== c.pickup_start_at) ||
            (fields.pickup_end_local !== undefined && resolved.pickupEndSec !== c.pickup_end_at) ||
            (fields.product_ids !== undefined &&
                JSON.stringify(fields.product_ids) !== JSON.stringify((0, club_1.cycleProducts)(c.id).map((p) => p.id)));
        applyFields(c.id, {
            name: fields.name,
            cutoffSec: fields.cutoff_local !== undefined ? resolved.cutoffSec : undefined,
            pickupStartSec: fields.pickup_start_local !== undefined ? resolved.pickupStartSec : undefined,
            pickupEndSec: fields.pickup_end_local !== undefined ? resolved.pickupEndSec : undefined,
            productIds: fields.product_ids ?? null,
        }, {
            cutoff: c.cutoff_at,
            pickupStart: c.pickup_start_at,
            pickupEnd: c.pickup_end_at,
        });
        if (changed) {
            (0, db_1.run)("UPDATE cycles SET revision = revision + 1 WHERE id = ?", c.id);
        }
        return (0, club_1.cycle)(c.id);
    });
}
/** Opens a draft, applying any fields sent with the request. */
function openCycle(c, fields, nowSec) {
    if (c.status !== "draft")
        throw errors_1.errors.illegalTransition();
    const known = {
        cutoffSec: c.cutoff_at,
        pickupStartSec: c.pickup_start_at,
        pickupEndSec: c.pickup_end_at,
    };
    const { resolved, fieldErrors, products } = draftValidation(fields, known);
    const fieldErrorMap = { ...fieldErrors };
    const finalProducts = fields.product_ids !== undefined ? (products ?? []) : (0, club_1.cycleProducts)(c.id);
    if (finalProducts.length === 0) {
        fieldErrorMap.product_ids = "Tick at least one case.";
    }
    const missing = [];
    if (resolved.cutoffSec === null)
        missing.push("cutoff_local");
    if (resolved.pickupStartSec === null)
        missing.push("pickup_start_local");
    if (resolved.pickupEndSec === null)
        missing.push("pickup_end_local");
    for (const f of missing) {
        fieldErrorMap[f] = "Use YYYY-MM-DD HH:MM in club time.";
    }
    if (resolved.cutoffSec !== null && resolved.cutoffSec <= nowSec) {
        fieldErrorMap.cutoff_local = "Cutoff must be in the future.";
    }
    if (Object.keys(fieldErrorMap).length > 0)
        throw errors_1.errors.validation(fieldErrorMap);
    return (0, db_1.tx)(() => {
        applyFields(c.id, {
            name: fields.name,
            cutoffSec: fields.cutoff_local !== undefined ? resolved.cutoffSec : undefined,
            pickupStartSec: fields.pickup_start_local !== undefined ? resolved.pickupStartSec : undefined,
            pickupEndSec: fields.pickup_end_local !== undefined ? resolved.pickupEndSec : undefined,
            productIds: fields.product_ids ?? null,
        }, {
            cutoff: c.cutoff_at,
            pickupStart: c.pickup_start_at,
            pickupEnd: c.pickup_end_at,
        });
        (0, db_1.run)("UPDATE cycles SET status = 'open', revision = revision + 1 WHERE id = ?", c.id);
        return (0, club_1.cycle)(c.id);
    });
}
