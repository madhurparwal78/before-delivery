import { all, one, run, tx, CycleRow, ProductRow } from "../db";
import { ApiError, errors, FieldErrors } from "../errors";
import { catalogue, clubTimeZone, cycle, cycleProducts, nextCycleId } from "./club";
import { localToInstant } from "../time";

export const CYCLE_FIELD_LABELS = {
  name: "Cycle name",
  cutoff_local: "Cutoff (club time)",
  pickup_start_local: "Pickup starts (club time)",
  pickup_end_local: "Pickup ends (club time)",
  product_ids: "Cases",
} as const;

/** The single place that decides whether a cycle name is valid. */
export function checkCycleName(name: unknown): string | null {
  if (typeof name !== "string") return "Name the cycle in 1 to 60 characters on one line.";
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    return "Name the cycle in 1 to 60 characters on one line.";
  }
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) {
      return "Name the cycle in 1 to 60 characters on one line.";
    }
  }
  return null;
}

export interface CycleFields {
  name?: string;
  cutoff_local?: string;
  pickup_start_local?: string;
  pickup_end_local?: string;
  product_ids?: string[];
}

export function parseCycleFields(body: Record<string, unknown>): CycleFields {
  const out: CycleFields = {};
  const badType = (f: string) => errors.validation({ [f]: "Use the published format." });
  if ("name" in body) {
    if (typeof body.name !== "string") throw badType("name");
    out.name = body.name;
  }
  for (const f of ["cutoff_local", "pickup_start_local", "pickup_end_local"] as const) {
    if (f in body) {
      if (typeof body[f] !== "string") throw badType(f);
      out[f] = body[f];
    }
  }
  if ("product_ids" in body) {
    const arr = body.product_ids;
    if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) throw badType("product_ids");
    out.product_ids = arr as string[];
  }
  return out;
}

export interface ResolvedTimes {
  cutoffSec: number | null;
  pickupStartSec: number | null;
  pickupEndSec: number | null;
}

/** Validates given fields; times must exist in club time. */
export function resolveTimes(fields: CycleFields, known: ResolvedTimes): {
  resolved: ResolvedTimes;
  fieldErrors: FieldErrors;
} {
  const tz = clubTimeZone();
  const fieldErrors: FieldErrors = {};
  const resolved: ResolvedTimes = { ...known };
  if (fields.cutoff_local !== undefined) {
    const r = localToInstant(fields.cutoff_local, tz);
    if (r.kind === "gap") fieldErrors.cutoff_local = "That time doesn't exist in club time.";
    else if (r.kind === "bad") fieldErrors.cutoff_local = "Use YYYY-MM-DD HH:MM in club time.";
    else resolved.cutoffSec = Math.floor(r.instantMs / 1000);
  }
  if (fields.pickup_start_local !== undefined) {
    const r = localToInstant(fields.pickup_start_local, tz);
    if (r.kind === "gap") fieldErrors.pickup_start_local = "That time doesn't exist in club time.";
    else if (r.kind === "bad") fieldErrors.pickup_start_local = "Use YYYY-MM-DD HH:MM in club time.";
    else resolved.pickupStartSec = Math.floor(r.instantMs / 1000);
  }
  if (fields.pickup_end_local !== undefined) {
    const r = localToInstant(fields.pickup_end_local, tz);
    if (r.kind === "gap") fieldErrors.pickup_end_local = "That time doesn't exist in club time.";
    else if (r.kind === "bad") fieldErrors.pickup_end_local = "Use YYYY-MM-DD HH:MM in club time.";
    else resolved.pickupEndSec = Math.floor(r.instantMs / 1000);
  }
  return { resolved, fieldErrors };
}

