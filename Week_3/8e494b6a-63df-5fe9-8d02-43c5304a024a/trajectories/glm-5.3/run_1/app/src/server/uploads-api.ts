/**
 * Bulk upload (rule B) and file uploads, with per-line results and live progress.
 */
import type { Request, Response, Router } from "express";
import type { PoolClient } from "pg";
import { config } from "./config";
import { nowMs } from "./clock";
import { errors } from "./errors";
import { nextId, withDb } from "./db";
import {
  type StreamRow,
  STREAM_MAX_EVENTS,
  checkAndInfer,
  insertEvent,
  requireStream,
  streamEventCount,
  writeGenerationRow,
  eventsById,
} from "./events";
import { runPipeline, type Processor } from "./pipelines";
import { hitRate, keyStreamAllowed, loadContext, needKeyAction, needRole, rateIdentity, type Ctx } from "./context";
import { broadcastToSpace, nextSeq } from "./bus";
import { tailLine } from "./tail";
import { putObject, confirmObjectSize, uploadKey } from "./storage";
import { sha256Buffer } from "./auth";
import { flatten } from "../shared/util";
import { isIsoDate as isoDate } from "../shared/util";

declare module "express-serve-static-core" {
  interface Request {
    files?: Record<string, { name: string; data: Buffer }> | undefined;
  }
}

interface LineResult {
  line: number;
  status: "created" | "duplicate" | "dropped" | "failed";
  id?: string | undefined;
  error?: string | undefined;
}

interface Totals {
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
}

/** Process one parsed line through the pipeline, checks and the store (rule B order). */
async function processLine(
  db: PoolClient,
  ctx: Ctx,
  stream: StreamRow,
  genId: string,
  rawLine: string,
  lineNo: number,
  pipelineName: string | null,
  pipelineProcessors: Processor[] | null,
  totals: Totals,
  lines: LineResult[],
  seqBase: number,
): Promise<void> {
  if (rawLine.trim() === "") {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    await recordFailure(db, ctx, stream, rawLine, `Line ${lineNo}: not valid JSON.`);
    totals.failed += 1;
    lines.push({ line: lineNo, status: "failed", error: `Line ${lineNo}: not valid JSON.` });
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    await recordFailure(db, ctx, stream, rawLine, `Line ${lineNo}: not an object.`);
    totals.failed += 1;
    lines.push({ line: lineNo, status: "failed", error: `Line ${lineNo}: not an object.` });
    return;
  }
  let event = { ...(parsed as Record<string, unknown>) };
  if (pipelineName && pipelineProcessors) {
    const result = runPipeline(pipelineName, pipelineProcessors, event);
    if (result.outcome === "failed") {
      await recordFailure(db, ctx, stream, rawLine, result.error!);
      totals.failed += 1;
      lines.push({ line: lineNo, status: "failed", error: result.error });
      return;
    }
    if (result.outcome === "dropped") {
      totals.dropped += 1;
      lines.push({ line: lineNo, status: "dropped" });
      return;
    }
    event = result.event;
  }
  const ts = event["@timestamp"];
  if (ts === undefined) {
    await recordFailure(db, ctx, stream, rawLine, `Line ${lineNo}: @timestamp is missing.`);
    totals.failed += 1;
    lines.push({ line: lineNo, status: "failed", error: `Line ${lineNo}: @timestamp is missing.` });
    return;
  }
  if (typeof ts !== "string" || !isoDate(ts)) {
    await recordFailure(db, ctx, stream, rawLine, `Line ${lineNo}: @timestamp is not a date.`);
    totals.failed += 1;
    lines.push({ line: lineNo, status: "failed", error: `Line ${lineNo}: @timestamp is not a date.` });
    return;
  }
  const id = typeof event._id === "string" && event._id !== "" ? event._id : nextId();
  delete event._id;
  const existing = await eventsById(db, stream.id, id).catch(() => null);
  if (existing) {
    totals.duplicates += 1;
    lines.push({ line: lineNo, status: "duplicate", id });
    return;
  }
  const total = await streamEventCount(db, stream.id);
  if (total >= STREAM_MAX_EVENTS) {
    await recordFailure(db, ctx, stream, rawLine, `Line ${lineNo}: stream ${stream.name} is full at ${STREAM_MAX_EVENTS} events.`);
    totals.failed += 1;
    lines.push({ line: lineNo, status: "failed", error: `Line ${lineNo}: stream ${stream.name} is full at ${STREAM_MAX_EVENTS} events.` });
    return;
  }
  try {
    await checkAndInfer(db, genId, event);
  } catch (err) {
    if (err instanceof Error) {
      const sentence = /^field .* (expects .*|mixes types in one array\.)$/.test(err.message)
        ? `Line ${lineNo}: ${err.message}`
        : err.message;
      await recordFailure(db, ctx, stream, rawLine, sentence);
      totals.failed += 1;
      lines.push({ line: lineNo, status: "failed", error: sentence });
      return;
    }
    throw err;
  }
  await insertEvent(db, genId, {
    id,
    ts: new Date(ts),
    fields: event,
    pipeline: pipelineName ? `${pipelineName}@${pipelineVersion(pipelineName)}` : null,
    seq: seqBase,
  });
  totals.created += 1;
  lines.push({ line: lineNo, status: "created", id });
  tailLine({
    streamId: stream.id,
    body: {
      _id: id,
      "@timestamp": ts,
      _generation: 1,
      _phase: "hot",
      _pipeline: pipelineName,
      _score: null,
      fields: flatten(event),
      highlights: {},
    },
  });
}

