// Intake files: streamed, judged by content before storing, Received only after MinIO confirms; downloads; unit decisions.
import { randomUUID } from "node:crypto";
import { Busboy, type BusboyHeaders, type BusboyInstance } from "@fastify/busboy";
import type { Readable } from "node:stream";
import { one, pool, rows, transaction, type Db } from "../db.js";
import { ApiError, FIELD_COPY, invalid } from "../errors.js";
import { answerAndDrain, type Context, type Reply } from "../http.js";
import { publishMeasurement } from "../queue.js";
import { deleteObject, getObject, MultipartUpload, objectSize, putObject } from "../storage.js";
import { loadEngagement, stageOf } from "./engagements.js";
import { inspectGlb } from "./glb.js";
import { scaledDimensions, needsUnitDecision, UNIT_SCALES, type UnitDecision } from "./measurement.js";
import { assertQuoteOpen } from "./states.js";

type Kind = "model" | "step" | "reference";
const KINDS: Record<string, { kind: Kind; stored: "glb" | "step" | "pdf"; cap: number; type: string }> = {
  glb: { kind: "model", stored: "glb", cap: 250_000_000, type: "model/gltf-binary" },
  step: { kind: "step", stored: "step", cap: 250_000_000, type: "model/step" },
  stp: { kind: "step", stored: "step", cap: 250_000_000, type: "model/step" },
  pdf: { kind: "reference", stored: "pdf", cap: 25_000_000, type: "application/pdf" },
};
const CONTENT_TYPES: Record<Kind, string> = { model: "model/gltf-binary", step: "model/step", reference: "application/pdf" };
const PART_BYTES = 8 * 1024 * 1024;
const STEP_SIGNATURE = Buffer.from("ISO-10303-21;");
const MAX_STEP_WHITESPACE = 1024 * 1024;

type IntakeFile = {
  id: string;
  name: string;
  kind: Kind;
  size_bytes: number;
  status: "received" | "superseded";
  measurement: "pending" | "delayed" | "measured" | "failed" | null;
  needs_unit_confirmation: boolean;
  unit: UnitDecision | null;
  dimensions_m: { x: number; y: number; z: number } | null;
  dimensions_mm: { x: number; y: number; z: number } | null;
};

type IntakeRow = {
  id: string;
  engagement_id: string;
  name: string;
  kind: Kind;
  extension: string;
  size_bytes: number;
  status: "received" | "superseded";
  measurement: IntakeFile["measurement"];
  unit_decision: UnitDecision | null;
  x_m: number | null;
  y_m: number | null;
  z_m: number | null;
};

const SELECT_FILE = `SELECT f.id, f.engagement_id, f.name, f.kind, f.extension, f.size_bytes, f.status, f.measurement, f.unit_decision, m.x_m, m.y_m, m.z_m
  FROM intake_files f LEFT JOIN measurements m ON m.intake_file_id = f.id AND m.outcome = 'measured'`;

const storageKey = (row: { engagement_id: string; id: string; extension: string }): string => `intake/${row.engagement_id}/${row.id}.${row.extension}`;

function toIntakeFile(row: IntakeRow): IntakeFile {
  const measured = row.kind === "model" && row.measurement === "measured" && row.x_m !== null && row.y_m !== null && row.z_m !== null;
  const metres = measured ? { x: row.x_m ?? 0, y: row.y_m ?? 0, z: row.z_m ?? 0 } : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    size_bytes: row.size_bytes,
    status: row.status,
    measurement: row.kind === "model" ? row.measurement : null,
    needs_unit_confirmation: metres !== null && row.unit_decision === null && needsUnitDecision(metres),
    unit: row.kind === "model" ? row.unit_decision : null,
    dimensions_m: metres,
    dimensions_mm: metres ? scaledDimensions(metres, row.unit_decision ?? "as_exported") : null,
  };
}

export async function intakeFiles(db: Db, engagementId: string): Promise<IntakeFile[]> {
  return (await rows<IntakeRow>(db, `${SELECT_FILE} WHERE f.engagement_id = $1 ORDER BY f.created_at, f.id`, [engagementId])).map(toIntakeFile);
}

export async function loadFile(db: Db, engagementId: string, fileId: string, lock = false): Promise<IntakeRow> {
  const row = await one<IntakeRow>(db, `${SELECT_FILE} WHERE f.engagement_id = $1 AND f.id::text = $2${lock ? " FOR NO KEY UPDATE OF f" : ""}`, [engagementId, fileId]);
  if (!row) throw new ApiError("not_found");
  return row;
}

