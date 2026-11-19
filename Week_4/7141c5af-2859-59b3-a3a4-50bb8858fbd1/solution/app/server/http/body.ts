import type { IncomingMessage } from "node:http";
import busboy from "busboy";
import { ApiError } from "./errors.ts";

const JSON_BODY_LIMIT = 1_000_000;
const OTHER_PARTS_LIMIT = 1_000_000;

export interface FileLimit {
  bytes: number;
  message: string;
}

interface UploadedFile {
  bytes: Buffer;
}

export interface ReadBody {
  raw: Buffer;
  form: { file: UploadedFile | null; fields: Record<string, string> } | null;
}

function tooLarge(message = "This request is over 1,000,000 bytes."): ApiError {
  return new ApiError(413, "tooLarge", message);
}

function declaredLength(req: IncomingMessage): number {
  return Number(req.headers["content-length"] ?? 0);
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > JSON_BODY_LIMIT) reject(tooLarge());
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Streams a multipart body, counting the file alone against its limit and everything else against the other parts'. */
function readForm(req: IncomingMessage, limit: FileLimit): Promise<ReadBody["form"]> {
  return new Promise((resolve, reject) => {
    const form: NonNullable<ReadBody["form"]> = { file: null, fields: {} };
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { fileSize: limit.bytes + 1, fieldSize: OTHER_PARTS_LIMIT, files: 8 } });
    } catch {
      resolve(null);
      req.resume();
      return;
    }
    let otherBytes = 0;
    parser.on("file", (field, stream) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        if (field !== "file") {
          otherBytes += chunk.length;
          if (otherBytes > OTHER_PARTS_LIMIT) reject(tooLarge(limit.message));
        } else if (!form.file) chunks.push(chunk);
      });
      stream.on("limit", () => {
        if (field === "file") reject(tooLarge(limit.message));
      });
      stream.on("end", () => {
        if (field === "file" && !form.file) form.file = { bytes: Buffer.concat(chunks) };
      });
    });
    parser.on("field", (name, value) => {
      otherBytes += Buffer.byteLength(value);
      if (otherBytes > OTHER_PARTS_LIMIT) reject(tooLarge(limit.message));
      form.fields[name] = value;
    });
    parser.on("close", () => resolve(form));
    parser.on("error", () => resolve(null));
    req.pipe(parser);
  });
}

/** Step 2 of the order: a body over its limit answers 413 before it is parsed and before authentication. */
export async function readBody(req: IncomingMessage, file: FileLimit | undefined): Promise<ReadBody> {
  const isForm = (req.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data");
  if (file && isForm) {
    if (declaredLength(req) > file.bytes + OTHER_PARTS_LIMIT + 65_536) throw tooLarge(file.message);
    return { raw: Buffer.alloc(0), form: await readForm(req, file) };
  }
  if (declaredLength(req) > JSON_BODY_LIMIT) throw tooLarge(file?.message);
  return { raw: await readRaw(req), form: null };
}
