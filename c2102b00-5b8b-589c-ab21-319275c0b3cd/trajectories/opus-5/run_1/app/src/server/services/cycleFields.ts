import { db } from '../db.ts';
import { ApiError, conflict, validation } from '../http/errors.ts';
import { cycleNameIsValid, normalizeCycleName } from '../domain/cycleName.ts';
import { instantFromLocalText, toIsoSeconds } from '../domain/clubTime.ts';
import { pickupLengthAllowed } from '../domain/pickupWindow.ts';
import { effectiveStatus } from '../domain/cycleState.ts';
import { getProduct, timeZone, type CycleRow } from '../store.ts';

export const FIELD_COPY = {
  name: 'Name the cycle in 1 to 60 characters on one line.',
  gap: "That time doesn't exist in club time.",
  format: 'Use YYYY-MM-DD HH:MM in club time.',
  pastCutoff: 'Cutoff must be in the future.',
  pickupAfterCutoff: 'Pickup must start after cutoff.',
  pickupEndAfterStart: 'Pickup must end after it starts.',
  pickupTooLong: 'Pickup can last at most 12 hours.',
  noCases: 'Tick at least one case.',
  unknownCase: 'That case is not on the distributor list.',
} as const;

export interface ResolvedFields {
  name?: string;
  cutoffAt?: string;
  pickupStartAt?: string;
  pickupEndAt?: string;
  productIds?: string[];
}

type Mode = 'create' | 'patch' | 'open';

interface TimeOutcome {
  given: boolean;
  failed: boolean;
  instantMs: number | null;
  iso: string | null;
}

function readTime(
  body: Record<string, unknown>,
  field: string,
  fields: Record<string, string>,
  zone: string,
  storedIso: string | null,
): TimeOutcome {
  if (!(field in body) || body[field] === null) {
    const instantMs = storedIso === null ? null : Date.parse(storedIso);
    return { given: false, failed: false, instantMs, iso: storedIso };
  }
  const raw = body[field];
  if (typeof raw !== 'string') {
    fields[field] = FIELD_COPY.format;
    return { given: true, failed: true, instantMs: null, iso: null };
  }
  const outcome = instantFromLocalText(raw, zone);
  if (outcome === 'invalid') {
    fields[field] = FIELD_COPY.format;
    return { given: true, failed: true, instantMs: null, iso: null };
  }
  if (outcome === null) {
    fields[field] = FIELD_COPY.gap;
    return { given: true, failed: true, instantMs: null, iso: null };
  }
  return { given: true, failed: false, instantMs: outcome.getTime(), iso: toIsoSeconds(outcome) };
}

/** Checks every cycle field in one pass and reports every failure together. */
export function resolveCycleFields(
  body: Record<string, unknown>,
  cycle: CycleRow | null,
  mode: Mode,
  nowMs: number,
): ResolvedFields {
  const zone = timeZone();
  const fields: Record<string, string> = {};
  const resolved: ResolvedFields = {};

  if ('name' in body || mode === 'create') {
    const raw = body.name;
    if (typeof raw !== 'string') {
      fields.name = FIELD_COPY.name;
    } else {
      const name = normalizeCycleName(raw);
      if (!cycleNameIsValid(name)) fields.name = FIELD_COPY.name;
      else resolved.name = name;
    }
  }

  const cutoff = readTime(body, 'cutoff_local', fields, zone, cycle?.cutoff_at ?? null);
  const pickupStart = readTime(body, 'pickup_start_local', fields, zone, cycle?.pickup_start_at ?? null);
  const pickupEnd = readTime(body, 'pickup_end_local', fields, zone, cycle?.pickup_end_at ?? null);
  if (cutoff.given && !cutoff.failed && cutoff.iso !== null) resolved.cutoffAt = cutoff.iso;
  if (pickupStart.given && !pickupStart.failed && pickupStart.iso !== null) resolved.pickupStartAt = pickupStart.iso;
  if (pickupEnd.given && !pickupEnd.failed && pickupEnd.iso !== null) resolved.pickupEndAt = pickupEnd.iso;

  let productIds: string[] | null = cycle
    ? (
        db
          .prepare('SELECT product_id FROM cycle_lines WHERE cycle_id = ? ORDER BY position')
          .all(cycle.id) as { product_id: string }[]
      ).map((row) => row.product_id)
    : [];
  if ('product_ids' in body && body.product_ids !== null) {
    const raw = body.product_ids;
    if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string')) {
      fields.product_ids = FIELD_COPY.unknownCase;
      productIds = null;
    } else {
      const ids = raw as string[];
      if (ids.some((id) => getProduct(id) === undefined)) {
        fields.product_ids = FIELD_COPY.unknownCase;
        productIds = null;
      } else {
        productIds = [...new Set(ids)];
        resolved.productIds = productIds;
      }
    }
  }

  if (mode === 'open') {
    if (productIds !== null && productIds.length === 0) fields.product_ids = FIELD_COPY.noCases;
    if (!cutoff.failed && cutoff.instantMs === null) fields.cutoff_local = FIELD_COPY.format;
    if (!pickupStart.failed && pickupStart.instantMs === null) fields.pickup_start_local = FIELD_COPY.format;
    if (!pickupEnd.failed && pickupEnd.instantMs === null) fields.pickup_end_local = FIELD_COPY.format;
    if (!cutoff.failed && cutoff.instantMs !== null && cutoff.instantMs <= nowMs) {
      fields.cutoff_local = FIELD_COPY.pastCutoff;
    }
  }

  if (mode === 'patch' && cutoff.given && !cutoff.failed && cutoff.instantMs !== null && cutoff.instantMs <= nowMs) {
    fields.cutoff_local = FIELD_COPY.pastCutoff;
  }

  if (
    !pickupStart.failed &&
    !pickupEnd.failed &&
    pickupStart.instantMs !== null &&
    pickupEnd.instantMs !== null
  ) {
    if (pickupEnd.instantMs <= pickupStart.instantMs) {
      fields.pickup_end_local = FIELD_COPY.pickupEndAfterStart;
    } else if (!pickupLengthAllowed(pickupStart.instantMs, pickupEnd.instantMs)) {
      fields.pickup_end_local = FIELD_COPY.pickupTooLong;
    }
  }
  if (
    !cutoff.failed &&
    !pickupStart.failed &&
    cutoff.instantMs !== null &&
    pickupStart.instantMs !== null &&
    pickupStart.instantMs <= cutoff.instantMs
  ) {
    fields.pickup_start_local = FIELD_COPY.pickupAfterCutoff;
  }

  if (Object.keys(fields).length > 0) throw validation(fields);
  return resolved;
}

