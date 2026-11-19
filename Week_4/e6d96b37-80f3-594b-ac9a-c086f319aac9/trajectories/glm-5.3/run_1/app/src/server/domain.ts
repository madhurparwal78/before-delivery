import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { TRAY_CELLS, TRAY_CELL_MM, userPerceivedLength } from "../shared/util.js";
import type { DeskEvent, EventType } from "../shared/types.js";
import { pool, withTransaction } from "./db.js";
import { now as clockNow } from "./clock.js";

/** The single published error shape. */
export interface ApiFailure {
  status: number;
  body: { error: string; message: string; fields?: Record<string, string>; retry_after_seconds?: number };
}

export class DomainError extends Error {
  constructor(public failure: ApiFailure) {
    super(failure.body.message);
  }
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number): DomainError {
  const body: ApiFailure["body"] = { error: code, message };
  if (fields) body.fields = fields;
  if (retryAfter !== undefined) body.retry_after_seconds = retryAfter;
  return new DomainError({ status, body });
}

export const errors = {
  session: () => fail(401, "authentication_required", copyFor("F_SESSION")),
  hidden: () => fail(404, "not_found", copyFor("F_HIDDEN")),
  forbidden: () => fail(403, "forbidden", copyFor("F_FORBIDDEN")),
  stepUp: () => fail(403, "step_up_required", copyFor("F_MFA_REQUIRED")),
  conflict: (message: string) => fail(409, "conflict", message),
  stale: () => fail(409, "conflict", copyFor("F_CONFLICT")),
  invalid: (fields: Record<string, string>) => fail(422, "invalid", copyFor("F_INVALID"), fields),
  service: () => fail(503, "service_unavailable", copyFor("F_SERVICE")),
  reused: () => fail(409, "conflict", copyFor("F_COMMAND_REUSED")),
};

export interface CommandMeta {
  commandId: string;
  actor: "dealer" | "counterpart" | "system";
  expectedVersion?: number;
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** Every confirmed change runs inside one transaction with this helper. */
export async function runCommand<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(fn);
}

export async function nextEvent(tx: Tx, ns: string, commandId: string, actor: CommandMeta["actor"], type: EventType): Promise<DeskEvent> {
  const at = await clockNow(ns);
  const res = await tx.query<{ sequence: string }>(
    "INSERT INTO events (ns, command_id, actor, type, at, payload) VALUES ($1, $2, $3, $4, $5, $6) RETURNING sequence",
    [ns, commandId, actor, type, at, JSON.stringify({})],
  );
  const sequence = Number(res.rows[0].sequence);
  return { command_id: commandId, actor, type, sequence, at: at.toISOString() };
}

export async function specimenExists(tx: Tx, ns: string, key: string): Promise<boolean> {
  const res = await tx.query("SELECT 1 FROM specimens WHERE ns = $1 AND key = $2", [ns, key]);
  return res.rowCount === 1;
}

export async function loadSpecimen(tx: Tx, ns: string, key: string): Promise<SpecimenRow> {
  const res = await tx.query<SpecimenRow>("SELECT * FROM specimens WHERE ns = $1 AND key = $2", [ns, key]);
  const row = res.rows[0];
  if (!row) throw errors.hidden();
  return row;
}

export interface SpecimenRow {
  ns: string;
  key: string;
  display_label: string;
  owner: string;
  status: string;
  version: number;
  holder_kind: string;
  holder_width_mm: number;
  holder_height_mm: number;
  attribution_reference: string;
  attribution_mintmark: string;
  attribution_revision: number;
  certainty: string;
  note: string;
  correction: string;
  register_state: string;
  quarantined: boolean;
  missing: boolean;
}

/** Eligibility for an album hole or an offer, decided in exactly one place. */
export function eligibleForExchange(specimen: SpecimenRow, registerStored: boolean, reserved: boolean, held: boolean): boolean {
  if (specimen.missing) return false;
  if (specimen.quarantined) return false;
  if (specimen.status === "outbound" || specimen.status === "transferred") return false;
  if (specimen.status === "reserved") return false;
  if (reserved || held) return false;
  return registerStored && specimen.certainty === "certain";
}

