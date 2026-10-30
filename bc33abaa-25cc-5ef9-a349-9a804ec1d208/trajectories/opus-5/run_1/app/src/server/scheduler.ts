import { config } from './config';
import { query } from './db/pool';
import { sendDunningNotice, updateSubscriptionRow } from './billing/engine';
import { formatLocalTime } from '../shared/format';
import { PeriodId, PlanId } from '../shared/plans';
import { dunningStepAt, tokenWarningAt, toIso } from './domain/time';
import {
  SCHEDULER_ACTOR,
  WorkspaceRow,
  getWorkspace,
  writeAudit,
} from './domain/workspace';
import { VersionRow, announceVersion, publishedPayload } from './domain/versions';
import { publishLock } from './realtime/bus';
import { enqueueMail, drainOutbox } from './services/mail';
import { mirror } from './services/pocketbase';
import { putObject, storageKeys } from './services/storage';
import { randomId } from './util/crypto';

async function endTrials(): Promise<void> {
  const rows = await query<{ workspace_id: string }>(
    `UPDATE subscriptions
     SET state = 'suspended', suspended_reason = 'trial_ended', updated_at = now()
     WHERE state = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
     RETURNING workspace_id`,
  );
  for (const row of rows) {
    await writeAudit({
      workspaceId: row.workspace_id,
      actor: SCHEDULER_ACTOR,
      action: 'subscription.trial_ended',
      target: { type: 'subscription', id: row.workspace_id },
    });
  }
}

async function runDunning(): Promise<void> {
  const rows = await query<{
    workspace_id: string;
    failed_at: Date;
    grace_ends_at: Date | null;
    state: string;
    kb_account_id: string | null;
  }>(
    `SELECT workspace_id, failed_at, grace_ends_at, state, kb_account_id FROM subscriptions
     WHERE state = 'past_due' AND failed_at IS NOT NULL`,
  );
  const now = Date.now();
  for (const row of rows) {
    const workspace = await getWorkspace(row.workspace_id);
    if (!workspace) continue;
    const graceEndsAt = row.grace_ends_at ?? dunningStepAt(row.failed_at, 7);
    const invoice = await query<{ number: string }>(
      `SELECT number FROM invoice_records
       WHERE workspace_id = $1 AND balance_cents > 0
       ORDER BY seen_at LIMIT 1`,
      [row.workspace_id],
    );
    const invoiceNumber = invoice[0]?.number ?? '';
    const claimStep = async (step: 0 | 3 | 7): Promise<boolean> => {
      const sent = await query<{ claimed: boolean }>(
        `INSERT INTO dunning_notices (workspace_id, failed_at, step)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING true AS claimed`,
        [row.workspace_id, row.failed_at, step],
      );
      return sent.length > 0;
    };
    if (dunningStepAt(row.failed_at, 3).getTime() <= now && (await claimStep(3))) {
      await sendDunningNotice({ workspace, step: 3, invoiceNumber, graceEndsAt });
    }
    // The day-7 notice is the suspension notice, so it follows the stored grace end.
    if (graceEndsAt.getTime() <= now) {
      if (await claimStep(7)) {
        await sendDunningNotice({ workspace, step: 7, invoiceNumber, graceEndsAt });
      }
      await updateSubscriptionRow(row.workspace_id, {
        state: 'suspended',
        suspended_reason: 'dunning',
      });
      await writeAudit({
        workspaceId: row.workspace_id,
        actor: SCHEDULER_ACTOR,
        action: 'subscription.suspended',
        target: { type: 'subscription', id: row.workspace_id },
      });
    }
  }
}

async function publishDue(): Promise<void> {
  const rows = await query<VersionRow & { scene_name: string; scene_embed_id: string | null; state_name: string }>(
    `SELECT v.*, s.name AS scene_name, s.embed_id AS scene_embed_id, sub.state AS state_name
     FROM versions v
     JOIN scenes s ON s.id = v.scene_id
     JOIN subscriptions sub ON sub.workspace_id = v.workspace_id
     WHERE v.state = 'scheduled' AND v.publish_at IS NOT NULL AND v.publish_at <= now()
     ORDER BY v.publish_at`,
  );
  for (const row of rows) {
    if (row.state_name === 'suspended' || row.state_name === 'cancelled') continue;
    const workspace = await getWorkspace(row.workspace_id);
    if (!workspace) continue;
    const embedId = row.scene_embed_id ?? randomId('emb');
    const published: VersionRow = {
      ...row,
      state: 'published',
      published_at: new Date(),
      embed_id: embedId,
    };
    try {
      await putObject(
        storageKeys.published(row.workspace_id, embedId),
        Buffer.from(JSON.stringify(publishedPayload(published, row.scene_name)), 'utf8'),
        'application/json',
      );
    } catch {
      continue;
    }
    // One claim per version, so two serve instances publish it exactly once.
    const updated = await query<VersionRow>(
      `UPDATE versions
       SET state = 'published', published_at = now(), embed_id = $2
       WHERE id = $1 AND state = 'scheduled'
       RETURNING *`,
      [row.id, embedId],
    );
    const version = updated[0];
    if (!version) continue;
    if (!row.scene_embed_id) {
      await query(`UPDATE scenes SET embed_id = $2 WHERE id = $1`, [row.scene_id, embedId]);
    }
    const previous = await query<{ id: string }>(
      `UPDATE versions SET state = 'withdrawn'
       WHERE scene_id = $1 AND state = 'published' AND id <> $2
       RETURNING id`,
      [row.scene_id, row.id],
    );
    await writeAudit({
      workspaceId: row.workspace_id,
      actor: SCHEDULER_ACTOR,
      action: 'version.published',
      target: { type: 'version', id: row.id },
    });
    for (const withdrawnId of previous) {
      const withdrawn = await query<VersionRow>(`SELECT * FROM versions WHERE id = $1`, [
        withdrawnId.id,
      ]);
      const first = withdrawn[0];
      if (first) await announceVersion(first);
    }
    await sendPublishNotice(workspace, version, row.scene_name, embedId);
    await announceVersion(version);
  }
}