async function recordFailure(db: PoolClient, ctx: Ctx, stream: StreamRow, raw: string, reason: string): Promise<void> {
  await db.query("INSERT INTO failures (stream_id, reason, raw, at) VALUES ($1,$2,$3,$4)", [
    stream.id,
    reason,
    raw,
    new Date(nowMs()),
  ]);
}

const pipelineVersionCache = new Map<string, number>();

function pipelineVersion(name: string): number {
  const cached = pipelineVersionCache.get(name);
  return cached ?? 1;
}

export function uploadRoutes(router: Router): void {
  router.post("/api/streams/:stream/bulk", async (req: Request, res: Response) => {
    const { ctx, db } = await withDb(async (db) => {
      const ctx = await loadContext(db, req, (req.query.space as string) ?? null);
      if (!ctx) throw errors.notFound();
      return { ctx, db };
    });
    needRole(ctx, "editor");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "upload", stream.name);
    keyStreamAllowed(ctx, stream.name);
    hitRate("upload", rateIdentity(ctx));
    if (req.headers["content-type"] !== "application/x-ndjson") {
      throw errors.uploadKind();
    }
    let pipelineName: string | null = null;
    let pipelineProcessors: Processor[] | null = null;
    if (typeof req.query.pipeline === "string" && req.query.pipeline !== "") {
      const found = await db.query<{ processors: Processor[]; version: number }>(
        "SELECT processors, version FROM pipelines WHERE space_id = $1 AND name = $2",
        [ctx.spaceId, req.query.pipeline],
      );
      if (found.rows.length === 0) throw errors.unknownPipeline(req.query.pipeline);
      pipelineName = req.query.pipeline;
      pipelineProcessors = found.rows[0].processors;
      pipelineVersionCache.set(pipelineName, found.rows[0].version);
    }
    const body = req.body as unknown as string;
    const rawLines = body.split("\n");
    const totals: Totals = { created: 0, duplicates: 0, dropped: 0, failed: 0 };
    const lines: LineResult[] = [];
    const write = await writeGenerationRow(db, stream.id);
    const seq = nextSeq(ctx.spaceId);
    for (let i = 0; i < rawLines.length; i += 1) {
      await processLine(
        db,
        ctx,
        stream,
        write.id,
        rawLines[i],
        i + 1,
        pipelineName,
        pipelineProcessors,
        totals,
        lines,
        seq,
      );
    }
    const storedTotal = await streamEventCount(db, stream.id);
    const failureTotal = Number(
      (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM failures WHERE stream_id = $1", [stream.id]))
        .rows[0].n,
    );
    broadcastToSpace(ctx.spaceId, "upload", {
      created: totals.created,
      duplicates: totals.duplicates,
      dropped: totals.dropped,
      failed: totals.failed,
      stored_total: storedTotal,
      failure_total: failureTotal,
    }, seq);
    res.json({
      created: totals.created,
      duplicates: totals.duplicates,
      dropped: totals.dropped,
      failed: totals.failed,
      lines,
      seq,
    });
  });

  router.post("/api/streams/:stream/uploads", async (req: Request, res: Response) => {
    const { ctx, db } = await withDb(async (db) => {
      const ctx = await loadContext(db, req, (req.query.space as string) ?? null);
      if (!ctx) throw errors.notFound();
      return { ctx, db };
    });
    needRole(ctx, "editor");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "upload", stream.name);
    keyStreamAllowed(ctx, stream.name);
    hitRate("upload", rateIdentity(ctx));
    if (!req.files || typeof req.files !== "object" || !("file" in req.files)) {
      throw errors.uploadKind();
    }
    const file = req.files.file;
    const sizeLimit = config().settings.upload_max_bytes;
    const bytes = file.data;
    if (bytes.length > sizeLimit) {
      throw errors.uploadTooLarge(sizeLimit);
    }
    const nameParts = file.name.split("/");
    const displayName = nameParts[nameParts.length - 1];
    if (!/\.ndjson$/i.test(displayName)) {
      throw errors.uploadKind();
    }
    const text = bytes.toString("utf8");
    if (bytes.includes(0)) {
      throw errors.uploadKind();
    }
    const firstNonWs = text.trimStart()[0];
    if (firstNonWs !== "{") {
      throw errors.uploadKind();
    }
    let pipelineName: string | null = null;
    let pipelineProcessors: Processor[] | null = null;
    const reqBody = req.body as Record<string, unknown>;
    const pipelinePart = typeof reqBody.pipeline === "string" ? reqBody.pipeline : null;
    if (pipelinePart && pipelinePart !== "None") {
      const found = await db.query<{ processors: Processor[]; version: number }>(
        "SELECT processors, version FROM pipelines WHERE space_id = $1 AND name = $2",
        [ctx.spaceId, pipelinePart],
      );
      if (found.rows.length === 0) throw errors.unknownPipeline(pipelinePart);
      pipelineName = pipelinePart;
      pipelineProcessors = found.rows[0].processors;
      pipelineVersionCache.set(pipelineName, found.rows[0].version);
    }
    const sha = sha256Buffer(bytes);
    const key = uploadKey(ctx.spaceSlug, sha);
    const put = await putObject(key, bytes);
    if (!put.ok) throw errors.storageUnavailable();
    const confirmed = await confirmObjectSize(key, bytes.length);
    if (!confirmed) throw errors.storageUnavailable();
    const uploadId = nextId();
    const rawLines = text.split("\n");
    const totalLines = rawLines.length > 0 && rawLines[rawLines.length - 1] === "" ? rawLines.length - 1 : rawLines.length;
    await db.query(
      `INSERT INTO uploads (id, stream_id, file, bytes, sha256, status, done_lines, total_lines, created_at)
       VALUES ($1,$2,$3,$4,$5,'kept',0,$6,now())`,
      [uploadId, stream.id, displayName, bytes.length, sha, totalLines],
    );
    const seq0 = nextSeq(ctx.spaceId);
    res.status(202).json({ id: uploadId, file: displayName, bytes: bytes.length, sha256: sha, status: "kept", seq: seq0 });

    // Parse asynchronously, sending progress messages.
    void (async () => {
      const totals: Totals = { created: 0, duplicates: 0, dropped: 0, failed: 0 };
      const lines: LineResult[] = [];
      await withDb(async (db2) => {
        const write = await writeGenerationRow(db2, stream.id);
        const step = config().settings.upload_progress_lines;
        for (let i = 0; i < rawLines.length; i += 1) {
          await processLine(db2, ctx, stream, write.id, rawLines[i], i + 1, pipelineName, pipelineProcessors, totals, lines, seq0);
          if ((i + 1) % step === 0 || i === rawLines.length - 1) {
            await db2.query("UPDATE uploads SET done_lines = $1 WHERE id = $2", [i + 1, uploadId]);
            const seq = nextSeq(ctx.spaceId);
            broadcastToSpace(ctx.spaceId, "upload", {
              upload_id: uploadId,
              file: displayName,
              done_lines: i + 1,
              total_lines: totalLines,
              created: totals.created,
              duplicates: totals.duplicates,
              dropped: totals.dropped,
              failed: totals.failed,
            }, seq);
          }
        }
        await db2.query(
          "UPDATE uploads SET status = 'done', done_lines = $1, created = $2, duplicates = $3, dropped = $4, failed = $5 WHERE id = $6",
          [totalLines, totals.created, totals.duplicates, totals.dropped, totals.failed, uploadId],
        );
        const storedTotal = await streamEventCount(db2, stream.id);
        const failureTotal = Number(
          (
            await db2.query<{ n: string }>("SELECT count(*)::text AS n FROM failures WHERE stream_id = $1", [
              stream.id,
            ])
          ).rows[0].n,
        );
        const seqEnd = nextSeq(ctx.spaceId);
        broadcastToSpace(ctx.spaceId, "upload", {
          upload_id: uploadId,
          file: displayName,
          done_lines: totalLines,
          total_lines: totalLines,
          ended: true,
          created: totals.created,
          duplicates: totals.duplicates,
          dropped: totals.dropped,
          failed: totals.failed,
          stored_total: storedTotal,
          failure_total: failureTotal,
        }, seqEnd);
      });
    })();
  });

  router.get("/api/streams/:stream/uploads", async (req: Request, res: Response) => {
    const { ctx, db } = await withDb(async (db) => {
      const ctx = await loadContext(db, req, (req.query.space as string) ?? null);
      if (!ctx) throw errors.notFound();
      return { ctx, db };
    });
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const rows = await db.query(
      "SELECT id, file, bytes, sha256, status, done_lines, total_lines, created, duplicates, dropped, failed FROM uploads WHERE stream_id = $1 ORDER BY created_at DESC, id DESC",
      [stream.id],
    );
    res.json({ uploads: rows.rows });
  });
}
