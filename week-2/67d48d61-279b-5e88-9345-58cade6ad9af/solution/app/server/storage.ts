// Plot storage in MinIO: SigV4-signed object calls, confirmed uploads, signed downloads.

import { createHash, createHmac, randomUUID } from "node:crypto";
import { ATTACHMENT_KINDS, FIELD_MESSAGES as M, UPLOAD_MAX_BYTES, taskId, type Attachment, type AttachmentKind } from "../shared/catalog.js";
import { bumped, readGraph, underLock } from "./changes.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ApiError, invalid, notFound, route } from "./http.js";
import { markService } from "./status.js";
import { ok, taskOrThrow } from "./tasks.js";

class StorageDown extends Error {}

const LINK_TTL_S = 60;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const locate = (key?: string): { origin: string; host: string; path: string } => {
  const base = new URL(config.s3.endpoint);
  const objectPath = key ? `/${key.split("/").map(encode).join("/")}` : "";
  if (config.s3.pathStyle) return { origin: base.origin, host: base.host, path: `/${config.s3.bucket}${objectPath}` };
  const host = `${config.s3.bucket}.${base.host}`;
  return { origin: `${base.protocol}//${host}`, host, path: objectPath || "/" };
};

const signature = (method: string, path: string, query: Record<string, string>, headers: Record<string, string>, payload: string, amzDate: string): { signedHeaders: string; signature: string; scope: string; query: string } => {
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join("&");
  const names = Object.keys(headers).sort();
  const canonical = [method, path, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = ["s3", "aws4_request"].reduce(
    (k, part) => hmac(k, part),
    hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region),
  );
  return { signedHeaders: names.join(";"), signature: hmac(key, toSign).toString("hex"), scope, query: canonicalQuery };
};

const stamp = (): string => new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");

const s3 = async (method: string, key?: string, body?: Buffer, contentType?: string): Promise<Response> => {
  const { origin, host, path } = locate(key);
  const amzDate = stamp();
  const payload = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const signed = signature(method, path, {}, headers, payload, amzDate);
  const { host: _host, ...sent } = headers;
  try {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${signed.scope}, SignedHeaders=${signed.signedHeaders}, Signature=${signed.signature}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    markService("plot_storage", res.status < 500);
    return res;
  } catch {
    markService("plot_storage", false);
    throw new StorageDown();
  }
};

const presignedGet = (key: string): string => {
  const { origin, host, path } = locate(key);
  const amzDate = stamp();
  const scope = `${amzDate.slice(0, 8)}/${config.s3.region}/s3/aws4_request`;
  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.s3.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(LINK_TTL_S),
    "X-Amz-SignedHeaders": "host",
  };
  const signed = signature("GET", path, query, { host }, "UNSIGNED-PAYLOAD", amzDate);
  return `${origin}${path}?${signed.query}&X-Amz-Signature=${signed.signature}`;
};

export const storageReachable = async (): Promise<boolean> => {
  try {
    return (await s3("HEAD")).ok;
  } catch {
    return false;
  }
};

const unavailable = (): ApiError =>
  new ApiError(503, "storage_unavailable", "Plot storage is unreachable. Attachments can't be uploaded or opened right now.");

interface Part {
  name: string;
  fileName: string | null;
  contentType: string | null;
  data: Buffer;
}

const parseMultipart = (raw: Buffer, contentType: string): Part[] => {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return [];
  const boundary = Buffer.from(`--${(match[1] ?? match[2]).trim()}`);
  const separator = Buffer.concat([Buffer.from("\r\n"), boundary]);
  const parts: Part[] = [];
  let at = raw.indexOf(boundary);
  while (at >= 0) {
    at += boundary.length;
    if (raw.subarray(at, at + 2).toString() === "--") break;
    const headEnd = raw.indexOf("\r\n\r\n", at);
    const next = headEnd < 0 ? -1 : raw.indexOf(separator, headEnd + 4);
    if (next < 0) return [];
    const head = raw.subarray(at + 2, headEnd).toString("utf8");
    const disposition = /content-disposition:[^\r\n]*/i.exec(head)?.[0] ?? "";
    parts.push({
      name: /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? "",
      fileName: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
      contentType: /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1].trim().toLowerCase() ?? null,
      data: raw.subarray(headEnd + 4, next),
    });
    at = next + 2;
  }
  return parts;
};

