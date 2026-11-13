import type { Ctx } from "./core.js";
import { sealDocument } from "./seal.js";
import { sendNow } from "./mail.js";
import { withTransaction } from "./core.js";
import { writeAudit } from "./audit.js";

/** One instance attempts a seal at a time; this loop also retries held emails. */
export function startBackground(ctx: Ctx): void {
  const timer = setInterval(async () => {
    try {
      await retryHeldEmails(ctx);
      await retrySeals(ctx);
      await sweepExpiry(ctx);
    } catch (e) {
      console.error("background error", e);
    }
  }, 1000);
  timer.unref();

  // immediate first pass
  setTimeout(() => { retryHeldEmails(ctx).catch(() => {}); }, 1500);
}

async function retrySeals(ctx: Ctx): Promise<void> {
  if (!ctx.health.storageOk || !ctx.health.mailOk) return;
  // Sealing documents with no seal row yet claim one first.
  const fresh = await ctx.pool.query(
    "SELECT id FROM documents WHERE status = 'sealing' AND id NOT IN (SELECT document_id FROM seal_jobs)",
  );
  for (const row of fresh.rows) {
    await sealDocument(ctx, row.id);
  }
  const res = await ctx.pool.query(
    "SELECT document_id FROM seal_jobs WHERE sealed = false AND (last_attempt IS NULL OR last_attempt <= now() - make_interval(secs => $1))",
    [ctx.cfg.sealRetrySeconds],
  );
  for (const row of res.rows) {
    await sealDocument(ctx, row.document_id);
  }
}

async function retryHeldEmails(ctx: Ctx): Promise<void> {
  if (!ctx.health.mailOk || !ctx.health.storageOk) return;
  const res = await ctx.pool.query(
    "SELECT * FROM held_emails WHERE delivered = false AND (last_attempt IS NULL OR last_attempt <= now() - make_interval(secs => $1)) ORDER BY held_at LIMIT 10",
    [ctx.cfg.mailRetrySeconds],
  );
  for (const row of res.rows) {
    const fromName = row.kind === "invite" || row.kind === "reminder" || row.kind === "new_link"
      ? String(row.from_name)
      : ctx.cfg.mailFrom.name;
    // The delivering instance rewrites the link so it points at its own origin.
    const heldUrl = typeof row.public_url === "string" ? row.public_url : "";
    const body = heldUrl !== "" && heldUrl !== ctx.cfg.publicUrl
      ? String(row.body).replaceAll(heldUrl, ctx.cfg.publicUrl)
      : String(row.body);
    const ok = await sendNow(
      { transporter: ctx.mailer.transporter, from: ctx.cfg.mailFrom },
      { kind: row.kind, to: row.to_email, subject: row.subject, body },
      fromName,
    );
    if (ok) {
      await ctx.pool.query("UPDATE held_emails SET delivered = true WHERE id = $1", [row.id]);
      if (row.kind === "invite" || row.kind === "new_link") {
        await markInviteSent(ctx, row.document_id, row.to_email);
      }
    } else {
      await ctx.pool.query("UPDATE held_emails SET last_attempt = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
      break;
    }
  }
}

async function markInviteSent(ctx: Ctx, documentId: string, email: string): Promise<void> {
  await withTransaction(ctx.pool, async (client) => {
    const res = await client.query(
      "SELECT id FROM recipients WHERE document_id = $1 AND email = $2",
      [documentId, email],
    );
    for (const row of res.rows) {
      await writeAudit(client, documentId, "invite.sent", "system", row.id, new Date());
    }
    await client.query(
      "UPDATE recipients SET delivery = 'sent' WHERE document_id = $1 AND email = $2 AND delivery = 'held'",
      [documentId, email],
    );
  });
  if (documentId) ctx.live.publishDocument(documentId, { type: "document", id: documentId });
}

async function sweepExpiry(ctx: Ctx): Promise<void> {
  // Expiry is computed, not written; but we push state to open pages.
  const res = await ctx.pool.query(
    "SELECT id FROM documents WHERE status = 'in_progress'",
  );
  for (const row of res.rows) {
    ctx.live.publishDocument(row.id, { type: "document", id: row.id });
  }
}
