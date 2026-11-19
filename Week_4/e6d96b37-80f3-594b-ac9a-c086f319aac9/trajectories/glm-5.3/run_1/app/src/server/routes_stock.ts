import { Router } from "express";
import { copyFor } from "../shared/feedback.js";
import { albumJson, keeperJson, trayJson } from "./json_views.js";
import { albumVersion, cellExists, errors, fail, holderFits, keeperVersion, loadSpecimen, nextEvent, replayLookup, replayStore, runCommand, trayVersion } from "./domain.js";
import { Register, RegisterError2, registerErrorToHttp } from "./register.js";
import { broadcastLater, guarded, num, parseJsonBody, requireDealer, str, strArray } from "./routes_util.js";

export function stockRouter(register: Register): Router {
  const router = Router();

  router.post("/desks/:ns/tray/placements", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const specimenKey = str(raw.specimen) ?? "";
      const cell = str(raw.cell) ?? "";
      const payload = { command_id: commandId, specimen: specimenKey, cell, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const specimen = await loadSpecimen(tx, ns, specimenKey);
        if (expectedVersion === undefined || (await trayVersion(tx, ns)) !== expectedVersion) throw errors.stale();
        if (!cellExists(cell) || !holderFits(specimen.holder_width_mm, specimen.holder_height_mm)) {
          throw errors.invalid({ cell: copyFor("F_TRAY_SIZE") });
        }
        const occupied = await tx.query(
          "SELECT specimen FROM tray_cells WHERE ns = $1 AND cell = $2 AND specimen IS NOT NULL AND specimen <> $3",
          [ns, cell, specimenKey],
        );
        if (occupied.rowCount === 1) throw errors.conflict(copyFor("F_TRAY_TAKEN"));
        await tx.query("UPDATE tray_cells SET specimen = NULL WHERE ns = $1 AND specimen = $2", [ns, specimenKey]);
        await tx.query("UPDATE tray_cells SET specimen = $2 WHERE ns = $1 AND cell = $3", [ns, specimenKey, cell]);
        await tx.query("UPDATE tray_meta SET version = version + 1 WHERE ns = $1", [ns]);
        await tx.query(
          "UPDATE specimens SET status = CASE WHEN status IN ('attributed','shelved') THEN 'shelved' ELSE status END WHERE ns = $1 AND key = $2",
          [ns, specimenKey],
        );
        const event = await nextEvent(tx, ns, commandId, "dealer", "tray.placed");
        const version = await trayVersion(tx, ns);
        const body = { tray: await trayJson(tx, ns), version };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/album/reconcile", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const payload = { command_id: commandId };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        let record: { set: string; title: string; revision: number; holes: { label: string; reference: string; mintmark: string }[] };
        try {
          record = await register.album("ALD-CROWN");
        } catch (err) {
          if (err instanceof RegisterError2) {
            const http = registerErrorToHttp(err.detail);
            throw fail(http.status, http.code, http.message, undefined, http.retryAfter);
          }
          throw err;
        }
        await tx.query(
          "INSERT INTO albums (ns, set, revision, version) VALUES ($1, $2, $3, 1) ON CONFLICT (ns) DO UPDATE SET set = $2, revision = $3",
          [ns, record.set, record.revision],
        );
        const filled = await tx.query<{ hole: string; specimen: string }>(
          "SELECT hole, specimen FROM album_holes WHERE ns = $1 AND specimen IS NOT NULL",
          [ns],
        );
        const filledBySpecimen = new Map(filled.rows.map((r) => [r.specimen, r.hole]));
        await tx.query("DELETE FROM album_holes WHERE ns = $1", [ns]);
        for (const hole of record.holes) {
          const previous = filledBySpecimen.get(hole.label);
          await tx.query(
            "INSERT INTO album_holes (ns, hole, reference, mintmark, specimen) VALUES ($1, $2, $3, $4, $5)",
            [ns, hole.label, hole.reference, hole.mintmark, previous === hole.label ? filledBySpecimen.get(hole.label) ?? null : null],
          );
        }
        const event = await nextEvent(tx, ns, commandId, "dealer", "album.reconciled");
        const body = { album: await albumJson(tx, ns) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/album/holes/:hole/fill", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const hole = decodeURIComponent(req.params.hole);
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const specimenKey = str(raw.specimen) ?? "";
      const payload = { command_id: commandId, hole, specimen: specimenKey, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const holeRow = await tx.query<{ reference: string; mintmark: string }>(
          "SELECT reference, mintmark FROM album_holes WHERE ns = $1 AND hole = $2",
          [ns, hole],
        );
        if (holeRow.rows.length === 0) throw errors.hidden();
        const specimen = await loadSpecimen(tx, ns, specimenKey);
        if (expectedVersion === undefined || (await albumVersion(tx, ns)) !== expectedVersion) throw errors.stale();
        if (specimen.quarantined) throw errors.conflict(copyFor("F_SET_UNCERTAIN"));
        if (specimen.status === "reserved" || specimen.status === "outbound") throw errors.conflict(copyFor("F_SET_OUTBOUND"));
        if (specimen.register_state !== "stored") throw errors.conflict(copyFor("F_CATALOG_PENDING"));
        if (specimen.attribution_mintmark !== holeRow.rows[0].mintmark) {
          throw errors.invalid({ specimen: copyFor("F_SET_MISMATCH") });
        }
        await tx.query("UPDATE album_holes SET specimen = NULL WHERE ns = $1 AND specimen = $2", [ns, specimenKey]);
        await tx.query("UPDATE album_holes SET specimen = $1 WHERE ns = $2 AND hole = $3", [specimenKey, ns, hole]);
        await tx.query("UPDATE albums SET version = version + 1 WHERE ns = $1", [ns]);
        const event = await nextEvent(tx, ns, commandId, "dealer", "album.filled");
        const body = { album: await albumJson(tx, ns), version: await albumVersion(tx, ns) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.put("/desks/:ns/keeper-order", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const order = strArray(raw.order);
      if (!order) throw errors.invalid({ order: copyFor("F_ORDER") });
      const payload = { command_id: commandId, order, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const current = await tx.query<{ order_keys: string[]; version: number }>(
          "SELECT order_keys, version FROM keeper_orders WHERE ns = $1",
          [ns],
        );
        if (expectedVersion === undefined || (current.rows[0]?.version ?? 1) !== expectedVersion) throw errors.stale();
        const keys = await tx.query<{ key: string }>("SELECT key FROM specimens WHERE ns = $1", [ns]);
        const allKeys = new Set(keys.rows.map((r) => r.key));
        const unique = new Set(order);
        if (order.length !== unique.size || order.length !== allKeys.size || !order.every((k) => allKeys.has(k))) {
          throw errors.invalid({ order: copyFor("F_ORDER") });
        }
        await tx.query(
          "INSERT INTO keeper_orders (ns, version, order_keys, previous_order_keys) VALUES ($1, 1, $2, $2) ON CONFLICT (ns) DO UPDATE SET previous_order_keys = keeper_orders.order_keys, order_keys = $2, version = keeper_orders.version + 1",
          [ns, order],
        );
        const event = await nextEvent(tx, ns, commandId, "dealer", "keeper.reordered");
        const body = { keeper_order: await keeperJson(tx, ns), version: await keeperVersion(tx, ns) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/keeper-order/undo", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const payload = { command_id: commandId, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const row = await tx.query<{ order_keys: string[]; previous_order_keys: string[]; version: number }>(
          "SELECT order_keys, previous_order_keys, version FROM keeper_orders WHERE ns = $1",
          [ns],
        );
        const current = row.rows[0];
        if (!current || expectedVersion === undefined || current.version !== expectedVersion) throw errors.stale();
        const previous = current.previous_order_keys;
        if (!previous || previous.length === 0 || JSON.stringify(previous) === JSON.stringify(current.order_keys)) {
          throw errors.conflict(copyFor("F_UNDO_NONE"));
        }
        await tx.query(
          "UPDATE keeper_orders SET order_keys = $1, previous_order_keys = $2, version = version + 1 WHERE ns = $3",
          [previous, current.order_keys, ns],
        );
        const event = await nextEvent(tx, ns, commandId, "dealer", "keeper.restored");
        const body = { keeper_order: previous, version: current.version + 1 };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  return router;
}
