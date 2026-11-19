// Runs one confirmed command inside one Postgres transaction, applying the brief's error
// precedence in exactly this order: resources (404) and role (403), step-up (403), replay,
// state conflicts (409), validation (422), then provider work, then the commit with its event.

import { createHash } from "node:crypto";
import type { Party } from "../../shared/types.js";
import { notify, transaction } from "../db.js";
import { type Desk, loadDesk, type OfferRecord } from "../desk.js";
import { conflict, HttpError, notFound, stepUpRequired } from "../errors.js";
import { F } from "../../shared/feedback.js";
import { deleteObjects } from "../minio.js";
import { expireOffers, reopenHoles, stepUpFresh } from "../rules.js";
import type { Session } from "../sessions.js";

/** A write naming a version other than the record's current one is stale. */
export function stale(expected: number | null, current: number): void {
  if (expected !== current) throw conflict(F.CONFLICT);
}

/** Any command on an expired offer is refused, before the version check. */
export function notExpired(offer: OfferRecord): void {
  if (offer.status === "expired") throw conflict(F.OFFER_EXPIRED);
}

export interface Caller {
  session: Session;
  party: Party;
}

interface Reply {
  status: number;
  body: unknown;
}

export interface CommandSpec<B, L, P = undefined, V = void> {
  /** Sending, accepting and receipts need a fresh step-up proof. */
  stepUp?: boolean;
  /** 404 for missing or hidden resources (including keys in the body), then 403 for the role. */
  locate(desk: Desk, body: B, caller: Caller): L;
  /** 409 state conflicts, in the brief's order. */
  conflicts?(desk: Desk, body: B, located: L, caller: Caller): void;
  /** 422 field validation; what it establishes (an accepted photograph) is handed to `provide`. */
  validate?(desk: Desk, body: B, located: L, caller: Caller): V;
  /** Provider work done while the namespace is locked; its failure is never stored for replay. */
  provide?(desk: Desk, body: B, located: L, checked: V): Promise<P>;
  /** What a provider failure still records (the reconcile keeps the dealer's correction). */
  onProviderError?(desk: Desk, body: B, located: L): void;
  /** Objects written by `provide` that must go when the commit does not happen. */
  written?(provided: P): string[];
  apply(desk: Desk, body: B, located: L, caller: Caller, commandId: string, provided: P): Reply;
}

export function payloadHash(payload: unknown): string {
  const canonical = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : Array.isArray(value)
        ? value.map(canonical)
        : value;
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

type Outcome = { reply: Reply } | { failure: HttpError };

export async function runCommand<B, L, P, V>(
  ns: string,
  caller: Caller,
  spec: CommandSpec<B, L, P, V>,
  body: B,
  commandId: string,
  hash: string,
): Promise<Reply> {
  let provided: P | undefined;
  let committed = false;
  try {
    const outcome = await transaction<Outcome>(async (client) => {
      const desk = await loadDesk(client, ns, true);
      if (!desk) throw notFound();
      expireOffers(desk);
      const located = spec.locate(desk, body, caller);
      if (spec.stepUp && !stepUpFresh(caller.session.step_up_at)) throw stepUpRequired();
      const stored = await client.query<{ payload_hash: string; status: number; body: unknown }>(
        "SELECT payload_hash, status, body FROM command_replies WHERE ns = $1 AND command_id = $2",
        [ns, commandId],
      );
      const previous = stored.rows[0];
      if (previous) {
        if (previous.payload_hash !== hash) throw conflict(F.COMMAND_REUSED);
        return { reply: { status: previous.status, body: previous.body } };
      }
      spec.conflicts?.(desk, body, located, caller);
      const checked = spec.validate?.(desk, body, located, caller) as V;
      if (spec.provide) {
        try {
          provided = await spec.provide(desk, body, located, checked);
        } catch (error) {
          if (!(error instanceof HttpError) || !spec.onProviderError) throw error;
          spec.onProviderError(desk, body, located);
          await desk.save(client);
          return { failure: error };
        }
      }
      const reply = spec.apply(desk, body, located, caller, commandId, provided as P);
      reopenHoles(desk, commandId);
      await desk.save(client);
      await client.query(
        "INSERT INTO command_replies (ns, command_id, payload_hash, status, body) VALUES ($1,$2,$3,$4,$5)",
        [ns, commandId, hash, reply.status, JSON.stringify(reply.body)],
      );
      return { reply };
    });
    committed = true;
    if ("failure" in outcome) throw outcome.failure;
    await notify(ns);
    return outcome.reply;
  } finally {
    if (!committed && provided !== undefined && spec.written) await deleteObjects(spec.written(provided));
  }
}
