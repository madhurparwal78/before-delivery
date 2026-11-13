// Notification messages (brief: Mailpit table). Queued in the database; the drain sends each once.
import type { Promotion } from "../../shared/api.js";
import { clusterTime } from "../../shared/zone.js";
import { config } from "../config.js";
import type { Tx } from "../db.js";

export type Notice =
  | { kind: "approval_requested"; token: string }
  | { kind: "approved" | "rejected" | "expired" }
  | { kind: "freeze_broken"; sre: string; reason: string };

const DIFF_LINES = 40;

function subjectOf(p: Promotion, projectName: string, notice: Notice): string {
  switch (notice.kind) {
    case "approval_requested": return `Approval requested: ${p.bundle.version} to ${p.stage} (${projectName})`;
    case "approved": return `Approved: ${p.bundle.version} to ${p.stage}`;
    case "rejected": return `Rejected: ${p.bundle.version} to ${p.stage}`;
    case "expired": return `Approval expired: ${p.bundle.version} to ${p.stage}`;
    case "freeze_broken": return `Freeze broken: ${p.stage} by ${notice.sre}`;
  }
}

function bodyOf(p: Promotion, projectName: string, notice: Notice): string {
  const link = `${config.publicUrl}/projects/${p.project}?stage=${encodeURIComponent(p.stage)}&promotion=${p.id}`;
  const lines = [
    subjectOf(p, projectName, notice),
    "",
    `Project:   ${projectName}`,
    `Stage:     ${p.stage} (${p.cluster}, ${p.time_zone})`,
    `Version:   ${p.bundle.version}`,
    `Digest:    ${p.bundle.short_digest} (${p.bundle.digest})`,
    `Requester: ${p.requested_by.name} <${p.requested_by.email}>`,
  ];
  if (notice.kind === "approval_requested" && p.approval) {
    lines.push(`Request expires: ${clusterTime(p.approval.request_expires_at, p.time_zone)}`, "", "Changes (secret values redacted):");
    for (const entry of p.diff.slice(0, DIFF_LINES)) {
      const detail = entry.path ? ` ${entry.path}: ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}` : "";
      lines.push(`  ${entry.change.padEnd(8)} ${entry.resource}${detail}`);
    }
    if (p.diff.length > DIFF_LINES) lines.push(`  … and ${p.diff.length - DIFF_LINES} more changes in Keelson.`);
    lines.push("", `Review and decide: ${config.publicUrl}/approvals/${notice.token}`);
  }
  if ((notice.kind === "approved") && p.approval?.expires_at) {
    lines.push(`Approved by ${p.approval.decided_by?.name ?? ""} until ${clusterTime(p.approval.expires_at, p.time_zone)}.`);
  }
  if (notice.kind === "rejected" && p.approval?.comment) lines.push(`Reason: ${p.approval.comment}`);
  if (notice.kind === "freeze_broken") lines.push(`Broken by: ${notice.sre}`, `Reason: ${notice.reason}`);
  lines.push("", `Open the promotion: ${link}`, "");
  return lines.join("\n");
}

export async function queueNotice(tx: Tx, p: Promotion, notice: Notice, at: Date): Promise<void> {
  const { rows } = await tx.query<{ name: string; email: string }>(
    notice.kind === "approval_requested" || notice.kind === "freeze_broken"
      ? `SELECT p.name, u.email FROM projects p JOIN memberships m ON m.project_id = p.id JOIN users u ON u.id = m.user_id
          WHERE p.slug = $1 AND m.role = 'release_manager' ORDER BY u.email`
      : "SELECT p.name, $2::text AS email FROM projects p WHERE p.slug = $1",
    notice.kind === "approval_requested" || notice.kind === "freeze_broken" ? [p.project] : [p.project, p.requested_by.email]);
  for (const recipient of rows) {
    await tx.query("INSERT INTO messages (promotion_id, recipient, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)",
      [p.id, recipient.email, subjectOf(p, recipient.name, notice), bodyOf(p, recipient.name, notice), at]);
  }
}