export function assertTrayVersion(tx: Tx, ns: string, expected: number): Promise<void> {
  return (async () => {
    const res = await tx.query<{ version: number }>("SELECT version FROM tray_meta WHERE ns = $1", [ns]);
    const current = res.rows[0]?.version ?? 1;
    if (current !== expected) throw errors.stale();
  })();
}

export function holderFits(width: number, height: number): boolean {
  return width <= TRAY_CELL_MM && height <= TRAY_CELL_MM;
}

export function cellExists(cell: string): boolean {
  return (TRAY_CELLS as readonly string[]).includes(cell);
}

export function noteTooLong(text: string, max: number): boolean {
  return userPerceivedLength(text) > max;
}

export async function trayVersion(tx: Tx, ns: string): Promise<number> {
  const res = await tx.query<{ version: number }>("SELECT version FROM tray_meta WHERE ns = $1", [ns]);
  return res.rows[0]?.version ?? 1;
}

export async function albumVersion(tx: Tx, ns: string): Promise<number> {
  const res = await tx.query<{ version: number }>("SELECT version FROM albums WHERE ns = $1", [ns]);
  return res.rows[0]?.version ?? 1;
}

export async function keeperVersion(tx: Tx, ns: string): Promise<number> {
  const res = await tx.query<{ version: number }>("SELECT version FROM keeper_orders WHERE ns = $1", [ns]);
  return res.rows[0]?.version ?? 1;
}

/** Replay guard: identical payload returns the stored reply; different payload is refused. */
export async function replayLookup(
  tx: Tx,
  ns: string,
  commandId: string,
  payload: unknown,
): Promise<{ status: number; body: unknown } | null> {
  const res = await tx.query<{ status: number; body: unknown; payload: unknown }>(
    "SELECT status, body, payload FROM commands WHERE ns = $1 AND command_id = $2",
    [ns, commandId],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (JSON.stringify(row.payload) !== JSON.stringify(payload)) throw errors.reused();
  return { status: row.status, body: row.body };
}

export async function replayStore(tx: Tx, ns: string, commandId: string, payload: unknown, status: number, body: unknown): Promise<void> {
  await tx.query(
    "INSERT INTO commands (ns, command_id, status, body, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (ns, command_id) DO NOTHING",
    [ns, commandId, status, JSON.stringify(body), JSON.stringify(payload)],
  );
}

/** Provider errors are never stored for replay: the same command id runs again. */
export async function replayLookupTransient(
  tx: Tx,
  ns: string,
  commandId: string,
  payload: unknown,
): Promise<{ status: number; body: unknown } | null> {
  return replayLookup(tx, ns, commandId, payload);
}

export function offerIsOpen(offer: OfferRow): boolean {
  return offer.status === "sent" || offer.status === "countered" || offer.status === "accepted";
}

export interface OfferRow {
  ns: string;
  key: string;
  version: number;
  status: string;
  dealer_items: string[];
  counterpart_items: string[];
  dealer_acceptance_version: number | null;
  counterpart_acceptance_version: number | null;
  expires_at: Date | null;
}

export async function loadOffer(tx: Tx, ns: string, key: string): Promise<OfferRow> {
  const res = await tx.query<OfferRow>("SELECT * FROM offers WHERE ns = $1 AND key = $2", [ns, key]);
  const row = res.rows[0];
  if (!row) throw errors.hidden();
  return row;
}

export async function ensureNamespace(ns: string): Promise<void> {
  await pool.query("INSERT INTO namespaces (namespace) VALUES ($1) ON CONFLICT DO NOTHING", [ns]);
}

export async function namespaceExists(ns: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM namespaces WHERE namespace = $1", [ns]);
  return res.rowCount === 1;
}

export function offerWindowStatus(offer: OfferRow, clock: Date, env: FlanEnv): { expired: boolean; remaining: number | null; closing: boolean } {
  if (offer.status === "sent" || offer.status === "countered") {
    if (offer.expires_at === null) return { expired: false, remaining: null, closing: false };
    const remaining = Math.max(0, Math.floor((offer.expires_at.getTime() - clock.getTime()) / 1000));
    return { expired: remaining <= 0, remaining, closing: remaining <= env.FLAN_CLOSING_S };
  }
  return { expired: false, remaining: null, closing: false };
}
