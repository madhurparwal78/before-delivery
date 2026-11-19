import type { FastifyInstance } from "fastify";
import { one, rows } from "./db/pool.js";
import { instantOf } from "./engine/time.js";
import { queueMail } from "./services/mailer.js";
import { ANSWER_COPY, MAIL_COPY, type Lang } from "./engine/copy.js";

function townName(town: string): string {
  const names: Record<string, string> = {
    porto: "Porto",
    izmir: "Izmir",
    hoChiMinhCity: "Ho Chi Minh City",
    cairo: "Cairo",
  };
  return names[town] ?? town;
}

/**
 * Housekeeping: reminders, page ends, label erasure, dossier PDF making for the seed
 * dossier when Gotenberg and MinIO are first reachable, and pending mail delivery.
 */
export function startHousekeeping(app: FastifyInstance): void {
  let running = false;
  const pass = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sendReminders(app);
      await eraseDueLabels(app);
      await makeSeedDossier(app);
      await deliverMail(app);
    } catch (err) {
      console.error("housekeeping pass failed", err);
    } finally {
      running = false;
    }
  };
  void pass();
  const timer = setInterval(() => {
    void pass();
  }, 5000);
  timer.unref?.();
}

async function sendReminders(app: FastifyInstance): Promise<void> {
  const config = app.state.config;
  const now = instantOf(new Date());

  const candidates = await rows<{
    id: string; supplier_name: string; contact_name: string; contact_email: string; town: string;
    language: string; due_date: string; sent_at: string; token: string | null;
  }>(
    `SELECT id, supplier_name, contact_name, contact_email, town, language, due_date, sent_at, token
     FROM requests WHERE state IN ('sent','reminded') AND reminded_at IS NULL AND answered_at IS NULL
       AND token IS NOT NULL AND token_ends_at > $1`,
    [now],
  );
  for (const r of candidates) {
    const sentAt = new Date(r.sent_at);
    if (sentAt.getTime() + config.reminderAfterSeconds * 1000 > Date.now()) continue;
    const label = await one<{ name: string; state: string }>(
      `SELECT l.name, l.state FROM requests rq JOIN styles s ON s.id = rq.style_id JOIN labels l ON l.id = s.label_id WHERE rq.id = $1`,
      [r.id],
    );
    if (!label || label.state !== "open") continue; // a reminder falling due while closed goes after it comes back
    const style = await one<{ name: string }>(
      `SELECT s.name FROM requests rq JOIN styles s ON s.id = rq.style_id WHERE rq.id = $1`,
      [r.id],
    );
    const lang = r.language as Lang;
    const mail = MAIL_COPY[lang];
    const copy = ANSWER_COPY[lang];
    const dueLine = copy.dueLine.replace("<dueDate>", r.due_date).replace("<town>", townName(r.town));
    await queueMail(
      r.contact_email,
      mail.reminderSubject.replace("<labelName>", label.name),
      [
        mail.greeting.replace("<contactName>", r.contact_name),
        "",
        mail.ask.replace("<labelName>", label.name).replace("<styleName>", style?.name ?? ""),
        "",
        `${app.state.config.appPublicUrl}/a/${r.token}`,
        "",
        dueLine,
      ].join("\n"),
    );
    await rows(`UPDATE requests SET state = 'reminded', reminded_at = $1 WHERE id = $2`, [now, r.id]);
  }
}

