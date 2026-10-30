import { query } from "./db";
import { auditSystem } from "./audit";
import { storage, killbill, mailer, pocketbase } from "./services";
import { formatDateTime } from "./http";
import { PLAN_CATALOG, planKey } from "./routes/billing-shared";
import { publishVersion } from "./realtime";

interface VersionRow {
  id: string;
  scene_id: string;
  number: number;
  label: string;
  state: string;
  seq: string;
  created_by_id: string;
  created_by_name: string;
  scheduled_by: string | null;
  publish_at: Date | null;
  published_at: Date | null;
  workspace_id: string;
  scene_name: string;
  embed_id: string | null;
}

async function loadScheduledVersions(): Promise<VersionRow[]> {
  const res = await query(
    `SELECT v.id, v.scene_id, v.number, v.label, v.state, v.seq, v.created_by_id, v.created_by_name, v.scheduled_by, v.publish_at, v.published_at,
            s.workspace_id, s.name AS scene_name, s.embed_id
     FROM versions v JOIN scenes s ON s.id = v.scene_id
     WHERE v.state = 'scheduled' AND v.publish_at IS NOT NULL AND v.publish_at <= now() + interval '2 seconds'`,
  );
  return res.rows as unknown as VersionRow[];
}

async function goLive(version: VersionRow): Promise<boolean> {
  const ws = version.workspace_id;
  // A suspended workspace waits for the subscription to become active again.
  const sub = (await query("SELECT state FROM subscriptions WHERE workspace_id = $1", [ws])).rows[0] as { state: string };
  if (sub.state === "suspended" || sub.state === "cancelled") return false;
  // The published payload must be writable to file storage.
  if (!(await storage().check())) return false;
  const snapshotBuf = await storage().get(storage().snapshotKey(ws, version.scene_id, version.id));
  if (!snapshotBuf) return false;
  const snapshot = JSON.parse(snapshotBuf.toString()) as { graph: unknown };
  let embedId = version.embed_id;
  const client = await (await import("./db")).pool.connect();
  try {
    await client.query("BEGIN");
    const embedRow = await client.query("SELECT embed_id FROM scenes WHERE id = $1 FOR UPDATE", [version.scene_id]);
    embedId = (embedRow.rows[0] as { embed_id: string | null }).embed_id;
    if (!embedId) {
      embedId = `emb_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
      await client.query("UPDATE scenes SET embed_id = $1 WHERE id = $2", [embedId, version.scene_id]);
    }
    // Withdraw the previously published version of this scene.
    await client.query("UPDATE versions SET state = 'withdrawn' WHERE scene_id = $1 AND state = 'published' AND id != $2", [version.scene_id, version.id]);
    await client.query("UPDATE versions SET state = 'published', published_at = now() WHERE id = $1", [version.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const payload = {
    scene: { name: version.scene_name },
    version: { number: version.number, label: version.label, publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    graph: snapshot.graph,
  };
  await storage().put(storage().publishedKey(ws, embedId!), Buffer.from(JSON.stringify(payload)), "application/json");
  auditSystem(ws, "version.published", { type: "version", id: version.id });
  // Publish notice to the scheduling member and the version creator, once each.
  const res = await query(
    `SELECT DISTINCT m.email FROM members m
     WHERE m.removed_at IS NULL AND m.workspace_id = $1 AND m.id = ANY($2)`,
    [ws, [version.created_by_id, version.scheduled_by ?? version.created_by_id]],
  );
  const tzRow = await query("SELECT time_zone FROM workspaces WHERE id = $1", [ws]);
  const tz = (tzRow.rows[0] as { time_zone: string }).time_zone;
  const publicUrl = (process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.APP_PUBLIC_PORT ?? 4173}`).replace(/\/$/, "");
  for (const row of res.rows as { email: string }[]) {
    mailer().send({
      to: [row.email],
      subject: `Published: ${version.scene_name} v${version.number}`,
      text: `${version.scene_name} version ${version.number} ("${version.label}") is now live.\n\nPublished at ${formatDateTime(new Date(), tz)}.\nEmbed: ${publicUrl}/embed/${embedId}\n`,
    });
  }
  return true;
}

async function publishDueVersions(): Promise<void> {
  const versions = await loadScheduledVersions();
  for (const version of versions) {
    try {
      await goLive(version);
      const fresh = (await query("SELECT * FROM versions WHERE id = $1", [version.id])).rows[0] as unknown as Record<string, unknown>;
      if (fresh) publishVersion(version.scene_id, fresh);
    } catch {
      // Retry on the next scheduler pass.
    }
  }
}

async function endTrials(): Promise<void> {
  // Seeded workspaces end 14 days after seeding; others follow TRIAL_LENGTH_SECONDS at creation.
  const res = await query(
    `UPDATE subscriptions SET state = 'suspended'
     WHERE state = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
     RETURNING workspace_id`,
  );
  for (const row of res.rows as { workspace_id: string }[]) {
    auditSystem(row.workspace_id, "subscription.trial_ended", { type: "workspace", id: row.workspace_id });
  }
}

async function dunning(): Promise<void> {
  const dunningDaySeconds = Number(process.env.DUNNING_DAY_SECONDS ?? 86400);
  const res = await query(
    `SELECT s.workspace_id, s.dunning_failed_at, s.dunning_notices, s.grace_ends_at, w.time_zone, w.name AS ws_name
     FROM subscriptions s JOIN workspaces w ON w.id = s.workspace_id
     WHERE s.state = 'past_due'`,
  );
  for (const row of res.rows as { workspace_id: string; dunning_failed_at: Date; dunning_notices: { sent: number[] } | null; grace_ends_at: Date; time_zone: string; ws_name: string }[]) {
    const sent = row.dunning_notices?.sent ?? [];
    const elapsed = (Date.now() - row.dunning_failed_at.getTime()) / 1000;
    const contacts = await billingContacts(row.workspace_id);
    if (elapsed >= 3 * dunningDaySeconds && !sent.includes(3)) {
      mailer().send({
        to: contacts,
        subject: `Reminder: payment still due for ${row.ws_name}`,
        text: `A payment is still due for ${row.ws_name}.\n\nGrace period ends ${formatDateTime(row.grace_ends_at, row.time_zone)}.\n`,
      });
      sent.push(3);
      await query("UPDATE subscriptions SET dunning_notices = $2 WHERE workspace_id = $1", [row.workspace_id, JSON.stringify({ sent })]);
    }
    if (row.grace_ends_at.getTime() <= Date.now()) {
      await query("UPDATE subscriptions SET state = 'suspended' WHERE workspace_id = $1 AND state = 'past_due'", [row.workspace_id]);
      auditSystem(row.workspace_id, "subscription.suspended", { type: "workspace", id: row.workspace_id });
      if (contacts.length > 0) {
        mailer().send({
          to: contacts,
          subject: `Publishing suspended for ${row.ws_name}`,
          text: `The grace period has ended for ${row.ws_name}. Publishing is suspended until the overdue invoice is paid.\n`,
        });
      }
    }
  }
}

async function tokenExpiryWarnings(): Promise<void> {
  const leadSeconds = Number(process.env.TOKEN_WARNING_LEAD_SECONDS ?? 86400);
  const res = await query(
    `SELECT t.id, t.name, t.expires_at, t.issued_by, t.warned_at, w.id AS ws_id, w.name AS ws_name, w.time_zone
     FROM agent_tokens t JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.revoked_at IS NULL AND t.warned_at IS NULL AND t.expires_at <= now() + ($1 || ' seconds')::interval`,
    [String(leadSeconds)],
  );
  for (const row of res.rows as { id: string; name: string; expires_at: Date; issued_by: string; ws_id: string; ws_name: string; time_zone: string }[]) {
    // The warning goes to the issuing member, or the owner if that member was removed.
    const issuer = await query("SELECT email FROM members WHERE id = $1 AND removed_at IS NULL", [row.issued_by]);
    let emails: string[] = [];
    if (issuer.rows.length > 0) {
      emails = [(issuer.rows[0] as { email: string }).email];
    } else {
      const owner = await query("SELECT email FROM members WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL", [row.ws_id]);
      emails = (owner.rows as { email: string }[]).map((r) => r.email);
    }
    if (emails.length > 0) {
      mailer().send({
        to: emails,
        subject: `Agent token ${row.name} expires soon`,
        text: `Agent token "${row.name}" expires at ${formatDateTime(row.expires_at, row.time_zone)}.\n\nIssue a new token before then to keep agents working.\n`,
      });
    }
    await query("UPDATE agent_tokens SET warned_at = now() WHERE id = $1", [row.id]);
  }
}

async function applyPendingChanges(): Promise<void> {
  const res = await query("SELECT workspace_id, pending_change FROM subscriptions WHERE pending_change IS NOT NULL");
  for (const row of res.rows as { workspace_id: string; pending_change: { plan: string; period: string; extraSeats: number; effectiveAt: string } }[]) {
    if (new Date(row.pending_change.effectiveAt).getTime() > Date.now()) continue;
    const catalog = PLAN_CATALOG[planKey(row.pending_change.plan, row.pending_change.period)];
    if (!catalog) {
      await query("UPDATE subscriptions SET pending_change = NULL WHERE workspace_id = $1", [row.workspace_id]);
      continue;
    }
    await query(
      "UPDATE subscriptions SET plan = $2, period = $3, extra_seats = $4, seats_purchased = $5, pending_change = NULL WHERE workspace_id = $1 AND pending_change = $6",
      [row.workspace_id, row.pending_change.plan, row.pending_change.period, row.pending_change.extraSeats, catalog.includedSeats + row.pending_change.extraSeats, JSON.stringify(row.pending_change)],
    );
  }
}

async function clearLapsedLocks(): Promise<void> {
  // PocketBase lock records carry expiresAt; readers ignore expired locks. Lapsed records are pruned here.
  try {
    await pocketbase().pruneExpiredLocks();
  } catch {
    // PocketBase may be briefly unreachable; the next pass retries.
  }
}

export function startScheduler(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    Promise.all([
      publishDueVersions(),
      endTrials(),
      dunning(),
      tokenExpiryWarnings(),
      applyPendingChanges(),
      clearLapsedLocks(),
    ])
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, 1000).unref();
}

async function billingContacts(workspaceId: string): Promise<string[]> {
  const res = await query(
    "SELECT email FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND role IN ('owner','billing_manager')",
    [workspaceId],
  );
  return (res.rows as { email: string }[]).map((r) => r.email);
}
