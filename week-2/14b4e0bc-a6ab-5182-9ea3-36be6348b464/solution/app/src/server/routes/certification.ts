import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { loadSamples, loadSnapshot, type AssetState, type Certification, type Snapshot } from "../catalog.ts";
import { pool, readSnapshot, type Tx } from "../db.ts";
import { ApiError, conflict, evidenceUnavailable, forbidden, inPrecedence, invalid, notFound, type Checks } from "../errors.ts";
import { acceptEvidence, parseMultipart, type AcceptedEvidence } from "../evidence.ts";
import { MULTIPART_LIMIT, readBody, type Context, type Reply, type Route } from "../http.ts";
import { fingerprint, idempotent } from "../idempotency.ts";
import { cancelNotices, queueNotices, queuedCount, type Owner } from "../notices.ts";
import { may } from "../permissions.ts";
import { contentDisposition, noneMatch, planRange } from "../ranges.ts";
import { deleteObject, getObject, putObject, StoreUnavailable } from "../s3.ts";
import { deliverNotices, markEvidenceDown } from "../status.ts";
import { codePoints, type Role } from "../text.ts";
import { assetDetail } from "../views.ts";
import { commitWrite } from "../write.ts";

type Move = "verified" | "deprecated" | "draft";

/** The certification state machine (DP-61), decided here only. */
const LEGAL: Record<Move, AssetState[]> = { verified: ["draft"], deprecated: ["draft", "verified"], draft: ["deprecated"] };

function checkMove(assetId: string, from: AssetState, to: Move): void {
  if (!LEGAL[to].includes(from)) throw conflict("invalid_transition", `Cannot move ${assetId} from ${from} to ${to}.`);
}

/** Verification is blocked by any deprecated transitive upstream, checked before upload and at commit (DP-58). */
function checkUpstream(snapshot: Snapshot, assetId: string): void {
  const upstream = snapshot.deprecatedUpstream.get(assetId);
  if (upstream) throw conflict("upstream_deprecated", `Verification blocked: upstream ${upstream} is deprecated.`);
}

async function requireAsset(id: string): Promise<void> {
  if (!(await pool.query("select 1 from assets where id = $1", [id])).rowCount) throw notFound();
}

/** The asset exists and the caller may curate it. */
function curatorAccess(ctx: Context, assetId: string): Checks {
  return {
    async existence() {
      await requireAsset(assetId);
    },
    permission() {
      if (!may.curate(ctx.actor.role)) throw forbidden();
    },
  };
}

async function detailIn(tx: Tx, assetId: string, role: Role) {
  const snapshot = await loadSnapshot(tx, null);
  return assetDetail(snapshot, assetId, await loadSamples(tx, snapshot.assetColumns.get(assetId) ?? []), role);
}

async function closeCertification(tx: Tx, assetId: string, seq: number) {
  return (await tx.query("update certifications set to_seq = $2 where asset_id = $1 and to_seq is null returning *", [assetId, seq])).rows[0];
}

