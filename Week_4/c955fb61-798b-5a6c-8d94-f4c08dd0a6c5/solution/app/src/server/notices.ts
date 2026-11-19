import { formatLong } from "../shared/calendar";
import { formatHours } from "../shared/format";
import { settings } from "./config";
import { inTransaction, pool } from "./db";
import { loadProject } from "./model";
import { sendMail } from "./smtp";

const RETRY_SECONDS = 10;
const POLL_MS = 1000;

/** Sends every queued assignment notice that is due, once; a notice the mail server refuses is retried later. */
async function sendDueNotices(): Promise<void> {
  await inTransaction(async (tx) => {
    const due = await tx.query(
      `SELECT n.id, n.item_id, n.hours, assignee.name AS assignee_name, assignee.email AS assignee_email,
              assigner.name AS assigner_name, i.name AS item_name, i.project_id
         FROM notices n JOIN users assignee ON assignee.id = n.assignee_id JOIN users assigner ON assigner.id = n.assigner_id
         JOIN items i ON i.id = n.item_id
        WHERE n.sent_at IS NULL AND n.attempt_at <= now() ORDER BY n.attempt_at LIMIT 10 FOR UPDATE OF n SKIP LOCKED`,
    );
    for (const notice of due.rows) {
      const project = await loadProject(pool, notice.project_id);
      const placed = project.schedule.items[notice.item_id];
      try {
        await sendMail({
          to: { name: notice.assignee_name, email: notice.assignee_email },
          subject: `New assignment: ${notice.item_name} in ${project.name}`,
          lines: [
            `${notice.assigner_name} assigned you to ${notice.item_name} in ${project.name}.`,
            `Starts: ${placed.start ? formatLong(placed.start) : ""}`,
            `Ends: ${placed.end ? formatLong(placed.end) : ""}`,
            `Hours a day: ${formatHours(notice.hours)}`,
            `Open: ${settings.publicUrl}/projects/${project.id}?task=${notice.item_id}`,
          ],
        });
        await tx.query("UPDATE notices SET sent_at = now() WHERE id = $1", [notice.id]);
      } catch {
        await tx.query("UPDATE notices SET attempt_at = now() + make_interval(secs => $2) WHERE id = $1", [notice.id, RETRY_SECONDS]);
      }
    }
  });
}

export function startNoticeQueue(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    sendDueNotices()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        running = false;
      });
  }, POLL_MS);
}