const SIGNATURES: Record<string, Buffer> = {
  "application/pdf": Buffer.from("%PDF-"),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
};

interface AttachmentRow {
  id: string;
  task: number;
  file_name: string;
  kind: AttachmentKind;
  size: string;
  content_type: string;
  object_key: string;
  created_at: Date;
}

const asAttachment = (row: AttachmentRow, current: boolean): Attachment => ({
  id: row.id,
  task: taskId(row.task),
  file_name: row.file_name,
  kind: row.kind,
  size: Number(row.size),
  content_type: row.content_type,
  created_at: row.created_at.toISOString(),
  current,
});

route("GET", "/api/tasks/:id/attachments", async (req) => {
  const { graph } = await readGraph();
  const n = taskOrThrow(graph, req.params[0]);
  const { rows } = await pool.query<AttachmentRow>("SELECT * FROM attachments WHERE task = $1 ORDER BY ordinal DESC", [n]);
  const seen = new Set<string>();
  const attachments = rows.map((row) => {
    const current = !seen.has(row.kind);
    seen.add(row.kind);
    return asAttachment(row, current);
  });
  return ok({ attachments });
});

route(
  "POST",
  "/api/tasks/:id/attachments",
  async (req) => {
    const parts = parseMultipart(req.raw, String(req.headers["content-type"]));
    const file = parts.find((p): p is Part & { fileName: string } => p.name === "file" && Boolean(p.fileName));
    if (file && file.data.length > UPLOAD_MAX_BYTES) throw new ApiError(413, "payload_too_large", "Files are limited to 10,000,000 bytes.");
    const kind = parts.find((p) => p.name === "kind")?.data.toString("utf8").trim() ?? "";
    const n = taskOrThrow((await readGraph()).graph, req.params[0]);
    const fields: Record<string, string> = { ...req.headerErrors };
    const signatureOf = file?.contentType ? SIGNATURES[file.contentType] : undefined;
    if (!file || !signatureOf || !file.data.subarray(0, signatureOf.length).equals(signatureOf)) fields.file = M.file;
    if (!(ATTACHMENT_KINDS as readonly string[]).includes(kind)) fields.kind = M.kind;
    if (!file || Object.keys(fields).length) throw invalid(fields);
    const id = randomUUID();
    const fileName = file.fileName;
    const objectKey = `tasks/${taskId(n)}/${id}/${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    try {
      const put = await s3("PUT", objectKey, file.data, file.contentType as string);
      const head = put.ok ? await s3("HEAD", objectKey) : null;
      if (!head?.ok || Number(head.headers.get("content-length")) !== file.data.length) {
        if (put.ok) await s3("DELETE", objectKey);
        throw unavailable();
      }
    } catch (error) {
      if (error instanceof StorageDown) throw unavailable();
      throw error;
    }
    try {
      return await underLock(req, async (w) => {
        const { rows } = await w.client.query<AttachmentRow>(
          `INSERT INTO attachments (id, task, file_name, kind, size, content_type, object_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [id, n, fileName, kind, file.data.length, file.contentType, objectKey],
        );
        const attachment = asAttachment(rows[0], true);
        await w.commit({
          kind: "attachment",
          actor: req.actor,
          after: w.graph.with(bumped(w.graph, [n], new Date())),
          saved: [n],
          activity: [{ task: n, kind: "attached", actor: req.actor, changes: { attachment: { from: null, to: fileName } } }],
          undoable: false,
          attachment,
        });
        return ok({ attachment }, 201);
      });
    } catch (error) {
      await s3("DELETE", objectKey).catch(() => undefined);
      throw error;
    }
  },
  true,
);

route("GET", "/api/attachments/:id/download", async (req) => {
  const id = req.params[0];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("That attachment");
  const { rows } = await pool.query<AttachmentRow>("SELECT * FROM attachments WHERE id = $1", [id]);
  if (!rows[0]) throw notFound("That attachment");
  let head: Response;
  try {
    head = await s3("HEAD", rows[0].object_key);
  } catch {
    throw unavailable();
  }
  if (head.status === 404) throw notFound("That attachment's file");
  if (!head.ok) throw unavailable();
  return { status: 302, body: {}, headers: { Location: presignedGet(rows[0].object_key) } };
});