async function sendPublishNotice(
  workspace: WorkspaceRow,
  version: VersionRow,
  sceneName: string,
  embedId: string,
): Promise<void> {
  const ids = new Set<string>();
  if (version.scheduled_by_id) ids.add(version.scheduled_by_id);
  if (version.created_by_kind === 'member') ids.add(version.created_by_id);
  if (ids.size === 0) return;
  const members = await query<{ email: string }>(
    `SELECT email FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND id = ANY($2::text[])`,
    [workspace.id, [...ids]],
  );
  if (members.length === 0) return;
  const publishedAt = version.published_at ? toIso(version.published_at) : toIso(new Date());
  await enqueueMail({
    dedupeKey: `publish:${version.id}`,
    workspaceId: workspace.id,
    to: members.map((member) => member.email),
    subject: `Published: ${sceneName} v${version.number}`,
    body: [
      `${sceneName} v${version.number} (${version.label}) is live.`,
      '',
      `Published at: ${formatLocalTime(publishedAt, workspace.time_zone)}`,
      `Embed: ${config.publicUrl}/embed/${embedId}`,
    ].join('\n'),
  });
}

async function warnExpiringTokens(): Promise<void> {
  const rows = await query<{
    id: string;
    workspace_id: string;
    name: string;
    expires_at: Date;
    warn_at: Date | null;
    issued_by_id: string;
  }>(
    `SELECT id, workspace_id, name, expires_at, warn_at, issued_by_id FROM agent_tokens
     WHERE revoked_at IS NULL AND warning_sent_at IS NULL AND expires_at > now()`,
  );
  for (const row of rows) {
    const warnAt = row.warn_at ?? tokenWarningAt(row.expires_at);
    if (warnAt.getTime() > Date.now()) continue;
    const workspace = await getWorkspace(row.workspace_id);
    if (!workspace) continue;
    const recipients = await query<{ email: string }>(
      `SELECT email FROM members
       WHERE workspace_id = $1 AND removed_at IS NULL AND id = $2`,
      [row.workspace_id, row.issued_by_id],
    );
    const fallback =
      recipients.length > 0
        ? recipients
        : await query<{ email: string }>(
            `SELECT email FROM members
             WHERE workspace_id = $1 AND removed_at IS NULL AND role = 'owner' LIMIT 1`,
            [row.workspace_id],
          );
    await query(`UPDATE agent_tokens SET warning_sent_at = now() WHERE id = $1`, [row.id]);
    if (fallback.length === 0) continue;
    await enqueueMail({
      dedupeKey: `token-warning:${row.id}`,
      workspaceId: row.workspace_id,
      to: fallback.map((member) => member.email),
      subject: `Agent token ${row.name} expires soon`,
      body: [
        `The agent token ${row.name} expires ${formatLocalTime(
          toIso(row.expires_at),
          workspace.time_zone,
        )}.`,
        '',
        'Issue a new token before then to keep the agent working.',
      ].join('\n'),
    });
  }
}

async function applyPendingChanges(): Promise<void> {
  const rows = await query<{
    workspace_id: string;
    pending_change: { plan: PlanId; period: PeriodId; extraSeats: number; effectiveAt: string };
  }>(
    `SELECT workspace_id, pending_change FROM subscriptions
     WHERE pending_change IS NOT NULL
       AND (pending_change ->> 'effectiveAt')::timestamptz <= now()`,
  );
  for (const row of rows) {
    const claimed = await query<{ workspace_id: string }>(
      `UPDATE subscriptions SET pending_change = NULL, updated_at = now()
       WHERE workspace_id = $1 AND pending_change IS NOT NULL
       RETURNING workspace_id`,
      [row.workspace_id],
    );
    if (claimed.length === 0) continue;
    await updateSubscriptionRow(row.workspace_id, {
      plan: row.pending_change.plan,
      period: row.pending_change.period,
      extra_seats: row.pending_change.extraSeats,
    });
  }
}

async function expireLocksAndPresence(): Promise<void> {
  const locks = await query<{ scene_id: string; node_id: string }>(
    `DELETE FROM object_locks WHERE expires_at <= now() RETURNING scene_id, node_id`,
  );
  for (const lock of locks) {
    publishLock(lock.scene_id, { nodeId: lock.node_id });
    mirror.lockGone(lock.scene_id, lock.node_id);
  }
  const gone = await query<{ scene_id: string; author_id: string }>(
    `DELETE FROM presence WHERE seen_at <= now() - interval '30 seconds'
     RETURNING scene_id, author_id`,
  );
  for (const row of gone) {
    mirror.presenceGone(row.scene_id, row.author_id);
  }
}

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await endTrials();
    await runDunning();
    await publishDue();
    await warnExpiringTokens();
    await applyPendingChanges();
    await expireLocksAndPresence();
    await drainOutbox();
  } catch {
    // A failed pass is retried on the next tick.
  } finally {
    running = false;
  }
}

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => void tick(), 1_000);
}
