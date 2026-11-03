// Prep material and credential scans: stored in MinIO, served only through the app to who may see them.
import { randomUUID } from "node:crypto";
import type { CredentialView } from "../../shared/api.js";
import type { CredentialType, RequestStatus } from "../../shared/domain.js";
import { agencyDate } from "../../shared/time.js";
import { audit } from "../audit.js";
import { one, pool, rows, transaction } from "../db.js";
import { credentialStatus, derivedStatus, isCancelled, PREP_OPEN } from "../domain/rules.js";
import { credentialFields } from "../domain/validation.js";
import { ApiError, invalid } from "../errors.js";
import { route, UPLOAD_LIMIT, json, type AuthedCtx, type Reply } from "../http.js";
import { getObject, putObject } from "../storage.js";
import { warnCredentials } from "../sweep.js";
import { acceptedType, cleanFilename, type Part } from "../uploads.js";
import { idParam, visibleRequest } from "./common.js";

function filePart(ctx: AuthedCtx, name: string): Part | undefined {
  return ctx.parts.find((p) => p.name === name && p.filename !== null);
}

function download(bytes: Buffer, contentType: string, filename: string): Reply {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return {
    status: 200,
    bytes,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  };
}

route(
  "POST",
  "/api/requests/:id/prep",
  ["requester"],
  async (ctx) => {
    const row = await visibleRequest(pool, ctx.user, idParam(ctx, "id"));
    const status = derivedStatus(row.status, row.end_at, new Date());
    if (!PREP_OPEN.includes(status)) throw new ApiError("invalid_transition", { from: status });
    const part = filePart(ctx, "file");
    if (!part) throw invalid({ file: "Choose a file to attach." });
    if (part.data.length > UPLOAD_LIMIT) throw new ApiError("payload_too_large", {}, `${part.filename} is too large.`);
    const contentType = acceptedType(part, ["pdf", "docx", "pptx", "text", "png", "jpeg"]);
    const id = randomUUID();
    const filename = cleanFilename(part.filename ?? "");
    const key = `prep/${row.org_id}/${row.id}/${id}/${filename}`;
    await putObject(key, part.data, contentType);
    await pool.query("INSERT INTO prep_files (id, request_id, filename, size, content_type, object_key) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      row.id,
      filename,
      part.data.length,
      contentType,
      key,
    ]);
    return json(201, { file: { id, filename, size: part.data.length, content_type: contentType } });
  },
  "multipart",
);

route("GET", "/api/prep/:id", "signed-in", async (ctx) => {
  const file = await one<{ request_id: string; org_id: string; status: RequestStatus; filename: string; content_type: string; object_key: string }>(
    pool,
    `SELECT p.request_id, r.org_id, r.status, p.filename, p.content_type, p.object_key
     FROM prep_files p JOIN requests r ON r.id = p.request_id WHERE p.id = $1`,
    [idParam(ctx, "id")],
  );
  const user = ctx.user;
  let allowed = false;
  if (file) {
    if (user.role === "coordinator" || user.role === "billing") allowed = true;
    if (user.role === "requester") allowed = user.org_id === file.org_id;
    if (user.role === "interpreter" && !isCancelled(file.status)) {
      allowed = !!(await one(
        pool,
        "SELECT 1 FROM seats s JOIN offers o ON o.seat_id = s.id WHERE s.request_id = $1 AND o.status = 'accepted' AND o.interpreter_id = $2",
        [file.request_id, user.id],
      ));
    }
  }
  if (!file || !allowed) throw new ApiError("not_found");
  const bytes = await getObject(file.object_key);
  if (!bytes) throw new ApiError("not_found");
  return download(bytes, file.content_type, file.filename);
});

interface CredentialRow {
  id: string;
  type: CredentialType;
  number: string;
  expires_on: string;
}

function credentialView(c: CredentialRow, today: string): CredentialView {
  return { id: c.id, type: c.type, number: c.number, expires_on: c.expires_on, status: credentialStatus(c.expires_on, today) };
}

route("GET", "/api/interpreters/me/credentials", ["interpreter"], async (ctx) => {
  const found = await rows<CredentialRow>(
    pool,
    "SELECT id, type, number, expires_on FROM credentials WHERE interpreter_id = $1 ORDER BY type, expires_on DESC, created_at",
    [ctx.user.id],
  );
  const today = agencyDate(new Date());
  return json(200, { credentials: found.map((c) => credentialView(c, today)) });
});

route(
  "POST",
  "/api/interpreters/me/credentials",
  ["interpreter"],
  async (ctx) => {
    const values: Record<string, string> = {};
    for (const part of ctx.parts) if (part.filename === null) values[part.name] = part.data.toString("utf8");
    const scan = filePart(ctx, "scan");
    if (scan && scan.data.length > UPLOAD_LIMIT) throw new ApiError("payload_too_large", {}, `${scan.filename} is too large.`);
    const { scan: file, ...fields } = credentialFields(values, scan);
    const contentType = acceptedType(file, ["pdf", "png", "jpeg"]);
    const id = randomUUID();
    const filename = cleanFilename(file.filename ?? "");
    const key = `credentials/${ctx.user.id}/${id}/${filename}`;
    await putObject(key, file.data, contentType);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO credentials (id, interpreter_id, type, number, expires_on, scan_filename, scan_content_type, scan_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, ctx.user.id, fields.type, fields.number, fields.expiresOn, filename, contentType, key],
      );
      await audit(client, {
        actorId: ctx.user.id,
        action: "credential.added",
        entity: "credential",
        entityId: id,
        requestId: null,
        detail: { type: fields.type, number: fields.number, expires_on: fields.expiresOn },
      });
    });
    await warnCredentials();
    const credential = credentialView({ id, type: fields.type, number: fields.number, expires_on: fields.expiresOn }, agencyDate(new Date()));
    return json(201, { credential });
  },
  "multipart",
);

route("GET", "/api/credentials/:id/scan", "signed-in", async (ctx) => {
  const scan = await one<{ interpreter_id: string; scan_key: string; scan_filename: string; scan_content_type: string }>(
    pool,
    "SELECT interpreter_id, scan_key, scan_filename, scan_content_type FROM credentials WHERE id = $1",
    [idParam(ctx, "id")],
  );
  const allowed = scan && (ctx.user.role === "coordinator" || ctx.user.id === scan.interpreter_id);
  if (!scan || !allowed) throw new ApiError("not_found");
  const bytes = await getObject(scan.scan_key);
  if (!bytes) throw new ApiError("not_found");
  return download(bytes, scan.scan_content_type, scan.scan_filename);
});