/** Which fields each status allows: the one place an edit is judged against state. */
export function assertEditable(cycle: CycleRow, body: Record<string, unknown>, nowMs: number): void {
  const status = effectiveStatus(cycle.status, cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at), nowMs);
  if (status === 'draft') return;
  const wrongState = (): ApiError => conflict('wrong_cycle_state', 'That cannot be edited now.');
  if ('name' in body || 'product_ids' in body) throw wrongState();
  if ('cutoff_local' in body && status !== 'open') throw wrongState();
  const wantsPickup = 'pickup_start_local' in body || 'pickup_end_local' in body;
  if (wantsPickup && !['open', 'sealing', 'ordered', 'received'].includes(status)) throw wrongState();
}

export function applyFields(cycleId: string, resolved: ResolvedFields): void {
  if (resolved.name !== undefined) {
    db.prepare('UPDATE cycles SET name = ? WHERE id = ?').run(resolved.name, cycleId);
  }
  if (resolved.cutoffAt !== undefined) {
    db.prepare('UPDATE cycles SET cutoff_at = ? WHERE id = ?').run(resolved.cutoffAt, cycleId);
  }
  if (resolved.pickupStartAt !== undefined) {
    db.prepare('UPDATE cycles SET pickup_start_at = ? WHERE id = ?').run(resolved.pickupStartAt, cycleId);
  }
  if (resolved.pickupEndAt !== undefined) {
    db.prepare('UPDATE cycles SET pickup_end_at = ? WHERE id = ?').run(resolved.pickupEndAt, cycleId);
  }
  if (resolved.productIds === undefined) return;
  const existing = db
    .prepare('SELECT product_id FROM cycle_lines WHERE cycle_id = ?')
    .all(cycleId) as { product_id: string }[];
  const keep = new Set(resolved.productIds);
  for (const line of existing) {
    if (keep.has(line.product_id)) continue;
    db.prepare('DELETE FROM cycle_lines WHERE cycle_id = ? AND product_id = ?').run(cycleId, line.product_id);
    db.prepare('DELETE FROM pledges WHERE cycle_id = ? AND product_id = ?').run(cycleId, line.product_id);
  }
  const known = new Set(existing.map((line) => line.product_id));
  resolved.productIds.forEach((productId, index) => {
    if (known.has(productId)) {
      db.prepare('UPDATE cycle_lines SET position = ? WHERE cycle_id = ? AND product_id = ?').run(
        index + 1,
        cycleId,
        productId,
      );
    } else {
      db.prepare(
        "INSERT INTO cycle_lines (cycle_id, product_id, position, version, status) VALUES (?, ?, ?, 1, 'filling')",
      ).run(cycleId, productId, index + 1);
    }
  });
}
