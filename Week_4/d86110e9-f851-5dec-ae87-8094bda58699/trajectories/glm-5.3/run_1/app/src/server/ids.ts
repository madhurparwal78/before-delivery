// Opaque ids follow the API's shapes. Step/edge/row ids are sequential and a
// deleted id is never reused.

import { randomBytes } from "node:crypto";

export function hexId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export function newUserId(): string { return hexId("user"); }
export function newWorkspaceId(): string { return "ws-" + randomBytes(4).toString("hex"); }
export function newAutomationId(): string { return "au-" + randomBytes(4).toString("hex"); }
export function newRunId(): string { return "run-" + randomBytes(4).toString("hex"); }
export function newTableId(): string { return "tb-" + randomBytes(4).toString("hex"); }
export function newImportId(): string { return "im-" + randomBytes(4).toString("hex"); }
export function newSessionToken(): string { return randomBytes(24).toString("hex"); }
export function newToken(): string { return randomBytes(16).toString("hex"); }
