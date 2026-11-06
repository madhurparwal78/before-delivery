// The server publishes due previews by itself (brief: Business rules, Publishing) and delivers
// queued mail exactly once (Services, Mailpit).
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { isReady, transaction } from "./db.js";
import { writeEvent } from "./events.js";
import { museumDisplay, previewSources } from "./domain/preview.js";
import { exhibition, placementsWhere, walls } from "./model.js";
import { putObject } from "./s3.js";
import { sendMail } from "./smtp.js";
import { snapshotFor, snapshotPng } from "./snapshot.js";

const PUBLISH_CHECK_MS = 1000;
const MAIL_RETRY_MS = 3000;

async function publishDue(): Promise<void> {
  await transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, status, publish_at FROM previews WHERE status = ANY($2) AND publish_at <= $1
       ORDER BY publish_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [new Date(), previewSources("publish")],
    );
    const preview = rows[0];
    if (!preview) return;
    const ex = await exhibition(db);
    const allWalls = await walls(db);
    const placed = await placementsWhere(db, "p.status <> 'removed' AND o.lender_id IS NOT NULL");
    const lenders = (await db.query("SELECT id, name, email FROM lenders ORDER BY position")).rows;
    const publishedAt = new Date();
    const publishedAtDisplay = museumDisplay(publishedAt, ex.timeZone);
    let recipients = 0;
    for (const lender of lenders) {
      const own = placed.filter((p) => p.lenderId === lender.id);
      if (!own.length) continue;
      const snapshot = snapshotFor(
        { title: ex.title, runStart: ex.runStart, runEnd: ex.runEnd },
        lender.name,
        publishedAt,
        publishedAtDisplay,
        allWalls,
        own,
      );
      const prefix = `previews/${preview.id}/${lender.id}`;
      await putObject(`${prefix}/snapshot.json`, Buffer.from(JSON.stringify(snapshot), "utf8"), "application/json");
      await putObject(`${prefix}/snapshot.png`, snapshotPng(snapshot), "image/png");
      await db.query(
        `INSERT INTO recipients (preview_id, lender_id, lender_name, email, token, works, delivery)
         VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
        [
          preview.id,
          lender.id,
          lender.name,
          lender.email,
          randomBytes(32).toString("base64url"),
          JSON.stringify(snapshot.works.map((w) => ({ title: w.title, wallName: w.wallName }))),
        ],
      );
      recipients += 1;
    }
    await db.query("UPDATE previews SET status = 'published', published_at = $2 WHERE id = $1", [preview.id, publishedAt]);
    await writeEvent(db, "preview.published", null, { previewId: preview.id, recipientCount: recipients });
  });
  await deliverQueued();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Work {
  title: string;
  wallName: string;
}

function previewMail(title: string, lender: string, publishDisplay: string, works: Work[], link: string) {
  const list = works.map((w) => `- ${w.title} (${w.wallName})`).join("\n");
  const text = [
    `Dear ${lender},`,
    "",
    `The preview of ${title} was published on ${publishDisplay}.`,
    "",
    "Your works in place:",
    list,
    "",
    `Open your preview: ${link}`,
    "",
    "This link is for you alone and shows only your loans.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1B18;background:#F3F0E8;padding:24px">
<p>Dear ${escapeHtml(lender)},</p>
<p>The preview of <strong>${escapeHtml(title)}</strong> was published on ${escapeHtml(publishDisplay)}.</p>
<p>Your works in place:</p>
<ul>${works.map((w) => `<li>${escapeHtml(w.title)} (${escapeHtml(w.wallName)})</li>`).join("")}</ul>
<p><a href="${escapeHtml(link)}">Open your preview</a></p>
<p>${escapeHtml(link)}</p>
<p>This link is for you alone and shows only your loans.</p>
</body></html>`;
  return { subject: `Preview of ${title}: your loans in place`, text, html };
}

function withdrawalMail(title: string, lender: string) {
  const text = [
    `Dear ${lender},`,
    "",
    `The museum has withdrawn the preview of ${title}.`,
    "The earlier link no longer works.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1B18;background:#F3F0E8;padding:24px">
<p>Dear ${escapeHtml(lender)},</p><p>The museum has withdrawn the preview of <strong>${escapeHtml(title)}</strong>.</p>
<p>The earlier link no longer works.</p></body></html>`;
  return { subject: `Preview withdrawn: ${title}`, text, html };
}

/** Sends every queued preview email and withdrawal notice; run at once after publishing or withdrawing. */
export async function deliverQueued(): Promise<void> {
  await transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT r.preview_id, r.lender_id, r.lender_name, r.email, r.token, r.works, r.delivery, r.notice, p.publish_at, p.status
       FROM recipients r JOIN previews p ON p.id = r.preview_id
       WHERE (r.delivery = 'queued' AND p.status = 'published') OR r.notice = 'queued'
       ORDER BY p.created_at, r.lender_id LIMIT 20 FOR UPDATE OF r SKIP LOCKED`,
    );
    if (!rows.length) return;
    const ex = await exhibition(db);
    for (const r of rows) {
      const noticeDue = r.notice === "queued";
      const message = noticeDue
        ? withdrawalMail(ex.title, r.lender_name)
        : previewMail(ex.title, r.lender_name, museumDisplay(r.publish_at, ex.timeZone), r.works, `${config.publicBase}/p/${r.token}`);
      try {
        await sendMail({ to: r.email, ...message });
      } catch {
        return;
      }
      await db.query(
        noticeDue
          ? "UPDATE recipients SET notice = 'sent' WHERE preview_id = $1 AND lender_id = $2"
          : "UPDATE recipients SET delivery = 'sent', sent_at = now() WHERE preview_id = $1 AND lender_id = $2",
        [r.preview_id, r.lender_id],
      );
    }
  });
}

function every(ms: number, task: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running || !isReady()) return;
    running = true;
    task()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, ms);
}

export function startBackgroundWork(): void {
  every(PUBLISH_CHECK_MS, publishDue);
  every(MAIL_RETRY_MS, deliverQueued);
}