async function eraseDueLabels(app: FastifyInstance): Promise<void> {
  const now = instantOf(new Date());
  const closed = await rows<{ id: string; desk_id: string; name: string; erase_at: string }>(
    `SELECT id, desk_id, name, erase_at FROM labels WHERE state = 'closed' AND erase_at IS NOT NULL AND erase_at <= $1`,
    [now],
  );
  for (const label of closed) {
    // Withdraw passports and remove files, confirmed by MinIO before the label moves to erased.
    const passports = await rows<{ id: string; style_id: string }>(
      `SELECT p.id, p.style_id FROM passports p JOIN styles s ON s.id = p.style_id WHERE s.label_id = $1`,
      [label.id],
    );
    for (const p of passports) {
      await rows(`UPDATE passports SET state = 'withdrawn' WHERE id = $1`, [p.id]);
    }
    const evidence = await rows<{ key: string }>(
      `SELECT 'evidence/' || r.desk_id || '/' || r.id || '/' || e.id AS key
       FROM evidence e JOIN requests r ON r.id = e.request_id
       WHERE r.desk_id = $1`,
      [label.desk_id],
    );
    const dossiers = await rows<{ key: string }>(
      `SELECT 'dossiers/' || d.desk_id || '/' || d.id || '.pdf' AS key
       FROM dossiers d JOIN styles s ON s.id = d.style_id
       WHERE d.desk_id = $1 AND s.label_id = $2`,
      [label.desk_id, label.id],
    );
    let allConfirmed = true;
    for (const item of [...evidence, ...dossiers]) {
      try {
        await app.state.files.remove(item.key);
      } catch {
        allConfirmed = false;
      }
    }
    if (!allConfirmed) continue; // stays closed and tries again
    await rows(
      `UPDATE evidence SET file_name = '', content_type = '', size_bytes = 0 WHERE id IN (
         SELECT e.id FROM evidence e JOIN requests r ON r.id = e.request_id
         JOIN styles s ON s.id = r.style_id WHERE s.label_id = $1)`,
      [label.id],
    );
    await rows(
      `UPDATE suppliers SET contact_name = '', contact_email = '' WHERE label_id = $1`,
      [label.id],
    );
    await rows(
      `UPDATE labels SET contact_name = '', contact_email = '', state = 'erased' WHERE id = $1`,
      [label.id],
    );
    await rows(
      `DELETE FROM mail_queue WHERE id IN (
         SELECT m.id FROM mail_queue m WHERE m.to_email IN (
           SELECT contact_email FROM suppliers WHERE label_id = $1
           UNION SELECT contact_email FROM labels WHERE id = $1))`,
      [label.id],
    );
  }
}

/** The seeded dossier's PDF is made by the app when Gotenberg and MinIO are first reachable. */
async function makeSeedDossier(app: FastifyInstance): Promise<void> {
  const pending = await rows<{ id: string; style_id: string; desk_id: string }>(
    `SELECT id, style_id, desk_id FROM dossiers WHERE pdf_key IS NULL AND state IN ('signedOff','ready','replaced') LIMIT 1`,
  );
  if (pending.length === 0) return;
  const d = pending[0];
  const result = await one<{ edition: string; data_quality_grade: string; data_quality_percent: number; measures: unknown }>(
    `SELECT edition, data_quality_grade, data_quality_percent, measures FROM results WHERE style_id = $1 ORDER BY worked_out_at DESC, id DESC LIMIT 1`,
    [d.style_id],
  );
  const style = await one<{ name: string; label_id: string }>(`SELECT name, label_id FROM styles WHERE id = $1`, [d.style_id]);
  const label = await one<{ name: string }>(`SELECT name FROM labels WHERE id = $1`, [style?.label_id ?? ""]);
  const { dossierHtml } = await import("./api/passports.js");
  const measures = (result?.measures ?? []) as { measure: string; totalShown: string; stages: { stage: string; shown: string }[] }[];
  const html = dossierHtml(style?.name ?? "", label?.name ?? "", result?.edition ?? "", result?.data_quality_grade ?? "C", result?.data_quality_percent ?? 0, measures);
  try {
    const pdf = await (await import("./services/gotenberg.js")).renderPdf(app.state.config, html);
    await app.state.files.put(`dossiers/${d.desk_id}/${d.id}.pdf`, pdf, "application/pdf");
    await rows(`UPDATE dossiers SET pdf_key = $1 WHERE id = $2`, [`dossiers/${d.desk_id}/${d.id}.pdf`, d.id]);
  } catch {
    // until then it reads as unavailable
  }
}

async function deliverMail(app: FastifyInstance): Promise<void> {
  const { deliverPending } = await import("./services/mailer.js");
  const openEmails = async (to: string): Promise<boolean> => {
    const label = await one<{ state: string }>(
      `SELECT l.state FROM labels l WHERE l.contact_email = $1
       UNION SELECT s2.state FROM suppliers sp JOIN labels s2 ON s2.id = sp.label_id WHERE sp.contact_email = $1`,
      [to],
    );
    if (!label) return true;
    return label.state === "open";
  };
  await deliverPending(app.state.mailer, openEmails);
}
