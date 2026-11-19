import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { disputeJson, manifestJson, offerJson } from "./json_views.js";
import { now as clockNow } from "./clock.js";
import { errors, fail, loadOffer, loadSpecimen, namespaceExists, nextEvent, offerIsOpen, replayLookup, replayStore, runCommand, type Tx } from "./domain.js";
import { Storage } from "./storage.js";
import { sha256Hex } from "./util.js";
import { validateUpload } from "./routes_specimens.js";
import { broadcastLater, guarded, num, parseJsonBody, requireCounterpart, requireParty, requireStepUp, str, strArray } from "./routes_util.js";
import { contentTypeFor, extensionFor } from "./photos.js";

function extOf(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg")) return "jpg";
  return "webp";
}

export function exchangeRouter(env: FlanEnv, storage: Storage): Router {
  const router = Router();

  async function assertBasketsAvailable(tx: Tx, ns: string, dealerItems: string[], counterpartItems: string[]): Promise<void> {
    const held = await tx.query<{ specimen: string; offer: string }>("SELECT specimen, offer FROM holds WHERE ns = $1", [ns]);
    const heldBy = new Map(held.rows.map((h) => [h.specimen, h.offer]));
    for (const key of dealerItems) {
      const specimen = await loadSpecimen(tx, ns, key);
      if (specimen.owner !== "dealer") throw errors.hidden();
      if (specimen.register_state !== "stored" || specimen.certainty !== "certain" || specimen.quarantined || specimen.missing) {
        throw fail(409, "conflict", copyFor("F_CATALOG_PENDING"));
      }
      if (specimen.status === "reserved" || specimen.status === "outbound" || heldBy.get(key) !== undefined) {
        throw errors.conflict(copyFor("F_OFFER_TAKEN"));
      }
    }
    for (const key of counterpartItems) {
      const specimen = await loadSpecimen(tx, ns, key);
      if (specimen.owner !== "counterpart") throw errors.hidden();
      if (specimen.register_state !== "stored" || specimen.certainty !== "certain" || specimen.quarantined || specimen.missing) {
        throw fail(409, "conflict", copyFor("F_CATALOG_PENDING"));
      }
      if (specimen.status === "reserved" || specimen.status === "outbound" || heldBy.get(key) !== undefined) {
        throw errors.conflict(copyFor("F_OFFER_TAKEN"));
      }
    }
  }

  router.post("/desks/:ns/offers/:offer/send", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      if (session.role !== "dealer") throw errors.forbidden();
      requireStepUp(req);
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const dealerItems = strArray(raw.dealer_items) ?? [];
      const counterpartItems = strArray(raw.counterpart_items) ?? [];
      const payload = { command_id: commandId, offer, dealer_items: dealerItems, counterpart_items: counterpartItems, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (offerRow.status !== "draft") throw errors.stale();
        if (expectedVersion === undefined || offerRow.version !== expectedVersion) throw errors.stale();
        const fields: Record<string, string> = {};
        if (dealerItems.length < 1) fields.dealer_items = copyFor("F_BASKET_EMPTY");
        if (counterpartItems.length < 1) fields.counterpart_items = copyFor("F_BASKET_EMPTY");
        if (dealerItems.length > env.FLAN_OFFER_MAX_ITEMS) fields.dealer_items = copyFor("F_BASKET_FULL", { max: env.FLAN_OFFER_MAX_ITEMS });
        if (counterpartItems.length > env.FLAN_OFFER_MAX_ITEMS) fields.counterpart_items = copyFor("F_BASKET_FULL", { max: env.FLAN_OFFER_MAX_ITEMS });
        if (Object.keys(fields).length > 0) throw errors.invalid(fields);
        await assertBasketsAvailable(tx, ns, dealerItems, counterpartItems);
        const now = await clockNow(ns);
        await tx.query(
          `UPDATE offers SET status = 'sent', dealer_items = $1, counterpart_items = $2, dealer_acceptance_version = NULL,
           counterpart_acceptance_version = NULL, version = version + 1, expires_at = $3 WHERE ns = $4 AND key = $5`,
          [dealerItems, counterpartItems, new Date(now.getTime() + env.FLAN_OFFER_WINDOW_S * 1000), ns, offer],
        );
        for (const key of [...dealerItems, ...counterpartItems]) {
          await tx.query("UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key = $2", [ns, key]);
        }
        const event = await nextEvent(tx, ns, commandId, "dealer", "offer.sent");
        const body = { offer: await offerJson(tx, ns, offer, env) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/offers/:offer/holds", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireCounterpart(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const specimenKey = str(raw.specimen) ?? "";
      const payload = { command_id: commandId, specimen: specimenKey };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (!offerIsOpen(offerRow)) throw errors.conflict(copyFor("F_OFFER_EXPIRED"));
        const specimen = await loadSpecimen(tx, ns, specimenKey);
        if (specimen.status === "reserved" || specimen.status === "outbound") throw errors.conflict(copyFor("F_OFFER_TAKEN"));
        await tx.query(
          "INSERT INTO holds (ns, offer, specimen) VALUES ($1, $2, $3) ON CONFLICT (ns, specimen) DO UPDATE SET offer = $2",
          [ns, offer, specimenKey],
        );
        const event = await nextEvent(tx, ns, commandId, "counterpart", "hold.placed");
        const body = { hold: { specimen: specimenKey } };
        await replayStore(tx, ns, commandId, payload, 201, body);
        broadcastLater(ns, event);
        return { status: 201, body };
      });
    });
  });

  router.delete("/desks/:ns/offers/:offer/holds/:key", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireCounterpart(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const key = req.params.key;
      return runCommand(async (tx) => {
        const result = await tx.query("DELETE FROM holds WHERE ns = $1 AND offer = $2 AND specimen = $3 RETURNING specimen", [ns, offer, key]);
        if (result.rows.length === 0) throw errors.hidden();
        const event = await nextEvent(tx, ns, `hold-release-${key}-${Date.now()}`, "counterpart", "hold.released");
        broadcastLater(ns, event);
        return { status: 204, body: null };
      });
    });
  });

  router.post("/desks/:ns/offers/:offer/replace", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const remove = str(raw.remove) ?? "";
      const add = str(raw.add) ?? "";
      const payload = { command_id: commandId, offer, remove, add, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (expectedVersion === undefined || offerRow.version !== expectedVersion) throw errors.stale();
        if (offerRow.status === "expired") throw errors.conflict(copyFor("F_OFFER_EXPIRED"));
        const dealerManifest = await tx.query<{ frozen: boolean }>("SELECT frozen FROM manifests WHERE ns = $1 AND offer = $2 AND party = 'dealer'", [ns, offer]);
        const counterpartManifest = await tx.query<{ frozen: boolean }>("SELECT frozen FROM manifests WHERE ns = $1 AND offer = $2 AND party = 'counterpart'", [ns, offer]);
        if (dealerManifest.rows[0]?.frozen || counterpartManifest.rows[0]?.frozen) {
          throw errors.conflict(copyFor("F_DISPATCH_FROZEN"));
        }
        const isDealer = session.role === "dealer";
        const dealerItems = [...offerRow.dealer_items];
        const counterpartItems = [...offerRow.counterpart_items];
        const list = isDealer ? dealerItems : counterpartItems;
        const removeIdx = list.indexOf(remove);
        if (removeIdx === -1) throw errors.hidden();
        list.splice(removeIdx, 1);
        const addSpecimen = await loadSpecimen(tx, ns, add);
        if (addSpecimen.register_state !== "stored") throw errors.conflict(copyFor("F_CATALOG_PENDING"));
        const held = await tx.query<{ offer: string }>("SELECT offer FROM holds WHERE ns = $1 AND specimen = $2", [ns, add]);
        const heldElsewhere = held.rows[0] !== undefined && held.rows[0].offer !== offer;
        if (addSpecimen.status === "reserved" && !list.includes(add) && !offerRow.dealer_items.includes(add) && !offerRow.counterpart_items.includes(add)) {
          throw errors.conflict(copyFor("F_OFFER_TAKEN"));
        }
        if (heldElsewhere) throw errors.conflict(copyFor("F_OFFER_TAKEN"));
        list.push(add);
        if (!offerIsOpen(offerRow)) throw errors.conflict(copyFor("F_OFFER_EXPIRED"));
        const now = await clockNow(ns);
        const newStatus = isDealer ? "sent" : "countered";
        const windowSeconds = isDealer ? env.FLAN_OFFER_WINDOW_S : env.FLAN_COUNTER_WINDOW_S;
        await tx.query(
          `UPDATE offers SET dealer_items = $1, counterpart_items = $2, status = $3,
           dealer_acceptance_version = NULL, counterpart_acceptance_version = NULL, version = version + 1, expires_at = $4
           WHERE ns = $5 AND key = $6`,
          [dealerItems, counterpartItems, newStatus, new Date(now.getTime() + windowSeconds * 1000), ns, offer],
        );
        await tx.query("UPDATE specimens SET status = CASE WHEN quarantined THEN 'quarantined' ELSE 'attributed' END WHERE ns = $1 AND key = $2", [ns, remove]);
        await tx.query("UPDATE specimens SET status = 'reserved' WHERE ns = $1 AND key = $2", [ns, add]);
        await tx.query("DELETE FROM holds WHERE ns = $1 AND offer = $2 AND specimen = $3", [ns, offer, add]);
        const event = await nextEvent(tx, ns, commandId, isDealer ? "dealer" : "counterpart", "offer.replaced");
        const body = { offer: await offerJson(tx, ns, offer, env) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/offers/:offer/accept", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      requireStepUp(req);
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const payload = { command_id: commandId, offer, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (expectedVersion === undefined || offerRow.version !== expectedVersion) throw errors.stale();
        if (offerRow.status === "expired") throw errors.conflict(copyFor("F_OFFER_EXPIRED"));
        if (!offerIsOpen(offerRow)) throw errors.stale();
        const party = session.role === "dealer" ? "dealer" : "counterpart";
        const column = party === "dealer" ? "dealer_acceptance_version" : "counterpart_acceptance_version";
        await tx.query(`UPDATE offers SET ${column} = $1 WHERE ns = $2 AND key = $3`, [offerRow.version, ns, offer]);
        const updated = await loadOffer(tx, ns, offer);
        const bothAccepted = updated.dealer_acceptance_version === updated.version && updated.counterpart_acceptance_version === updated.version;
        let event = await nextEvent(tx, ns, commandId, party, "offer.accepted");
        if (bothAccepted && updated.status !== "accepted") {
          await tx.query("UPDATE offers SET status = 'accepted', expires_at = NULL WHERE ns = $1 AND key = $2", [ns, offer]);
          for (const key of [...updated.dealer_items, ...updated.counterpart_items]) {
            await tx.query("UPDATE specimens SET status = 'outbound' WHERE ns = $1 AND key = $2", [ns, key]);
          }
        }
        const body = { offer: await offerJson(tx, ns, offer, env) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/offers/:offer/manifests/:party/freeze", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const party = req.params.party;
      if ((party === "dealer" && session.role !== "dealer") || (party === "counterpart" && session.role !== "counterpart")) {
        throw errors.forbidden();
      }
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const order = strArray(raw.order) ?? [];
      const payload = { command_id: commandId, offer, order, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const manifest = await tx.query<{ version: number; frozen: boolean }>(
          "SELECT version, frozen FROM manifests WHERE ns = $1 AND offer = $2 AND party = $3",
          [ns, offer, party],
        );
        const current = manifest.rows[0];
        if (current && current.frozen) throw errors.conflict(copyFor("F_DISPATCH_FROZEN"));
        const offerRow = await loadOffer(tx, ns, offer);
        if (offerRow.status !== "accepted") throw errors.stale();
        const own = party === "dealer" ? offerRow.dealer_items : offerRow.counterpart_items;
        if (order.length !== own.length || new Set(order).size !== order.length || !order.every((k) => own.includes(k))) {
          throw errors.invalid({ order: copyFor("F_ORDER") });
        }
        if (expectedVersion === undefined || (current?.version ?? 1) !== expectedVersion) throw errors.stale();

        const evidence: { specimen: string; label: string; object_key: string; sha256: string }[] = [];
        try {
          for (const key of order) {
            const photo = await tx.query<{ object_key: string; sha256: string; content_type: string; width: number; height: number }>(
              "SELECT object_key, sha256, content_type, width, height FROM photos WHERE ns = $1 AND specimen = $2 AND label = 'obverse' ORDER BY id DESC LIMIT 1",
              [ns, key],
            );
            const row = photo.rows[0];
            if (!row) throw errors.service();
            const object = await storage.get(row.object_key);
            if (!object) throw errors.service();
            const dispatchKey = `manifests/${ns}/${offer}/${party}/${key}-dispatch-${row.sha256}.${extOf(row.content_type)}`;
            await storage.put(dispatchKey, object.bytes, row.content_type);
            await tx.query(
              "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,$3,'dispatch',$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",
              [`ph_d_${party}_${key}_${row.sha256.slice(0, 12)}`, ns, key, dispatchKey, row.sha256, row.width, row.height, row.content_type, object.bytes.byteLength, offer],
            );
            evidence.push({ specimen: key, label: "dispatch", object_key: dispatchKey, sha256: row.sha256 });
          }
          const manifestRecord = { order, evidence, party };
          await storage.put(`manifests/${ns}/${offer}/${party}/manifest.json`, Buffer.from(JSON.stringify(manifestRecord), "utf8"), "application/json");
        } catch (err) {
          if (err instanceof Error && err.message === "service_unavailable_marker") throw errors.service();
          throw err;
        }

        await tx.query(
          `INSERT INTO manifests (ns, offer, party, version, order_keys, frozen) VALUES ($1, $2, $3, 1, $4, TRUE)
           ON CONFLICT (ns, offer, party) DO UPDATE SET order_keys = $4, frozen = TRUE, version = manifests.version + 1`,
          [ns, offer, party, order],
        );
        const otherParty = party === "dealer" ? "counterpart" : "dealer";
        const other = await tx.query<{ frozen: boolean }>("SELECT frozen FROM manifests WHERE ns = $1 AND offer = $2 AND party = $3", [ns, offer, otherParty]);
        const event = await nextEvent(tx, ns, commandId, party === "dealer" ? "dealer" : "counterpart", "manifest.frozen");
        if (other.rows[0]?.frozen) {
          await tx.query("UPDATE offers SET status = 'dispatched', expires_at = NULL WHERE ns = $1 AND key = $2", [ns, offer]);
        }
        const body = { manifest: await manifestJson(tx, ns, offer, party) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/offers/:offer/arrivals", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const offer = req.params.offer;
      const offerRow = await loadOfferStandalone(ns, offer);
      const receiving = session.role === "dealer" ? offerRow.counterpart_items : offerRow.dealer_items;
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const specimen = str(raw.specimen) ?? "";
      if (!receiving.includes(specimen)) throw errors.hidden();
      const files = (req as unknown as { files?: { fieldname: string; buffer: Buffer; size: number }[] }).files;
      const file = files?.find((f) => f.fieldname === "photo");
      const check = validateUpload(env, file);
      if (check.error) {
        if (check.oversize) throw fail(413, "too_large", copyFor("F_TOO_LARGE"), { photo: check.error });
        throw errors.invalid({ photo: check.error });
      }
      if (!file) throw errors.invalid({ photo: copyFor("F_PHOTO_MISSING") });
      const sha = sha256Hex(file.buffer);
      const key = `arrivals/${ns}/${offer}/${specimen}-${sha}.${extensionFor(check.kind!)}`;
      try {
        await storage.put(key, file.buffer, contentTypeFor(check.kind!));
      } catch {
        throw errors.service();
      }
      const id = `ph_a_${sha.slice(0, 20)}`;
      const { pool } = await import("./db.js");
      await pool.query(
        "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size, offer) VALUES ($1,$2,$3,'arrival',$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",
        [id, ns, specimen, key, sha, check.width, check.height, contentTypeFor(check.kind!), file.size, offer],
      );
      const clock = await clockNow(ns);
      const { pool: pool2 } = await import("./db.js");
      const eventRes = await pool2.query<{ sequence: string }>(
        "INSERT INTO events (ns, command_id, actor, type, at, payload) VALUES ($1, $2, $3, 'arrival.saved', $4, '{}') RETURNING sequence",
        [ns, commandId, session.role, clock],
      );
      const event = { command_id: commandId, actor: session.role as "dealer" | "counterpart", type: "arrival.saved" as const, sequence: Number(eventRes.rows[0].sequence), at: clock.toISOString() };
      broadcastLater(ns, event);
      return {
        status: 201,
        body: { photo: { id, label: "arrival", object_key: key, sha256: sha, width: check.width, height: check.height } },
      };
    });
  });

  async function loadOfferStandalone(ns: string, offer: string): Promise<{ dealer_items: string[]; counterpart_items: string[] }> {
    const { pool } = await import("./db.js");
    const res = await pool.query<{ dealer_items: string[]; counterpart_items: string[] }>(
      "SELECT dealer_items, counterpart_items FROM offers WHERE ns = $1 AND key = $2",
      [ns, offer],
    );
    if (res.rows.length === 0) throw errors.hidden();
    return res.rows[0];
  }

  router.post("/desks/:ns/offers/:offer/receipts", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireParty(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      requireStepUp(req);
      const offer = req.params.offer;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const matches = raw.matches === true;
      const payload = { command_id: commandId, offer, matches, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const offerRow = await loadOffer(tx, ns, offer);
        if (expectedVersion === undefined || offerRow.version !== expectedVersion) throw errors.stale();
        const party = session.role === "dealer" ? "dealer" : "counterpart";
        const receiving = party === "dealer" ? offerRow.counterpart_items : offerRow.dealer_items;
        const arrivals = await tx.query<{ specimen: string }>(
          "SELECT specimen FROM photos WHERE ns = $1 AND offer = $2 AND label = 'arrival'",
          [ns, offer],
        );
        const arrived = new Set(arrivals.rows.map((r) => r.specimen));
        if (!receiving.every((k) => arrived.has(k))) {
          throw errors.invalid({ matches: copyFor("F_ARRIVAL_MISSING") });
        }
        await tx.query(
          `INSERT INTO receipts (ns, offer, party, confirmed, matches) VALUES ($1, $2, $3, TRUE, $4)
           ON CONFLICT (ns, offer, party) DO UPDATE SET confirmed = TRUE, matches = $4`,
          [ns, offer, party, matches],
        );
        await tx.query("UPDATE offers SET version = version + 1 WHERE ns = $1 AND key = $2", [ns, offer]);
        const receiptEvent = await nextEvent(tx, ns, commandId, party, "receipt.recorded");

        const openDispute = await tx.query("SELECT 1 FROM disputes WHERE ns = $1 AND offer = $2 AND open = TRUE", [ns, offer]);
        const both = await tx.query<{ confirmed: boolean; matches: boolean }>("SELECT confirmed, matches FROM receipts WHERE ns = $1 AND offer = $2", [ns, offer]);
        const bothConfirmed = both.rows.length === 2 && both.rows.every((r) => r.confirmed);
        const allMatch = both.rows.every((r) => r.matches);

        if (offerRow.status === "dispatched") {
          if (openDispute.rowCount === 1) {
            await tx.query("UPDATE offers SET status = 'disputed' WHERE ns = $1 AND key = $2", [ns, offer]);
          } else if (!matches || (bothConfirmed && !allMatch)) {
            await tx.query("UPDATE offers SET status = 'received' WHERE ns = $1 AND key = $2", [ns, offer]);
          } else if (bothConfirmed && allMatch) {
            for (const key of offerRow.dealer_items) {
              await tx.query("UPDATE specimens SET owner = 'counterpart', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            for (const key of offerRow.counterpart_items) {
              await tx.query("UPDATE specimens SET owner = 'dealer', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            await tx.query("UPDATE offers SET status = 'transferred', expires_at = NULL WHERE ns = $1 AND key = $2", [ns, offer]);
            const transferEvent = await nextEvent(tx, ns, commandId, party, "ownership.transferred");
            broadcastLater(ns, transferEvent);
          } else {
            await tx.query("UPDATE offers SET status = 'received' WHERE ns = $1 AND key = $2", [ns, offer]);
          }
        } else if (offerRow.status === "received" && openDispute.rowCount !== 1) {
          if (bothConfirmed && allMatch) {
            for (const key of offerRow.dealer_items) {
              await tx.query("UPDATE specimens SET owner = 'counterpart', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            for (const key of offerRow.counterpart_items) {
              await tx.query("UPDATE specimens SET owner = 'dealer', status = 'transferred' WHERE ns = $1 AND key = $2", [ns, key]);
            }
            await tx.query("UPDATE offers SET status = 'transferred', expires_at = NULL WHERE ns = $1 AND key = $2", [ns, offer]);
            const transferEvent = await nextEvent(tx, ns, commandId, party, "ownership.transferred");
            broadcastLater(ns, transferEvent);
          }
        }
        const body = { receipt: { confirmed: true, matches }, offer: await offerJson(tx, ns, offer, env) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, receiptEvent);
        return { status: 200, body };
      });
    });
  });

  return router;
}
