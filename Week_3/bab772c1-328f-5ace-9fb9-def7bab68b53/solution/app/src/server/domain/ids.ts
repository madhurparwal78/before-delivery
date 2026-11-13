import { createHash, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** A stable id for a capture's transcript line, so a redelivered parse reindexes in place. */
export function lineId(passId: string, lineNumber: number): string {
  const digest = createHash("sha256").update(`${passId}:${lineNumber}`).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `8${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
