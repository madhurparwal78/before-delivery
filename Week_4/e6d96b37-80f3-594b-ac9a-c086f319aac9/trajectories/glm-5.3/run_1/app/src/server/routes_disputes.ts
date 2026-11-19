import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { disputeJson, offerJson } from "./json_views.js";
import { now as clockNow } from "./clock.js";
import { errors, loadOffer, nextEvent, noteTooLong, replayLookup, replayStore, runCommand } from "./domain.js";
import { Storage } from "./storage.js";
import { randomToken } from "./util.js";
import { broadcastLater, guarded, num, parseJsonBody, requireParty, str } from "./routes_util.js";

export function disputesRouter(env: FlanEnv, storage: Storage): Router {
  const router = Router();

  router.post("/desks/:ns/offers/:offer/disputes", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const specimenKey = str(raw.specimen) ?? "";
      const note = str(raw.note) ?? "";
      const markers = Array.isArray(raw.markers) ? raw.markers : [];
      const payload = { command_id: commandId, offer, specimen: specimenKey, note, markers, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (expectedVersion === undefined || offerRow.version !== expectedVersion) throw errors.stale();
        const receiving = session.role === "dealer" ? offerRow.counterpart_items : offerRow.dealer_items;
        if (!receiving.includes(specimenKey)) throw errors.hidden();
        const fields: Record<string, string> = {};
        for (const marker of markers) {
          if (typeof marker !== "object" || marker === null) {
            fields.markers = copyFor("F_COORD");
            break;
          }
          const m = marker as Record<string, unknown>;
          const x = num(m.x);
          const y = num(m.y);
          const text = str(m.text) ?? "";
          if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
            fields.markers = copyFor("F_COORD");
          }
          if (noteTooLong(text, env.FLAN_NOTE_MAX_CHARS)) {
            fields.markers = copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS });
          }
        }
        if (noteTooLong(note, env.FLAN_NOTE_MAX_CHARS)) {
          fields.note = copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS });
        }
        if (Object.keys(fields).length > 0) throw errors.invalid(fields);

        const disputeKey = `dispute-${offer}-${specimenKey}`;
        const arrivals = await tx.query<{ object_key: string; sha256: string }>(
          "SELECT object_key, sha256 FROM photos WHERE ns = $1 AND offer = $2 AND specimen = $3 AND label = 'arrival'",
          [ns, offer, specimenKey],
        );
        const dispatch = await tx.query<{ object_key: string; sha256: string }>(
          "SELECT object_key, sha256 FROM photos WHERE ns = $1 AND offer = $2 AND specimen = $3 AND label = 'dispatch'",
          [ns, offer, specimenKey],
        );
        const seqRes = await tx.query<{ nextval: string }>("SELECT nextval(pg_get_serial_sequence('events','sequence')) AS nextval");
        const snapshot = {
          offer,
          specimen: specimenKey,
          note,
          markers,
          arrival: arrivals.rows[0] ?? null,
          dispatch: dispatch.rows[0] ?? null,
        };
        const snapshotKey = `disputes/${ns}/${disputeKey}/evidence-${seqRes.rows[0].nextval}.json`;
        try {
          await storage.put(snapshotKey, Buffer.from(JSON.stringify(snapshot), "utf8"), "application/json");
        } catch {
          throw errors.service();
        }
        await tx.query(
          `INSERT INTO disputes (ns, key, offer, specimen, version, open) VALUES ($1, $2, $3, $4, 1, TRUE)
           ON CONFLICT (ns, key) DO UPDATE SET open = TRUE`,
          [ns, disputeKey, offer, specimenKey],
        );
        for (const marker of markers) {
          const m = marker as { id?: string; x: number; y: number; text: string };
          const id = m.id ?? `mk_${Math.floor(m.x)}-${Math.floor(m.y)}`;
          await tx.query(
            "INSERT INTO dispute_markers (ns, dispute, key, x, y, text) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (ns, dispute, key) DO UPDATE SET x = $4, y = $5, text = $6",
            [ns, disputeKey, id, Math.floor(m.x), Math.floor(m.y), m.text],
          );
        }
        await tx.query("UPDATE offers SET status = 'disputed', version = version + 1 WHERE ns = $1 AND key = $2", [ns, offer]);
        const event = await nextEvent(tx, ns, commandId, session.role === "dealer" ? "dealer" : "counterpart", "dispute.opened");
        const body = { dispute: await disputeJson(tx, ns, disputeKey) };
        await replayStore(tx, ns, commandId, payload, 201, body);
        broadcastLater(ns, event);
        return { status: 201, body };
      });
    });
  });

  router.put("/desks/:ns/disputes/:dispute/markers/:marker", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const disputeKey = req.params.dispute;
      const markerKey = req.params.marker;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const x = num(raw.x);
      const y = num(raw.y);
      const text = str(raw.text) ?? "";
      const payload = { command_id: commandId, dispute: disputeKey, marker: markerKey, x: x ?? null, y: y ?? null, text, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const dispute = await tx.query<{ version: number }>("SELECT version FROM disputes WHERE ns = $1 AND key = $2", [ns, disputeKey]);
        if (dispute.rows.length === 0) throw errors.hidden();
        if (expectedVersion === undefined || dispute.rows[0].version !== expectedVersion) throw errors.stale();
        const fields: Record<string, string> = {};
        if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
          fields.x = copyFor("F_COORD");
          fields.y = copyFor("F_COORD");
        }
        if (noteTooLong(text, env.FLAN_NOTE_MAX_CHARS)) {
          fields.text = copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS });
        }
        if (Object.keys(fields).length > 0) throw errors.invalid(fields);
        const updated = await tx.query(
          "UPDATE dispute_markers SET x = $1, y = $2, text = $3 WHERE ns = $4 AND dispute = $5 AND key = $6 RETURNING key",
          [x, y, text, ns, disputeKey, markerKey],
        );
        if (updated.rows.length === 0) {
          await tx.query(
            "INSERT INTO dispute_markers (ns, dispute, key, x, y, text) VALUES ($1,$2,$3,$4,$5,$6)",
            [ns, disputeKey, markerKey, x, y, text],
          );
        }
        await tx.query("UPDATE disputes SET version = version + 1 WHERE ns = $1 AND key = $2", [ns, disputeKey]);
        const event = await nextEvent(tx, ns, commandId, session.role === "dealer" ? "dealer" : "counterpart", "marker.moved");
        const body = { dispute: await disputeJson(tx, ns, disputeKey) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/disputes/:dispute/resolution", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const disputeKey = req.params.dispute;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const outcome = str(raw.outcome);
      if (outcome !== "transfer" && outcome !== "return") throw errors.invalid({});
      const payload = { command_id: commandId, dispute: disputeKey, outcome, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const dispute = await tx.query<{ version: number; offer: string; specimen: string; open: boolean; resolution_proposed_by: string | null }>(
          "SELECT version, offer, specimen, open, resolution_proposed_by FROM disputes WHERE ns = $1 AND key = $2",
          [ns, disputeKey],
        );
        if (dispute.rows.length === 0) throw errors.hidden();
        const row = dispute.rows[0];
        if (expectedVersion === undefined || row.version !== expectedVersion) throw errors.stale();
        if (row.resolution_proposed_by === (session.role === "dealer" ? "dealer" : "counterpart")) {
          throw errors.forbidden();
        }
        await tx.query(
          "UPDATE disputes SET resolution_outcome = $1, resolution_proposed_by = $2, version = version + 1 WHERE ns = $3 AND key = $4",
          [outcome, session.role, ns, disputeKey],
        );
        const event = await nextEvent(tx, ns, commandId, session.role === "dealer" ? "dealer" : "counterpart", "resolution.proposed");
        const body = { dispute: await disputeJson(tx, ns, disputeKey) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/disputes/:dispute/approve-resolution", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const disputeKey = req.params.dispute;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const payload = { command_id: commandId, dispute: disputeKey, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const dispute = await tx.query<{ version: number; offer: string; specimen: string; open: boolean; resolution_outcome: string | null; resolution_proposed_by: string | null }>(
          "SELECT version, offer, specimen, open, resolution_outcome, resolution_proposed_by FROM disputes WHERE ns = $1 AND key = $2",
          [ns, disputeKey],
        );
        if (dispute.rows.length === 0) throw errors.hidden();
        const row = dispute.rows[0];
        const party = session.role === "dealer" ? "dealer" : "counterpart";
        if (expectedVersion === undefined || row.version !== expectedVersion) throw errors.stale();
        if (row.resolution_proposed_by === party || row.resolution_outcome === null) throw errors.forbidden();
        if (!row.open) throw errors.stale();

        await tx.query("UPDATE disputes SET open = FALSE, version = version + 1 WHERE ns = $1 AND key = $2", [ns, disputeKey]);
        const offerRow = await loadOffer(tx, ns, row.offer);
        const receipts = await tx.query<{ confirmed: boolean; matches: boolean }>(
          "SELECT confirmed, matches FROM receipts WHERE ns = $1 AND offer = $2",
          [ns, row.offer],
        );
        const outcome = row.resolution_outcome as "transfer" | "return";
        let event = await nextEvent(tx, ns, commandId, party, "resolution.approved");
        if (outcome === "transfer") {
          const allReceipted = receipts.rows.length === 2 && receipts.rows.every((r) => r.confirmed);
          if (allReceipted) {
            for (const key of offerRow.dealer_items) {
              await tx.query("UPDATE specimens SET owner = 'counterpart', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            for (const key of offerRow.counterpart_items) {
              await tx.query("UPDATE specimens SET owner = 'dealer', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            await tx.query("UPDATE offers SET status = 'transferred', expires_at = NULL, version = version + 1 WHERE ns = $1 AND key = $2", [ns, row.offer]);
            const transferEvent = await nextEvent(tx, ns, commandId, party, "ownership.transferred");
            broadcastLater(ns, transferEvent);
          } else {
            await tx.query("UPDATE offers SET status = $1, expires_at = NULL, version = version + 1 WHERE ns = $2 AND key = $3", [
              offerRow.status === "dispatched" ? "dispatched" : "received",
              ns,
              row.offer,
            ]);
          }
        } else {
          for (const key of [...offerRow.dealer_items, ...offerRow.counterpart_items]) {
            await tx.query("UPDATE specimens SET status = 'attributed' WHERE ns = $1 AND key = $2", [ns, key]);
          }
          await tx.query("UPDATE offers SET status = 'returned', expires_at = NULL, version = version + 1 WHERE ns = $1 AND key = $2", [ns, row.offer]);
          const returnEvent = await nextEvent(tx, ns, commandId, party, "offer.returned");
          broadcastLater(ns, returnEvent);
        }
        const body = { dispute: await disputeJson(tx, ns, disputeKey), offer: await offerJson(tx, ns, row.offer, env) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/disputes/:dispute/links", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const disputeKey = req.params.dispute;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const payload = { command_id: commandId, dispute: disputeKey };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const dispute = await tx.query("SELECT 1 FROM disputes WHERE ns = $1 AND key = $2", [ns, disputeKey]);
        if (dispute.rows.length === 0) throw errors.hidden();
        const token = randomToken(32);
        const clock = await clockNow(ns);
        const expires = new Date(clock.getTime() + env.FLAN_LINK_TTL_S * 1000);
        await tx.query(
          "INSERT INTO evidence_links (ns, dispute, token, expires_at, revoked) VALUES ($1, $2, $3, $4, FALSE)",
          [ns, disputeKey, token, expires],
        );
        const event = await nextEvent(tx, ns, commandId, session.role === "dealer" ? "dealer" : "counterpart", "link.created");
        const body = { link: { token, url: `${env.APP_PUBLIC_URL}/evidence/${token}`, expires_at: expires.toISOString() } };
        await replayStore(tx, ns, commandId, payload, 201, body);
        broadcastLater(ns, event);
        return { status: 201, body };
      });
    });
  });

  router.delete("/desks/:ns/disputes/:dispute/links/:token", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const disputeKey = req.params.dispute;
      const token = req.params.token;
      return runCommand(async (tx) => {
        const result = await tx.query(
          "UPDATE evidence_links SET revoked = TRUE WHERE ns = $1 AND dispute = $2 AND token = $3 RETURNING token",
          [ns, disputeKey, token],
        );
        if (result.rows.length === 0) throw errors.hidden();
        const event = await nextEvent(tx, ns, `link-revoke-${token}`, session.role === "dealer" ? "dealer" : "counterpart", "link.revoked");
        broadcastLater(ns, event);
        return { status: 204, body: null };
      });
    });
  });

  return router;
}
