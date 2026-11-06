import { ATTACHMENT_LIMIT_TEXT } from "../../shared/limits.ts";
import type { WorkspaceRecord } from "./types.ts";

/** The published attachment block text; a file not on this device reads as waiting. */
export function attachmentText(attachment: WorkspaceRecord<"attachment"> | undefined): string {
  if (attachment?.fields.state === "stored") return "Stored.";
  if (attachment?.fields.state === "refused") {
    return attachment.fields.refusal === "full" ? "Refused. Your account storage is full." : `Refused. This file is larger than ${ATTACHMENT_LIMIT_TEXT}.`;
  }
  return "Waiting. This file is only on this device.";
}
