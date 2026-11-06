import type { Request } from "express";
import busboy from "busboy";
import { errors } from "./errors.js";

export const JSON_LIMIT_BYTES = 1_000_000;

/** Reads a JSON body enforcing Content-Type and size. Throws errors in the ladder order. */
export function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!/^application\/json(;|$)/.test(contentType)) {
      reject(errors.unsupportedMediaType());
      return;
    }
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > JSON_LIMIT_BYTES) {
      reject(errors.tooLarge(JSON_LIMIT_BYTES));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > JSON_LIMIT_BYTES) {
        reject(errors.tooLarge(JSON_LIMIT_BYTES));
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(errors.badJson());
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(errors.badJson());
      }
    });
    req.on("error", () => reject(errors.badJson()));
  });
}

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
}

/** Reads a multipart body with one `file` part, enforcing the limit. */
export function readMultipartFile(req: Request, fileLimitBytes: number): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!/^multipart\/form-data(;|$)/.test(contentType)) {
      reject(errors.unsupportedMediaType());
      return;
    }
    const totalLimit = fileLimitBytes + 100_000;
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > totalLimit) {
      reject(errors.tooLarge(fileLimitBytes));
      return;
    }
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: totalLimit, files: 2 } });
    } catch {
      reject(errors.badJson());
      return;
    }
    let gotFile = false;
    let done = false;
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    bb.on("file", (_name, stream, info) => {
      gotFile = true;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > fileLimitBytes) {
          truncated = true;
        }
        chunks.push(c);
      });
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("end", () => {
        if (done) return;
        done = true;
        if (truncated || size > fileLimitBytes) {
          reject(errors.tooLarge(fileLimitBytes));
          return;
        }
        resolve({ buffer: Buffer.concat(chunks), filename: info.filename || "upload.jpg" });
      });
    });
    bb.on("error", () => {
      if (!done) {
        done = true;
        reject(errors.badJson());
      }
    });
    bb.on("finish", () => {
      if (!done) {
        done = true;
        if (!gotFile) {
          reject(errors.validation({ file: "Choose a photo to upload." }));
          return;
        }
      }
    });
    req.pipe(bb);
  });
}
