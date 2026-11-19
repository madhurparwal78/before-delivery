import { pluralBlobs } from "./units.ts";
import type { Rejection } from "./api.ts";

export function producedText(height: number, blobs: number, squareWidth: number): string {
  return `Block ${height} produced: ${pluralBlobs(blobs)}, square ${squareWidth} × ${squareWidth}.`;
}

export function rejectionText(height: number, rejection: Rejection): string {
  return rejection.reason === "withheld"
    ? `Block ${height} was rejected: shares were withheld. Light node ${rejection.nodeName} could not fetch share (${rejection.row}, ${rejection.col}).`
    : `Block ${height} was rejected: ${rejection.axis} ${rejection.index} is not encoded correctly.`;
}

export const VIEWER_COPY = "Viewers can't make changes in this workspace.";
export const OWNER_PRODUCER_COPY = "Only the owner can change producer behaviour.";
export const OWNER_MEMBERS_COPY = "Only the owner can manage members.";
export const TRANSACTION_SENT = "Transaction sent. It takes effect when the next block is produced.";
export const STORAGE_DOWN_SUBMIT = "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.";
export const STORAGE_DOWN_SNAPSHOT = "Storage is unavailable, so the snapshot can't be downloaded right now.";
export const SERVER_UNREACHABLE = "Fernsquare can't reach the server. Your last action was not sent.";
