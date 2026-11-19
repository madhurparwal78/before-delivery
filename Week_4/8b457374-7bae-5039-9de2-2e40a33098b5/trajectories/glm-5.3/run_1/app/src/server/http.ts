import type { NextFunction, Request, Response } from "express";
import { ApiError, sendError } from "./errors.js";

// The server boundary: same-origin only, enforced body limits, exact error
// codes for malformed JSON and wrong content types.

export function jsonBody(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "PUT") {
      next();
      return;
    }
    const contentType = req.header("content-type") ?? "";
    const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (req.get("content-length") === undefined && contentType === "") {
      // No body at all on a JSON route: treat as an empty object when no
      // content type was given, else as an unsupported type.
      (req as Request & { jsonBody?: Record<string, unknown> }).jsonBody = {};
      next();
      return;
    }
    if (mime !== "application/json") {
      sendError(res, new ApiError(415, "unsupported_media_type"));
      return;
    }
    collectBody(req, limitBytes)
      .then((buffer) => {
        if (buffer.length === 0) {
          (req as Request & { jsonBody?: Record<string, unknown> }).jsonBody = {};
          next();
          return;
        }
        try {
          const parsed: unknown = JSON.parse(buffer.toString("utf8"));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            sendError(res, new ApiError(400, "bad_json"));
            return;
          }
          (req as Request & { jsonBody?: Record<string, unknown> }).jsonBody = parsed as Record<
            string,
            unknown
          >;
          next();
        } catch {
          sendError(res, new ApiError(400, "bad_json"));
        }
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "TOO_LARGE") {
          sendError(res, new ApiError(413, "too_large"));
          return;
        }
        next(error as Error);
      });
  };
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function imageBody(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.header("content-type") ?? "";
    const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(mime)) {
      sendError(res, new ApiError(415, "unsupported_media_type"));
      return;
    }
    collectBody(req, limitBytes)
      .then((buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buffer;
        next();
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "TOO_LARGE") {
          sendError(res, new ApiError(413, "too_large"));
          return;
        }
        next(error as Error);
      });
  };
}

function collectBody(req: Request, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > limitBytes) {
      reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.removeAllListeners("data");
        reject(Object.assign(new Error("too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** No cross-origin permission headers are ever sent. */
export function sameOriginBoundary(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Headers");
  res.removeHeader("Access-Control-Allow-Methods");
  next();
}
