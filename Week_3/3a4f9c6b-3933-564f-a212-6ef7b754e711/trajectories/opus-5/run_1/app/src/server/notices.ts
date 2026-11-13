import { config } from './config.js';
import type { Tx } from './db.js';
import { shortDigest, type PromotionRow } from './repo.js';
import { recordNotice } from './services/queues.js';
import { clusterTime } from '../shared/zone.js';

function promotionLink(row: PromotionRow): string {
  return `${config.publicUrl}/projects/${row.project_slug}?stage=${encodeURIComponent(row.stage_name)}&promotion=${row.id}`;
}

/** The shared opening of every message: project, stage, version, short digest and requester. */
function preamble(row: PromotionRow): string[] {
  return [
    `Project: ${row.project_name}`,
    `Stage: ${row.stage_name} (${row.cluster_name}, ${row.time_zone})`,
    `Version: ${row.bundle_version}`,
    `Digest: ${shortDigest(row.bundle_digest)}`,
    `Requested by: ${row.requester_name} <${row.requester_email}>`,
    `Promotion: ${promotionLink(row)}`,
  ];
}

/** Lists what changes, by resource and path only, so no value can travel in a message. */
function diffSummary(row: PromotionRow): string[] {
  if (row.diff.length === 0) return ['No changes.'];
  return row.diff.map((entry) => `  ${entry.change} ${entry.resource}${entry.path ? ` ${entry.path}` : ''}`);
}

async function releaseManagers(tx: Tx, projectId: string): Promise<{ email: string }[]> {
  return tx.query<{ email: string }>(
    `SELECT who.email FROM memberships m
     JOIN people who ON who.id = m.person_id
     WHERE m.project_id = $1 AND m.role = 'release_manager'
     ORDER BY who.email`,
    [projectId],
  );
}

export async function queueApprovalRequested(tx: Tx, row: PromotionRow, token: string): Promise<void> {
  const expires = row.request_expires_at ?? row.requested_at;
  const body = [
    ...preamble(row),
    '',
    `This promotion needs a release manager's approval before it can start.`,
    `Approve or reject by: ${clusterTime(expires, row.time_zone)}`,
    '',
    `Review and decide: ${config.publicUrl}/approvals/${token}`,
    '',
    'Changes in this release:',
    ...diffSummary(row),
  ].join('\n');

  for (const manager of await releaseManagers(tx, row.project_id)) {
    await recordNotice(tx, {
      recipient: manager.email,
      subject: `Approval requested: ${row.bundle_version} to ${row.stage_name} (${row.project_name})`,
      body,
      dedupeKey: `approval_requested:${row.id}:${manager.email}`,
      promotionId: row.id,
    });
  }
}

export async function queueApproved(tx: Tx, row: PromotionRow): Promise<void> {
  const body = [
    ...preamble(row),
    '',
    `Approved by ${row.approval_decided_by ?? 'a release manager'}.`,
    row.approval_expires_at
      ? `Start the promotion before ${clusterTime(row.approval_expires_at, row.time_zone)}.`
      : 'Start the promotion from the stage graph.',
    ...(row.approval_comment ? ['', `Comment: ${row.approval_comment}`] : []),
  ].join('\n');

  await recordNotice(tx, {
    recipient: row.requester_email,
    subject: `Approved: ${row.bundle_version} to ${row.stage_name}`,
    body,
    dedupeKey: `approved:${row.id}:${row.requester_email}`,
    promotionId: row.id,
  });
}

export async function queueRejected(tx: Tx, row: PromotionRow): Promise<void> {
  const body = [
    ...preamble(row),
    '',
    `Rejected by ${row.approval_decided_by ?? 'a release manager'}.`,
    ...(row.approval_comment ? ['', `Reason: ${row.approval_comment}`] : []),
  ].join('\n');

  await recordNotice(tx, {
    recipient: row.requester_email,
    subject: `Rejected: ${row.bundle_version} to ${row.stage_name}`,
    body,
    dedupeKey: `rejected:${row.id}:${row.requester_email}`,
    promotionId: row.id,
  });
}

export async function queueExpired(tx: Tx, row: PromotionRow): Promise<void> {
  const expiry = row.approval_expires_at ?? row.request_expires_at ?? row.requested_at;
  const body = [
    ...preamble(row),
    '',
    `The approval lapsed at ${clusterTime(expiry, row.time_zone)}.`,
    'Request a new promotion to try again.',
  ].join('\n');

  await recordNotice(tx, {
    recipient: row.requester_email,
    subject: `Approval expired: ${row.bundle_version} to ${row.stage_name}`,
    body,
    dedupeKey: `expired:${row.id}:${row.requester_email}`,
    promotionId: row.id,
  });
}

export async function queueFreezeBroken(tx: Tx, row: PromotionRow, sreName: string): Promise<void> {
  const body = [
    ...preamble(row),
    '',
    `${sreName} broke the freeze and started this promotion.`,
    `Reason: ${row.freeze_break?.reason ?? ''}`,
  ].join('\n');

  for (const manager of await releaseManagers(tx, row.project_id)) {
    await recordNotice(tx, {
      recipient: manager.email,
      subject: `Freeze broken: ${row.stage_name} by ${sreName}`,
      body,
      dedupeKey: `freeze_broken:${row.id}:${manager.email}`,
      promotionId: row.id,
    });
  }
}