async function verify(ctx: Context): Promise<Reply> {
  const assetId = ctx.params.id;
  let bodyRead: Promise<AcceptedEvidence> | null = null;
  const submission = () =>
    (bodyRead ??= readBody(ctx.req, MULTIPART_LIMIT).then((raw) => acceptEvidence(parseMultipart(ctx.req.headers["content-type"], raw))));
  const access = curatorAccess(ctx, assetId);
  try {
    return await idempotent(ctx, "verify", assetId, {
      async fingerprint() {
        const raw = await submission().catch((error) => {
          if (error instanceof ApiError && error.status === 422) return null;
          throw error;
        });
        return raw ? fingerprint([createHash("sha256").update(raw.bytes).digest("hex"), raw.filename, raw.note]) : "invalid";
      },
      access,
      async run() {
        let evidence!: AcceptedEvidence;
        await inPrecedence({
          ...access,
          async state() {
            const pre = await readSnapshot((tx) => loadSnapshot(tx, null));
            checkMove(assetId, pre.certs.get(assetId)!.state, "verified");
            checkUpstream(pre, assetId);
          },
          async validation() {
            evidence = await submission();
          },
        });
        const sha256 = createHash("sha256").update(evidence.bytes).digest("hex");
        const evidenceId = randomUUID();
        const objectKey = `evidence/${assetId}/${evidenceId}`;
        try {
          await putObject(objectKey, evidence.bytes, evidence.contentType);
        } catch (error) {
          if (error instanceof StoreUnavailable) {
            markEvidenceDown();
            await deleteObject(objectKey).catch(() => undefined);
            throw evidenceUnavailable();
          }
          throw error;
        }
        try {
          const detail = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, at, actor }) => {
            const snapshot = await loadSnapshot(tx, null);
            await inPrecedence({
              state() {
                checkMove(assetId, snapshot.certs.get(assetId)!.state, "verified");
                checkUpstream(snapshot, assetId);
              },
            });
            await tx.query(
              `insert into evidence(id, asset_id, object_key, filename, content_type, size_bytes, sha256, uploaded_at, uploaded_by)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [evidenceId, assetId, objectKey, evidence.filename, evidence.contentType, evidence.bytes.length, sha256, at, actor.id],
            );
            await closeCertification(tx, assetId, seq);
            await tx.query(
              "insert into certifications(asset_id, state, verified_at, evidence_id, from_seq) values ($1, 'verified', $2, $3, $4)",
              [assetId, at, evidenceId, seq],
            );
            return {
              audit: {
                action: "certification.verify", targetType: "asset", targetId: assetId, before: { state: "draft" },
                after: { state: "verified", evidence_sha256: sha256, filename: evidence.filename, content_type: evidence.contentType, size_bytes: evidence.bytes.length },
              },
              result: await detailIn(tx, assetId, actor.role),
            };
          });
          return { status: 200, body: detail };
        } catch (error) {
          await deleteObject(objectKey).catch(() => undefined);
          throw error;
        }
      },
    });
  } finally {
    if (!bodyRead) ctx.res.setHeader("Connection", "close");
  }
}

async function download(ctx: Context): Promise<Reply | null> {
  const assetId = ctx.params.id;
  const head = ctx.req.method === "HEAD";
  let found = null as Certification["evidence"];
  await inPrecedence({
    async existence() {
      found = await readSnapshot(async (tx) => {
        if (!(await tx.query("select 1 from assets where id = $1", [assetId])).rowCount) throw notFound();
        return (await loadSnapshot(tx, null)).certs.get(assetId)!.evidence;
      });
      if (!found) throw notFound();
    },
    permission() {
      if (!may.downloadEvidence(ctx.actor.role)) throw forbidden();
    },
  });
  const record = found!;
  const etag = `"${record.sha256}"`;
  const size = record.size_bytes;
  if (noneMatch(ctx.req.headers["if-none-match"], etag)) {
    return { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-store" } };
  }
  const plan = planRange(ctx.req.headers.range, ctx.req.headers["if-range"] as string | undefined, etag, size);
  await inPrecedence({
    validation() {
      if (plan.kind !== "unsatisfiable") return;
      throw new ApiError(416, "range_not_satisfiable", "Requested range is outside the evidence file.", undefined, {
        "Content-Range": `bytes */${size}`,
        "Cache-Control": "private, no-store",
      });
    },
  });
  let object: Response;
  try {
    object = await getObject(record.objectKey);
  } catch (error) {
    if (error instanceof StoreUnavailable) {
      markEvidenceDown();
      throw evidenceUnavailable();
    }
    throw error;
  }
  const ranges = plan.kind === "partial" ? plan.ranges : [[0, size - 1] as [number, number]];
  const boundary = randomBytes(16).toString("hex");
  const multipart = ranges.length > 1;
  const partHead = ([a, b]: [number, number]) =>
    Buffer.from(`--${boundary}\r\nContent-Type: ${record.content_type}\r\nContent-Range: bytes ${a}-${b}/${size}\r\n\r\n`);
  const closing = Buffer.from(`--${boundary}--\r\n`);
  const length = multipart
    ? ranges.reduce((n, r) => n + partHead(r).length + (r[1] - r[0] + 1) + 2, closing.length)
    : ranges[0][1] - ranges[0][0] + 1;
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Content-Disposition": contentDisposition(record.filename),
    "Content-Type": multipart ? `multipart/byteranges; boundary=${boundary}` : record.content_type,
    "Content-Length": String(length),
    "X-Content-Type-Options": "nosniff",
  };
  if (plan.kind === "partial" && !multipart) headers["Content-Range"] = `bytes ${ranges[0][0]}-${ranges[0][1]}/${size}`;
  const status = plan.kind === "partial" ? 206 : 200;
  if (head) {
    await object.body?.cancel();
    ctx.res.writeHead(status, headers);
    ctx.res.end();
    return null;
  }
  try {
    await commitWrite(ctx.actor, may.downloadEvidence, async () => ({
      audit: {
        action: "evidence.download", targetType: "asset", targetId: assetId, before: null,
        after: { evidence_sha256: record.sha256, range: plan.kind === "partial" ? ranges.map(([a, b]) => `${a}-${b}`).join(",") : null },
      },
      result: null,
    }));
  } catch (error) {
    await object.body?.cancel();
    throw error;
  }
  ctx.res.writeHead(status, headers);
  await streamRanges(ctx, object, ranges, multipart ? partHead : null, multipart ? closing : null);
  return null;
}

/** Waits for the response to drain or close, leaving no listener behind. */
function drainOrClose(res: Context["res"]): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off("drain", done).off("close", done);
      resolve();
    };
    res.on("drain", done).on("close", done);
  });
}

/** One sequential pass over the stored object, sending only the merged ranges. */
async function streamRanges(
  ctx: Context,
  object: Response,
  ranges: [number, number][],
  partHead: ((r: [number, number]) => Buffer) | null,
  closing: Buffer | null,
): Promise<void> {
  const source = Readable.fromWeb(object.body! as import("node:stream/web").ReadableStream<Uint8Array>);
  const abandon = () => source.destroy();
  ctx.res.on("close", abandon);
  let offset = 0;
  let index = 0;
  let headed = false;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      if (ctx.res.destroyed) break;
      const end = offset + chunk.length;
      while (index < ranges.length) {
        const [a, b] = ranges[index];
        if (a >= end) break;
        if (partHead && !headed) {
          ctx.res.write(partHead(ranges[index]));
          headed = true;
        }
        const from = Math.max(a, offset) - offset;
        const to = Math.min(b + 1, end) - offset;
        if (to > from && !ctx.res.write(chunk.subarray(from, to))) await drainOrClose(ctx.res);
        if (b + 1 <= end) {
          if (partHead) ctx.res.write("\r\n");
          index++;
          headed = false;
        } else break;
      }
      offset = end;
      if (index >= ranges.length) break;
    }
    if (closing && !ctx.res.destroyed) ctx.res.write(closing);
    ctx.res.end();
  } catch {
    ctx.res.destroy();
  } finally {
    ctx.res.off("close", abandon);
    source.destroy();
  }
}

async function ownersOf(tx: Tx): Promise<Map<string, Owner>> {
  const { rows } = await tx.query("select id, name, email from users");
  return new Map(rows.map((r: Owner) => [r.id, r]));
}

async function deprecate(ctx: Context): Promise<Reply> {
  const assetId = ctx.params.id;
  const access = curatorAccess(ctx, assetId);
  const reasonSent = () => ctx.json().reason;
  const reply = await idempotent(ctx, "deprecate", assetId, {
    fingerprint: async () => fingerprint([reasonSent()]),
    access,
    async run() {
      await inPrecedence(access);
      const body = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, at, actor }) => {
        const before = await loadSnapshot(tx, null);
        const from = before.certs.get(assetId)!.state;
        let reason = "";
        await inPrecedence({
          state() {
            checkMove(assetId, from, "deprecated");
          },
          validation() {
            const raw = reasonSent();
            reason = typeof raw === "string" ? raw.trim() : "";
            if (codePoints(reason) < 1 || codePoints(reason) > 500) throw invalid({ reason: "Give a reason of 1 to 500 characters." });
          },
        });
        const eventId = randomUUID();
        await tx.query("insert into deprecation_events(id, asset_id, reason, at, by_id) values ($1, $2, $3, $4, $5)", [
          eventId, assetId, reason, at, actor.id,
        ]);
        const previous = await closeCertification(tx, assetId, seq);
        await tx.query(
          `insert into certifications(asset_id, state, verified_at, evidence_id, deprecation_id, from_seq)
           values ($1, 'deprecated', $2, $3, $4, $5)`,
          [assetId, previous.verified_at, previous.evidence_id, eventId, seq],
        );
        const after = await loadSnapshot(tx, null);
        const queued = await queueNotices(tx, after, assetId, eventId, actor.name, reason, await ownersOf(tx));
        return {
          audit: { action: "certification.deprecate", targetType: "asset", targetId: assetId, before: { state: from }, after: { state: "deprecated", reason } },
          result: {
            asset: assetDetail(after, assetId, await loadSamples(tx, after.assetColumns.get(assetId) ?? []), actor.role),
            notices_queued: queued,
            queued_notices: await queuedCount(tx),
          },
        };
      });
      return { status: 200, body };
    },
  });
  void deliverNotices();
  return reply;
}

async function reinstate(ctx: Context): Promise<Reply> {
  const assetId = ctx.params.id;
  await inPrecedence({
    async existence() {
      await requireAsset(assetId);
    },
  });
  const body = await commitWrite(ctx.actor, may.administer, async ({ tx, seq, actor }) => {
    const from = (await loadSnapshot(tx, null)).certs.get(assetId)!.state;
    await inPrecedence({
      state() {
        checkMove(assetId, from, "draft");
      },
    });
    await closeCertification(tx, assetId, seq);
    await tx.query("insert into certifications(asset_id, state, from_seq) values ($1, 'draft', $2)", [assetId, seq]);
    const cancelled = await cancelNotices(tx, assetId);
    return {
      audit: { action: "certification.reinstate", targetType: "asset", targetId: assetId, before: { state: "deprecated" }, after: { state: "draft", notices_cancelled: cancelled } },
      result: { asset: await detailIn(tx, assetId, actor.role), notices_cancelled: cancelled, queued_notices: await queuedCount(tx) },
    };
  });
  return { status: 200, body };
}

export const certificationRoutes: Route[] = [
  { method: "POST", pattern: "/api/assets/:id/verify", streamsBody: true, handler: verify },
  { method: "GET", pattern: "/api/assets/:id/evidence", handler: download },
  { method: "HEAD", pattern: "/api/assets/:id/evidence", handler: download },
  { method: "POST", pattern: "/api/assets/:id/deprecate", handler: deprecate },
  { method: "POST", pattern: "/api/assets/:id/reinstate", handler: reinstate },
];