/** The current model: the latest received GLB. */
export async function currentModel(db: Db, engagementId: string): Promise<IntakeFile | null> {
  const row = await one<IntakeRow>(db, `${SELECT_FILE} WHERE f.engagement_id = $1 AND f.kind = 'model' AND f.status = 'received' ORDER BY f.created_at DESC LIMIT 1`, [engagementId]);
  return row ? toIntakeFile(row) : null;
}

/** The uploaded name without directories, separators or control characters, cut to 120 characters. */
function displayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return Array.from(base.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")).slice(0, 120).join("") || "file";
}

/** Judges the first bytes; returns how many more bytes it needs, or 0 once the content is accepted. */
function judgeContent(extension: string, prefix: Buffer, ended: boolean): number {
  const kind = KINDS[extension]?.kind;
  if (kind === "model") {
    if (prefix.length < 4) {
      if (ended) throw new ApiError("file_type_mismatch");
      return 4;
    }
    if (prefix.subarray(0, 4).toString("latin1") !== "glTF") throw new ApiError("file_type_mismatch");
    const progress = inspectGlb(prefix);
    if (progress.needed > 0 && ended) throw new ApiError("gltf_malformed");
    return progress.needed;
  }
  if (kind === "reference") {
    if (prefix.length < 5) {
      if (ended) throw new ApiError("file_type_mismatch");
      return 5;
    }
    if (prefix.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ApiError("file_type_mismatch");
    return 0;
  }
  let start = 0;
  while (start < prefix.length && /\s/.test(String.fromCharCode(prefix[start] ?? 0))) start++;
  if (start > MAX_STEP_WHITESPACE) throw new ApiError("file_type_mismatch");
  if (prefix.length < start + STEP_SIGNATURE.length) {
    if (ended) throw new ApiError("file_type_mismatch");
    return start + STEP_SIGNATURE.length;
  }
  if (!prefix.subarray(start, start + STEP_SIGNATURE.length).equals(STEP_SIGNATURE)) throw new ApiError("file_type_mismatch");
  return 0;
}

type Stored = { id: string; extension: string; kind: Kind; name: string; size: number };

/** Streams one file part into MinIO under its key, judging content first and counting bytes against the cap. */
function streamToStorage(engagementId: string, fileName: string, stream: Readable, quoted: boolean, abandon: (cleanup: () => Promise<void>) => void): Promise<Stored> {
  return new Promise<Stored>((resolve, reject) => {
    const extension = (/\.([^.]+)$/.exec(fileName)?.[1] ?? "").toLowerCase();
    const spec = KINDS[extension];
    if (!spec) return reject(new ApiError("file_type_mismatch"));
    if (spec.kind === "model" && !quoted) return reject(new ApiError("quote_locked"));
    const id = randomUUID();
    const key = `intake/${engagementId}/${id}.${spec.stored}`;
    const upload = new MultipartUpload(key, spec.type);
    let prefix: Buffer[] = [];
    let prefixSize = 0;
    let judged = false;
    let needed = 0;
    let pending: Buffer[] = [];
    let pendingSize = 0;
    let total = 0;
    let glbLength = 0;
    let failed = false;
    const cleanup = async (): Promise<void> => {
      await upload.abort();
      await deleteObject(key);
    };
    abandon(cleanup);
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      stream.destroy();
      cleanup().finally(() => reject(error));
    };
    const judge = (ended: boolean): void => {
      const head = Buffer.concat(prefix);
      prefix = [head];
      needed = judgeContent(extension, head, ended);
      if (needed === 0) {
        judged = true;
        if (spec.kind === "model") glbLength = inspectGlb(head).totalLength;
        pending = [head];
        pendingSize = head.length;
        prefix = [];
      }
    };
    stream.on("data", (chunk: Buffer) => {
      if (failed) return;
      total += chunk.length;
      if (total > spec.cap) return fail(new ApiError("file_too_large"));
      try {
        if (!judged) {
          prefix.push(chunk);
          prefixSize += chunk.length;
          if (prefixSize >= needed) judge(false);
        } else {
          pending.push(chunk);
          pendingSize += chunk.length;
        }
      } catch (error) {
        return fail(error);
      }
      if (pendingSize >= PART_BYTES) {
        stream.pause();
        const part = Buffer.concat(pending);
        pending = [];
        pendingSize = 0;
        upload.part(part).then(() => stream.resume(), fail);
      }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (failed) return;
      (async () => {
        if (!judged) judge(true);
        if (spec.kind === "model" && total !== glbLength) throw new ApiError("gltf_malformed");
        const rest = Buffer.concat(pending);
        if (upload.started) {
          await upload.part(rest);
          await upload.complete();
        } else await putObject(key, rest, spec.type);
        if ((await objectSize(key)) !== total) throw new ApiError("storage_unavailable");
        return { id, extension: spec.stored, kind: spec.kind, name: displayName(fileName), size: total };
      })().then(resolve, fail);
    });
  });
}

