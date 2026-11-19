import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { referenceValid } from "../shared/util.js";
import { namespaceExists, errors, fail, loadSpecimen, nextEvent, noteTooLong, replayLookup, replayStore, runCommand, type SpecimenRow, type Tx } from "./domain.js";
import { Register, RegisterError2, registerErrorToHttp } from "./register.js";
import { Storage } from "./storage.js";
import { checkPhoto, contentTypeFor, extensionFor } from "./photos.js";
import { sha256Hex } from "./util.js";
import { specimenJson } from "./json_views.js";
import { broadcastLater, guarded, json, parseJsonBody, requireDealer, str, num } from "./routes_util.js";

export interface PhotoUpload {
  ok: boolean;
  kind?: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  oversize?: boolean;
  error?: string;
}

export function validateUpload(env: FlanEnv, file: { buffer: Buffer; size: number } | undefined): PhotoUpload {
  if (!file) return { ok: false, width: 0, height: 0, error: copyFor("F_PHOTO_MISSING") };
  if (file.size > env.FLAN_UPLOAD_MAX_BYTES) {
    return { ok: false, width: 0, height: 0, oversize: true, error: copyFor("F_PHOTO_BYTES", { max: env.FLAN_UPLOAD_MAX_BYTES }) };
  }
  const check = checkPhoto(env, file.buffer);
  if (!check.ok) {
    if (check.error) {
      return { ok: false, width: check.width, height: check.height, error: copyFor(check.error.key, { max: check.error.max ?? "", min: check.error.min ?? "" }) };
    }
    return { ok: false, width: check.width, height: check.height, error: copyFor("F_PHOTO_TYPE") };
  }
  return { ok: true, kind: check.kind, width: check.width, height: check.height };
}