/** Cross-field rules that only apply when both times are known. */
export function crossFieldErrors(resolved: ResolvedTimes): FieldErrors {
  const fieldErrors: FieldErrors = {};
  if (resolved.pickupStartSec !== null && resolved.pickupEndSec !== null) {
    if (resolved.pickupEndSec <= resolved.pickupStartSec) {
      fieldErrors.pickup_end_local = "Pickup must end after it starts.";
    } else if (resolved.pickupEndSec - resolved.pickupStartSec > 12 * 3600) {
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

export function validateProductIds(ids: string[] | undefined): FieldErrors {
  if (ids === undefined) return {};
  const knownIds = new Set(catalogue().map((p) => p.id));
  for (const id of ids) {
    if (!knownIds.has(id)) {
      return { product_ids: "Tick at least one case." };
    }
  }
  return {};
}

export function draftValidation(fields: CycleFields, known: ResolvedTimes): {
  resolved: ResolvedTimes;
  fieldErrors: FieldErrors;
  products?: ProductRow[];
} {
  const nameError = fields.name !== undefined ? checkCycleName(fields.name) : null;
  const { resolved, fieldErrors } = resolveTimes(fields, known);
  const cross = crossFieldErrors(resolved);
  const productError = validateProductIds(fields.product_ids);
  const all: FieldErrors = {};
  if (nameError) all.name = nameError;
  for (const [k, v] of Object.entries({ ...fieldErrors, ...cross, ...productError })) {
    all[k] = v;
  }
  let products: ProductRow[] | undefined;
  if (fields.product_ids !== undefined && Object.keys(productError).length === 0) {
    products = fields.product_ids
      .map((id) => catalogue().find((p) => p.id === id))
      .filter((p): p is ProductRow => p !== undefined);
  }
  return { resolved, fieldErrors: all, products };
}

export interface CycleInput {
  name?: string;
  cutoffSec?: number | null;
  pickupStartSec?: number | null;
  pickupEndSec?: number | null;
  productIds?: string[] | null;
}

export function createDraft(fields: CycleFields, resolved: ResolvedTimes, products: ProductRow[] | undefined): CycleRow {
  const nowSec = Math.floor(Date.now() / 1000);
  const name = (fields.name ?? "Untitled cycle").trim();
  return tx(() => {
    const id = nextCycleId();
    const order = parseInt(id.replace("cy-", ""), 10);
    run(
      "INSERT INTO cycles (id, name, status, revision, cutoff_at, pickup_start_at, pickup_end_at, created_at, sort_order) VALUES (?, ?, 'draft', 1, ?, ?, ?, ?, ?)",
      id, name.length > 0 ? name : "Untitled cycle", resolved.cutoffSec, resolved.pickupStartSec, resolved.pickupEndSec, nowSec, order
    );
    if (products !== undefined) {
      products.forEach((p, i) => {
        run("INSERT INTO cycle_products (cycle_id, product_id, sort_order) VALUES (?, ?, ?)", id, p.id, i + 1);
        run("INSERT INTO lines (cycle_id, product_id, version, status) VALUES (?, ?, 1, 'filling')", id, p.id);
      });
    }
    return cycle(id)!;
  });
}

function applyFields(
  cycleId: string,
  input: CycleInput,
  known: { cutoff: number | null; pickupStart: number | null; pickupEnd: number | null }
): void {
  if (input.name !== undefined) {
    run("UPDATE cycles SET name = ? WHERE id = ?", input.name.trim(), cycleId);
  }
  const cutoff = input.cutoffSec !== undefined ? input.cutoffSec : known.cutoff;
  const start = input.pickupStartSec !== undefined ? input.pickupStartSec : known.pickupStart;
  const end = input.pickupEndSec !== undefined ? input.pickupEndSec : known.pickupEnd;
  run(
    "UPDATE cycles SET cutoff_at = ?, pickup_start_at = ?, pickup_end_at = ? WHERE id = ?",
    cutoff, start, end, cycleId
  );
  if (input.productIds !== null && input.productIds !== undefined) {
    const existing = cycleProducts(cycleId).map((p) => p.id);
    const toRemove = existing.filter((id) => !input.productIds!.includes(id));
    const toAdd = input.productIds!.filter((id) => !existing.includes(id));
    for (const id of toRemove) {
      run("DELETE FROM cycle_products WHERE cycle_id = ? AND product_id = ?", cycleId, id);
      run("DELETE FROM lines WHERE cycle_id = ? AND product_id = ?", cycleId, id);
    }
    let order = all<{ m: number }>("SELECT COALESCE(MAX(sort_order), 0) AS m FROM cycle_products WHERE cycle_id = ?", cycleId)[0]?.m ?? 0;
    for (const id of toAdd) {
      order += 1;
      run("INSERT INTO cycle_products (cycle_id, product_id, sort_order) VALUES (?, ?, ?)", cycleId, id, order);
      run("INSERT INTO lines (cycle_id, product_id, version, status) VALUES (?, ?, 1, 'filling')", cycleId, id);
    }
  }
}

export interface PatchResult {
  cycle: CycleRow;
}

/** Saves fields to a cycle under the edit rules, bumping the revision. */
export function patchCycle(c: CycleRow, fields: CycleFields, nowSec: number): CycleRow {
  const effStatus = c.status === "open" && c.cutoff_at !== null && nowSec >= c.cutoff_at ? "sealing" : c.status;
  const known: ResolvedTimes = {
    cutoffSec: c.cutoff_at,
    pickupStartSec: c.pickup_start_at,
    pickupEndSec: c.pickup_end_at,
  };
  const { resolved, fieldErrors, products } = draftValidation(fields, known);
  const nowErrors: FieldErrors = {};

  // State rules for which fields may be edited.
  if (effStatus !== "draft") {
    if (fields.name !== undefined || fields.product_ids !== undefined) {
      throw errors.wrongCycleState();
    }
    if (fields.cutoff_local !== undefined) {
      if (c.status !== "open" || nowSec >= (c.cutoff_at ?? 0)) {
        throw errors.wrongCycleState();
      }
      if (resolved.cutoffSec !== null && resolved.cutoffSec <= nowSec) {
        nowErrors.cutoff_local = "Cutoff must be in the future.";
      }
    }
    if (!["draft", "open", "sealing", "ordered", "received"].includes(effStatus)) {
      throw errors.wrongCycleState();
    }
  }

  const allErrors: FieldErrors = {};
  for (const [k, v] of Object.entries({ ...fieldErrors, ...nowErrors })) allErrors[k] = v;
  if (Object.keys(allErrors).length > 0) throw errors.validation(allErrors);

  return tx(() => {
    const changed =
      (fields.name !== undefined && fields.name.trim() !== c.name) ||
      (fields.cutoff_local !== undefined && resolved.cutoffSec !== c.cutoff_at) ||
      (fields.pickup_start_local !== undefined && resolved.pickupStartSec !== c.pickup_start_at) ||
      (fields.pickup_end_local !== undefined && resolved.pickupEndSec !== c.pickup_end_at) ||
      (fields.product_ids !== undefined &&
        JSON.stringify(fields.product_ids) !== JSON.stringify(cycleProducts(c.id).map((p) => p.id)));
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
      run("UPDATE cycles SET revision = revision + 1 WHERE id = ?", c.id);
    }
    return cycle(c.id)!;
  });
}

export interface OpenResult {
  cycle: CycleRow;
}

/** Opens a draft, applying any fields sent with the request. */
export function openCycle(c: CycleRow, fields: CycleFields, nowSec: number): CycleRow {
  if (c.status !== "draft") throw errors.illegalTransition();
  const known: ResolvedTimes = {
    cutoffSec: c.cutoff_at,
    pickupStartSec: c.pickup_start_at,
    pickupEndSec: c.pickup_end_at,
  };
  const { resolved, fieldErrors, products } = draftValidation(fields, known);
  const fieldErrorMap: FieldErrors = { ...fieldErrors };
  const finalProducts = fields.product_ids !== undefined ? (products ?? []) : cycleProducts(c.id);
  if (finalProducts.length === 0) {
    fieldErrorMap.product_ids = "Tick at least one case.";
  }
  const missing: string[] = [];
  if (resolved.cutoffSec === null) missing.push("cutoff_local");
  if (resolved.pickupStartSec === null) missing.push("pickup_start_local");
  if (resolved.pickupEndSec === null) missing.push("pickup_end_local");
  for (const f of missing) {
    fieldErrorMap[f] = "Use YYYY-MM-DD HH:MM in club time.";
  }
  if (resolved.cutoffSec !== null && resolved.cutoffSec <= nowSec) {
    fieldErrorMap.cutoff_local = "Cutoff must be in the future.";
  }
  if (Object.keys(fieldErrorMap).length > 0) throw errors.validation(fieldErrorMap);

  return tx(() => {
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
    run("UPDATE cycles SET status = 'open', revision = revision + 1 WHERE id = ?", c.id);
    return cycle(c.id)!;
  });
}
