// Background work: the cutoff lock, the mail sender and the export builder. Several instances may run
// against one database, so every worker claims its rows with SKIP LOCKED and acts only when its own
// service is up.
import { type Db, tx } from "./db.js";
import { CSV_TYPE, XLSX_TYPE, sheetCsv, workbookXlsx } from "./files/exportFile.js";
import { queueExportReady, queueSeasonClosed } from "./mail.js";
import { type Mailer } from "./services/mailer.js";
import { type StatusMonitor } from "./services/status.js";
import { type Storage } from "./services/storage.js";
import { type WorkbookRow, derive, stationClock } from "./workbook.js";

export type Workers = ReturnType<typeof startWorkers>;

function loop(every: number, work: () => Promise<void>): () => void {
  let running = false;
  let again = false;
  const run = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void work()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          run();
        }
      });
  };
  setInterval(run, every);
  return run;
}

/** Moves in-season workbooks past their cutoff to locked, queueing one season-closed notice per lock. */
async function lockPastCutoff(db: Db): Promise<number> {
  return tx(db, async (t) => {
    const due = await t.query<{ id: string; station_id: string; name: string; closes_at_utc: Date; time_zone: string }>(
      `UPDATE workbooks w SET state = 'locked', updated_at = clock_timestamp()
       FROM stations s
       WHERE s.id = w.station_id AND w.state = 'in_season' AND w.closes_at_utc <= now()
       RETURNING w.id, w.station_id, w.name, w.closes_at_utc, s.time_zone`,
    );
    for (const w of due.rows) {
      await queueSeasonClosed(t, { stationId: w.station_id, workbookName: w.name, at: w.closes_at_utc, zone: w.time_zone });
    }
    return due.rows.length;
  });
}

/** Claims one unsent message (a given one, or the oldest), sends it and marks it sent, exactly once. */
function deliverOne(db: Db, mailer: Mailer, status: StatusMonitor, mailId: number | null): Promise<boolean> {
  return tx(db, async (t) => {
    const r = await t.query<{ id: string; to_address: string; subject: string; body: string }>(
      `SELECT id, to_address, subject, body FROM mail_queue WHERE sent_at IS NULL AND ($1::bigint IS NULL OR id = $1)
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [mailId],
    );
    const message = r.rows[0];
    if (!message) return false;
    await mailer.send({ to: message.to_address, subject: message.subject, body: message.body });
    await t.query("UPDATE mail_queue SET sent_at = clock_timestamp() WHERE id = $1", [message.id]);
    return true;
  }).catch(() => {
    status.markDown("mail");
    return false;
  });
}

async function sendMail(db: Db, mailer: Mailer, status: StatusMonitor): Promise<void> {
  while (status.status.mail === "up" && (await deliverOne(db, mailer, status, null)));
}

async function buildExports(db: Db, storage: Storage, status: StatusMonitor, kickMail: () => void): Promise<void> {
  while (status.status.storage === "up") {
    const outcome = await tx(db, async (t) => {
      const r = await t.query<{
        id: string;
        workbook_id: string;
        format: "xlsx" | "csv";
        sheet_id: string | null;
        file_name: string;
        head_seq: number;
        origin: string;
        email: string;
      }>(
        `SELECT e.id, e.workbook_id, e.format, e.sheet_id, e.file_name, e.head_seq, e.origin, m.email
         FROM exports e JOIN members m ON m.id = e.member_id
         WHERE e.status <> 'ready' ORDER BY e.created_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED`,
      );
      const job = r.rows[0];
      if (!job) return "idle" as const;
      const w = await t.query<WorkbookRow & { time_zone: string }>(
        "SELECT w.*, s.time_zone FROM workbooks w JOIN stations s ON s.id = w.station_id WHERE w.id = $1",
        [job.workbook_id],
      );
      const row = w.rows[0];
      const derived = await derive(t, row, stationClock(row.time_zone), job.head_seq);
      const key = `stations/${row.station_id}/exports/${job.id}/${job.file_name}`;
      const file = job.format === "xlsx" ? workbookXlsx(derived.engine) : sheetCsv(derived.engine, job.sheet_id as string);
      try {
        await storage.put(key, file, job.format === "xlsx" ? XLSX_TYPE : CSV_TYPE);
      } catch {
        await t.query("UPDATE exports SET status = 'waiting_for_storage' WHERE id = $1", [job.id]);
        return "storage_down" as const;
      }
      try {
        await t.query("UPDATE exports SET status = 'ready', ready_at = clock_timestamp() WHERE id = $1", [job.id]);
        await queueExportReady(t, {
          to: job.email,
          workbookName: row.name,
          fileName: job.file_name,
          link: `${job.origin}/api/exports/${job.id}/download`,
        });
      } catch (error) {
        // Undo: the export is not recorded as ready, so its stored file is removed before the retry.
        await storage.remove(key).catch(() => undefined);
        throw error;
      }
      return "ready" as const;
    });
    if (outcome === "storage_down") status.markDown("storage");
    if (outcome === "ready") kickMail();
    if (outcome !== "ready") return;
  }
}

export function startWorkers(db: Db, storage: Storage, mailer: Mailer, status: StatusMonitor) {
  loop(1000, async () => {
    if ((await lockPastCutoff(db)) > 0) kickMail();
  });
  const kickMail = loop(3000, () => sendMail(db, mailer, status));
  const kickExports = loop(3000, () => buildExports(db, storage, status, kickMail));
  status.onChange((now, before) => {
    if (now.mail === "up" && before.mail === "down") kickMail();
    if (now.storage === "up" && before.storage === "down") kickExports();
  });
  /** Tries to deliver one queued message right away; false leaves it queued for the sender. */
  const sendNow = (mailId: number): Promise<boolean> =>
    status.status.mail === "up" ? deliverOne(db, mailer, status, mailId) : Promise.resolve(false);
  return { kickMail, kickExports, sendNow };
}
