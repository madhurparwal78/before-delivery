import { createHash, randomBytes } from "node:crypto";

// Random, URL-safe identifiers.
export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url").replace(/[^a-zA-Z0-9_-]/g, "");

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
