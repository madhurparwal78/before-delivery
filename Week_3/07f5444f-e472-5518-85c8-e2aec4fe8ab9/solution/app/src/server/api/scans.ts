// Scans: filing marked-part scans and bowing masters in the score store, listing and downloading them.

import { createHash, randomUUID } from "node:crypto";
import type { ScanKind } from "../../shared/api.js";
import { visiblePart } from "../access.js";
import { pool, rows, transaction } from "../db.js";
import { contentDisposition, decodeUploadFileName, fileNameProblem } from "../domain/fileName.js";
import { ApiError, conflict, forbidden, invalid, notFound, storageUnavailable } from "../errors.js";
import { route } from "../http.js";
import { authenticate, hasRole, ownSectionPart, requireRole, type Person } from "../people.js";
import { SCAN_SELECT, scanJson, type ScanRow } from "../readModel.js";
import { deleteObject, getObject, putConfirmed } from "../scoreStore.js";
import { readIdempotencyKey } from "../validate.js";

const SIGNATURES: Record<string, Buffer> = {
  "application/pdf": Buffer.from("%PDF-"),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
};

function signatureMatches(contentType: string, data: Buffer): boolean {
  const signature = SIGNATURES[contentType];
  return signature !== undefined && data.subarray(0, signature.length).equals(signature);
}

const KINDS: readonly ScanKind[] = ["marked_part", "bowing_master"];

/** Marked-part scans: librarians. Bowing masters: the section principal of the part's section. */
function mayUpload(person: Person, kind: ScanKind, partChairKey: string): boolean {
  return kind === "marked_part" ? hasRole(person, "PA") : ownSectionPart(person, partChairKey);
}

route("POST", "/api/parts/{id}/scans", "multipart", async (request) => {
  const person = await authenticate(pool, request);
  const { model, work, part } = await visiblePart(pool, person, request.params.id ?? "");
  const form = request.body.kind === "multipart" ? request.body.form : null;
  const kind = KINDS.find((k) => k === form?.fields.kind);
  if (kind ? !mayUpload(person, kind, part.chair_key) : !KINDS.some((k) => mayUpload(person, k, part.chair_key))) {
    throw forbidden();
  }
  const file = form?.file ?? null;
  const fileName = file ? decodeUploadFileName(file.filename) : "";
  const sha256 = createHash("sha256").update(file?.data ?? Buffer.alloc(0)).digest("hex");
  const key = readIdempotencyKey(request.headers["idempotency-key"]);

  const scan = await transaction(async (client) => {
    if (key !== null) {
      const claimed = await client.query(
        `INSERT INTO scan_upload_keys (person_id, idempotency_key, part_id, kind, file_name, sha256)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [person.id, key, part.id, kind ?? "", fileName, sha256],
      );
      if (claimed.rowCount === 0) {
        const [stored] = await rows<{ part_id: string; kind: string; file_name: string; sha256: string; response: unknown }>(
          client,
          "SELECT part_id, kind, file_name, sha256, response FROM scan_upload_keys WHERE person_id = $1 AND idempotency_key = $2",
          [person.id, key],
        );
        if (stored?.part_id === part.id && stored.kind === kind && stored.file_name === fileName && stored.sha256 === sha256) {
          return stored.response;
        }
        throw conflict("idempotency_key_reused", "That Idempotency-Key was already used for a different upload.");
      }
    }
    if (form === null) throw invalid({ file: "Send the scan as multipart form data with kind and file." });
    if (file && (SIGNATURES[file.contentType] === undefined || (file.data.length > 0 && !signatureMatches(file.contentType, file.data)))) {
      throw new ApiError(415, { error: "unsupported_file_type", message: "Only PDF, PNG or JPEG files can be filed." });
    }
    const errors: Record<string, string> = {};
    if (!kind) errors.kind = "Choose marked_part or bowing_master.";
    const problem = file ? (file.data.length === 0 ? "The file is empty." : fileNameProblem(fileName)) : "Choose a file to file.";
    if (problem) errors.file = problem;
    if (!kind || !file || problem) throw invalid(errors);

    const id = `scan-${randomUUID()}`;
    const objectKey = `scans/${model.row.id}/${work.row.id}/${part.id}/${id}`;
    if (!(await putConfirmed(objectKey, file.data, file.contentType))) {
      await deleteObject(objectKey);
      throw storageUnavailable();
    }
    try {
      const [filed] = await rows<{ filed_at: number }>(
        client,
        `INSERT INTO scans (id, part_id, kind, file_name, content_type, size_bytes, sha256, object_key, filed_at, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9) RETURNING filed_at`,
        [id, part.id, kind, fileName, file.contentType, file.data.length, sha256, objectKey, person.id],
      );
      const row: ScanRow = {
        id,
        part_id: part.id,
        kind,
        file_name: fileName,
        content_type: file.contentType,
        size_bytes: file.data.length,
        sha256,
        object_key: objectKey,
        filed_at: filed?.filed_at ?? Date.now(),
        uploaded_by: person.id,
        uploaded_by_name: person.name,
      };
      const response = { scan: scanJson(row) };
      if (key !== null) {
        await client.query("UPDATE scan_upload_keys SET response = $3 WHERE person_id = $1 AND idempotency_key = $2", [
          person.id,
          key,
          JSON.stringify(response),
        ]);
      }
      return response;
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
  });
  return { status: 201, json: scan };
});

route("GET", "/api/parts/{id}/scans", "none", async (request) => {
  const person = await authenticate(pool, request);
  const { part } = await visiblePart(pool, person, request.params.id ?? "");
  requireRole(person, "PAS");
  const found = await rows<ScanRow>(pool, `${SCAN_SELECT} WHERE s.part_id = $1 ORDER BY s.filed_at DESC, s.id DESC`, [part.id]);
  return { status: 200, json: { scans: found.map(scanJson) } };
});

route("GET", "/api/scans/{id}/file", "none", async (request) => {
  const person = await authenticate(pool, request);
  const [scan] = await rows<ScanRow>(pool, "SELECT * FROM scans WHERE id = $1", [request.params.id ?? ""]);
  if (!scan) throw notFound();
  await visiblePart(pool, person, scan.part_id);
  if (person.role === "player" && scan.kind !== "marked_part") throw notFound();
  const data = await getObject(scan.object_key);
  if (data === null) throw storageUnavailable();
  return {
    status: 200,
    bytes: { data, contentType: scan.content_type, disposition: contentDisposition(scan.file_name) },
  };
});