/** POST /api/engagements/{id}/files: one multipart `file` part, Received only once MinIO confirms it. */
export async function receiveUpload(ctx: Context, brandId: string, engagementId: string): Promise<Reply> {
  const engagement = await loadEngagement(pool, engagementId, brandId);
  const quoted = stageOf(engagement).state === "quoted";
  const { req, res } = ctx;
  let cleanupAbandoned: (() => Promise<void>) | null = null;
  let finished = false;
  req.once("close", () => {
    if (!finished && !req.complete && cleanupAbandoned) void cleanupAbandoned();
  });
  let parser: BusboyInstance;
  try {
    parser = Busboy({ headers: req.headers as BusboyHeaders, limits: { files: 1, fields: 20, fieldSize: 1024 } });
  } catch {
    throw new ApiError("file_type_mismatch");
  }
  const stored = new Promise<Stored>((resolve, reject) => {
    let sawFile = false;
    parser.on("file", (name, stream, filename) => {
      if (name !== "file" || sawFile) return stream.resume();
      sawFile = true;
      streamToStorage(engagementId, filename ?? "", stream, quoted, (cleanup) => (cleanupAbandoned = cleanup)).then(resolve, reject);
    });
    parser.on("error", () => reject(new ApiError("file_type_mismatch")));
    parser.on("finish", () => {
      if (!sawFile) reject(new ApiError("file_type_mismatch"));
    });
  });
  req.pipe(parser);
  let file: Stored;
  try {
    file = await stored;
  } catch (error) {
    finished = true;
    req.unpipe(parser);
    if (!(error instanceof ApiError)) throw error;
    if (!req.complete) {
      answerAndDrain(req, res, error);
      return "sent";
    }
    throw error;
  }
  finished = true;
  const record = await transaction(async (client) => {
    if (file.kind === "model") {
      await client.query("UPDATE intake_files SET status = 'superseded' WHERE engagement_id = $1 AND kind = 'model' AND status = 'received'", [engagementId]);
    }
    await client.query(
      "INSERT INTO intake_files (id, engagement_id, name, kind, extension, size_bytes, status, measurement) VALUES ($1, $2, $3, $4, $5, $6, 'received', $7)",
      [file.id, engagementId, file.name, file.kind, file.extension, file.size, file.kind === "model" ? "pending" : null],
    );
    return file;
  });
  if (record.kind === "model") {
    try {
      await publishMeasurement({ intake_file_id: record.id });
    } catch {
      await pool.query("UPDATE intake_files SET measurement = 'delayed' WHERE id = $1 AND measurement = 'pending'", [record.id]);
    }
  }
  return { status: 201, body: toIntakeFile(await loadFile(pool, engagementId, record.id)) };
}

function contentDisposition(name: string): string {
  const fallback = Array.from(name).map((ch) => (ch.charCodeAt(0) > 127 || ch === '"' || ch === "\\" ? "_" : ch)).join("");
  const encoded = Array.from(Buffer.from(name, "utf8"))
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Streams the stored bytes back with the published download headers. */
export async function sendFileContent(ctx: Context, file: IntakeRow): Promise<Reply> {
  const { stream, size } = await getObject(storageKey(file));
  ctx.res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[file.kind],
    "Content-Length": String(size),
    "Content-Disposition": contentDisposition(file.name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (ctx.req.method === "HEAD") {
    stream.destroy();
    ctx.res.end();
  } else stream.pipe(ctx.res);
  return "sent";
}

/** PUT .../unit: the client's export-unit decision for a measured model while quoted. */
export async function decideUnit(brandId: string, engagementId: string, fileId: string, body: Record<string, unknown>): Promise<IntakeFile> {
  return transaction(async (client) => {
    const engagement = await loadEngagement(client, engagementId, brandId, true);
    const file = await loadFile(client, engagementId, fileId, true);
    assertQuoteOpen(stageOf(engagement));
    if (file.kind !== "model") throw invalid("unit", FIELD_COPY.unit_non_glb);
    if (file.measurement !== "measured") throw new ApiError("measurement_pending");
    const unit = body.unit;
    if (typeof unit !== "string" || !Object.hasOwn(UNIT_SCALES, unit)) throw invalid("unit", FIELD_COPY.unit);
    await client.query("UPDATE intake_files SET unit_decision = $2 WHERE id = $1", [fileId, unit]);
    return toIntakeFile(await loadFile(client, engagementId, fileId));
  });
}
