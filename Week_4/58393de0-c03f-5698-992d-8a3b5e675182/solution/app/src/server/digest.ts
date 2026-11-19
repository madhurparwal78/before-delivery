import { createHash } from "node:crypto";

/** The one SHA-256 of the server: session tokens, verification tokens, request bodies, S3 payloads. */
export const sha256Hex = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