export function specimenRouter(env: FlanEnv, storage: Storage, register: Register): Router {
  const router = Router();

  router.post("/desks/:ns/specimens", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (!(await namespaceExists(ns)) || session.namespace !== ns) throw errors.hidden();
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const commandId = str(raw.command_id);
      const reference = str(raw.reference);
      if (!commandId || commandId.length > 64) throw errors.invalid({ reference: copyFor("F_REFERENCE_FORMAT") });
      const files = (req as unknown as { files?: { fieldname: string; buffer: Buffer; size: number }[] }).files;
      const obverse = files?.find((f) => f.fieldname === "obverse");
      const reverse = files?.find((f) => f.fieldname === "reverse");
      const payload = { command_id: commandId, reference: reference ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };

        if (!reference || !referenceValid(reference)) throw errors.invalid({ reference: copyFor("F_REFERENCE_FORMAT") });
        const dup = await tx.query("SELECT 1 FROM specimens WHERE ns = $1 AND key = $2", [ns, reference]);
        if (dup.rowCount === 1) throw errors.conflict(copyFor("F_INTAKE_DUP"));

        const obverseCheck = validateUpload(env, obverse);
        const reverseCheck = validateUpload(env, reverse);
        const fields: Record<string, string> = {};
        if (obverseCheck.error) fields.obverse = obverseCheck.error;
        if (reverseCheck.error) fields.reverse = reverseCheck.error;
        if (Object.keys(fields).length > 0) {
          if (obverseCheck.oversize || reverseCheck.oversize) {
            throw fail(413, "too_large", copyFor("F_TOO_LARGE"), fields);
          }
          throw errors.invalid(fields);
        }
        if (!obverse || !reverse) {
          throw errors.invalid({ obverse: copyFor("F_PHOTO_MISSING"), reverse: copyFor("F_PHOTO_MISSING") });
        }

        const obverseSha = sha256Hex(obverse.buffer);
        const reverseSha = sha256Hex(reverse.buffer);
        const obverseKey = `specimens/${ns}/${reference}/obverse-${obverseSha}.${extensionFor(obverseCheck.kind!)}`;
        const reverseKey = `specimens/${ns}/${reference}/reverse-${reverseSha}.${extensionFor(reverseCheck.kind!)}`;
        let stored: { ids: string[] } | null = null;
        try {
          await storage.put(obverseKey, obverse.buffer, contentTypeFor(obverseCheck.kind!));
          await storage.put(reverseKey, reverse.buffer, contentTypeFor(reverseCheck.kind!));
          stored = { ids: [obverseKey, reverseKey] };
        } catch {
          stored = null;
        }
        if (!stored) throw errors.service();

        const clock = (await import("./clock.js")).now;
        const at = await clock(ns);
        await tx.query(
          `INSERT INTO specimens (ns, key, display_label, owner, status, version, holder_kind, holder_width_mm, holder_height_mm, register_state, certainty, created_event_at)
           VALUES ($1, $2, $3, 'dealer', 'pending_catalogue', 1, 'flip', 50, 50, 'pending', 'uncertain', $4)`,
          [ns, reference, `Specimen ${reference}`, at],
        );
        const photoRows = [
          { id: `ph_${obverseSha.slice(0, 18)}o`, label: "obverse", key: obverseKey, sha: obverseSha, w: obverseCheck.width, h: obverseCheck.height, size: obverse.size },
          { id: `ph_${reverseSha.slice(0, 18)}r`, label: "reverse", key: reverseKey, sha: reverseSha, w: reverseCheck.width, h: reverseCheck.height, size: reverse.size },
        ];
        for (const photo of photoRows) {
          await tx.query(
            "INSERT INTO photos (id, ns, specimen, label, object_key, sha256, width, height, content_type, byte_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [photo.id, ns, reference, photo.label, photo.key, photo.sha, photo.w, photo.h, contentTypeFor(obverseCheck.kind!), photo.size],
          );
        }
        const event = await nextEvent(tx, ns, commandId, "dealer", "specimen.created");
        const specimen = await specimenJson(tx, ns, reference);
        const body = { specimen };
        await replayStore(tx, ns, commandId, payload, 201, body);
        broadcastLater(ns, event);
        return { status: 201, body };
      });
    });
  });

  router.post("/desks/:ns/specimens/:key/quarantine", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const key = req.params.key;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      const expectedVersion = num(raw.expected_version);
      const note = str(raw.note) ?? "";
      if (!commandId) throw errors.invalid({ note: copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS }) });
      const payload = { command_id: commandId, note, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const specimen = await loadSpecimen(tx, ns, key);
        if (specimen.status === "reserved" || specimen.status === "outbound") throw errors.conflict(copyFor("F_IN_OFFER"));
        if (expectedVersion === undefined || specimen.version !== expectedVersion) throw errors.stale();
        if (noteTooLong(note, env.FLAN_NOTE_MAX_CHARS)) throw errors.invalid({ note: copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS }) });
        await tx.query(
          "UPDATE specimens SET quarantined = TRUE, status = 'quarantined', note = $1, version = version + 1 WHERE ns = $2 AND key = $3",
          [note, ns, key],
        );
        await reopenAlbumHoles(tx, ns, key, commandId);
        const event = await nextEvent(tx, ns, commandId, "dealer", "specimen.quarantined");
        const body = { specimen: await specimenJson(tx, ns, key) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/specimens/:key/reconcile", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const key = req.params.key;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const correction = str(raw.correction) ?? "";
      const payload = { command_id: commandId, correction, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const specimen = await loadSpecimen(tx, ns, key);
        if (expectedVersion === undefined || specimen.version !== expectedVersion) throw errors.stale();
        if (noteTooLong(correction, env.FLAN_CORRECTION_MAX_CHARS)) {
          throw errors.invalid({ correction: copyFor("F_TEXT_LONG", { max: env.FLAN_CORRECTION_MAX_CHARS }) });
        }
        await tx.query("UPDATE specimens SET correction = $1, register_state = 'pending' WHERE ns = $2 AND key = $3", [correction, ns, key]);

        // Provider calls run after every in-transaction check; failures keep the correction pending.
        const target = correction || specimen.attribution_reference;
        let record: { reference: string; issue: string; mintmark: string; revision: number; image_path: string };
        try {
          record = await register.variety(target);
        } catch (err) {
          if (err instanceof RegisterError2) {
            const http = registerErrorToHttp(err.detail);
            throw fail(http.status, http.code, http.message, undefined, http.retryAfter);
          }
          throw err;
        }
        let imageKey: string | null = null;
        try {
          const image = await register.image(record.image_path);
          imageKey = `catalog/${ns}/${record.reference}/r${record.revision}.svg`;
          await storage.put(imageKey, Buffer.from(image.body, "utf8"), "image/svg+xml");
        } catch {
          imageKey = null;
        }
        if (imageKey === null) throw fail(503, "catalog_unavailable", copyFor("F_CATALOG_WAIT"));

        await tx.query(
          `UPDATE specimens SET attribution_reference = $1, attribution_mintmark = $2, attribution_revision = $3,
           register_state = 'stored', certainty = 'certain', status = 'attributed', version = version + 1
           WHERE ns = $4 AND key = $5`,
          [record.reference, record.mintmark, record.revision, ns, key],
        );
        await tx.query(
          `INSERT INTO register_records (ns, reference, issue, mintmark, revision, image_object_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (ns, reference) DO UPDATE SET issue = $3, mintmark = $4, revision = $5, image_object_key = $6`,
          [ns, record.reference, record.issue, record.mintmark, record.revision, imageKey],
        );
        const event = await nextEvent(tx, ns, commandId, "dealer", "specimen.reconciled");
        const body = { specimen: await specimenJson(tx, ns, key) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  router.post("/desks/:ns/specimens/:key/annotations", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const key = req.params.key;
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      const photo = str(raw.photo) ?? "obverse";
      const x = num(raw.x);
      const y = num(raw.y);
      const text = str(raw.text) ?? "";
      const payload = { command_id: commandId, photo, x: x ?? null, y: y ?? null, text, expected_version: expectedVersion ?? null };
      return runCommand(async (tx) => {
        const replayed = await replayLookup(tx, ns, commandId, payload);
        if (replayed) return { status: replayed.status, body: replayed.body };
        const specimen = await loadSpecimen(tx, ns, key);
        if (expectedVersion === undefined || specimen.version !== expectedVersion) throw errors.stale();
        const dims = await tx.query<{ width: number; height: number }>(
          "SELECT width, height FROM photos WHERE ns = $1 AND specimen = $2 AND label = $3",
          [ns, key, photo],
        );
        const size = dims.rows[0];
        const fields: Record<string, string> = {};
        if (!size || x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size.width || y >= size.height) {
          fields.x = copyFor("F_COORD");
          fields.y = copyFor("F_COORD");
        }
        if (noteTooLong(text, env.FLAN_NOTE_MAX_CHARS)) {
          fields.text = copyFor("F_TEXT_LONG", { max: env.FLAN_NOTE_MAX_CHARS });
        }
        if (Object.keys(fields).length > 0) throw errors.invalid(fields);
        const id = `an_${sha256Hex(Buffer.from(`${ns}${key}${photo}${x}${y}${text}`)).slice(0, 20)}`;
        await tx.query(
          "INSERT INTO annotations (id, ns, specimen, photo, x, y, text) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
          [id, ns, key, photo, x, y, text],
        );
        await tx.query("UPDATE specimens SET version = version + 1 WHERE ns = $1 AND key = $2", [ns, key]);
        const event = await nextEvent(tx, ns, commandId, "dealer", "annotation.saved");
        const body = { specimen: await specimenJson(tx, ns, key) };
        await replayStore(tx, ns, commandId, payload, 200, body);
        broadcastLater(ns, event);
        return { status: 200, body };
      });
    });
  });

  return router;
}

/** Album holes reopen in the same transaction when a filling specimen becomes ineligible. */
export async function reopenAlbumHoles(tx: Tx, ns: string, key: string, commandId: string): Promise<void> {
  const filled = await tx.query<{ hole: string }>("SELECT hole FROM album_holes WHERE ns = $1 AND specimen = $2", [ns, key]);
  if (filled.rows.length === 0) return;
  await tx.query("UPDATE album_holes SET specimen = NULL WHERE ns = $1 AND specimen = $2", [ns, key]);
  await tx.query("UPDATE albums SET version = version + 1 WHERE ns = $1", [ns]);
  for (const hole of filled.rows) {
    await nextEvent(tx, ns, commandId, "dealer", "album.reopened");
  }
}

export type { SpecimenRow };
export { json };
