import { q, q1, todayTurin } from "./db.js";
import { config, sha256 } from "./config.js";
import { sendMail } from "./providers/mail.js";
import { s3 } from "./providers/s3.js";
import { meili } from "./providers/meili.js";
import { clientCopy, type ClientLang } from "./client-copy.js";
import { fmtDateByLang, localDate, townZone, endOfDayTurin, fmtDateEn } from "./time.js";
import { flushPending } from "./sync.js";
import { addDaysISO } from "./time.js";
import { localTimeHM } from "./time.js";
import { renderAndStore } from "./api/dossier.js";

/**
 * One sweep for every time-based rule: client closure and erase, client page ends
 * and reminders, dossier renders, hold ends and pending search entries.
 */
export async function sweepOnce(): Promise<void> {
  const now = new Date();

  // Holds end through 23:59:59 Turin time on their last day.
  const today = todayTurin();
  const holdEnd = endOfDayTurin(addDaysISO(today, -1));
  await q("UPDATE holds SET state='ended' WHERE state='held' AND ends_on < $1", [today]);

  // Client pages end at their instant.
  const pages = await q<{ token: string; desk_id: string; piece_id: string; sent_at: Date; ends_at: Date; reminder_sent_at: Date | null; state: string }>(
    `SELECT cp.token, cp.desk_id, cp.piece_id, cp.sent_at, cp.ends_at, cp.reminder_sent_at, cp.state,
            c.email, c.name AS client_name, c.town, c.language, p.title, p.due_date::text AS due_date
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.state='live' AND cp.ends_at <= $1`, [now.toISOString()]
  );
  for (const page of pages) {
    await q("UPDATE client_pages SET state='ended' WHERE token=$1", [page.token]);
  }

  // Reminders: one, only if no answer or sign-off, page still live.
  const reminderDue = await q<{ token: string; desk_id: string; address: string; email: string; client_name: string; town: string; language: string; title: string; due_date: string | null }>(
    `SELECT cp.token, cp.desk_id, cp.address, c.email, c.name AS client_name, c.town, c.language, p.title, p.due_date::text AS due_date
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.state='live' AND cp.reminder_sent_at IS NULL
       AND cp.answer IS NULL AND cp.sign_off IS NULL
       AND cp.sent_at + ($1::text)::interval <= now()`, [`${config.timers.reminderAfter} seconds`]
  );
  for (const r of reminderDue) {
    const clientState = await q1<{ state: string }>("SELECT state FROM clients WHERE id = (SELECT client_id FROM pieces WHERE id = (SELECT piece_id FROM client_pages WHERE token=$1))", [r.token]);
    if (clientState && clientState.state !== "active") continue;
    const lang = r.language as ClientLang;
    const copy = clientCopy[lang];
    const dueText = r.due_date ? fmtDateByLang[lang]!(new Date(`${String(r.due_date).slice(0, 10)}T12:00:00Z`), townZone[r.town as "Turin"]) : "";
    await sendMail({
      to: r.email,
      subject: copy.M2.replace("<title>", r.title),
      text: `${copy.M3.replace("<name>", r.client_name)}\n\n${copy.M4.replace("<address>", r.address)}\n\n${copy.C19.replace("<date>", dueText)}\n`,
    });
    await q("UPDATE client_pages SET reminder_sent_at=now() WHERE token=$1", [r.token]);
  }

  // Closing → erasing → erased, checked at least every 2 seconds.
  const closing = await q<{ id: string; desk_id: string; name: string; closes_at: Date }>(
    `SELECT id, desk_id, name, closes_at FROM clients WHERE state='closing' AND closes_at + ($1::text)::interval <= now()`,
    [`${config.timers.closureWait} seconds`]
  );
  for (const c of closing) {
    await q("UPDATE clients SET state='erasing' WHERE id=$1", [c.id]);
  }
  const erasing = await q<{ id: string; desk_id: string }>("SELECT id, desk_id FROM clients WHERE state='erasing'");
  for (const c of erasing) {
    // Ask MinIO and Meilisearch even for a client with no files.
    const pieces = await q<{ id: string }>("SELECT id FROM pieces WHERE client_id=$1", [c.id]);
    let minioOk = true;
    for (const piece of pieces) {
      const keys = await s3.list(`photographs/${c.desk_id}/${piece.id}/`);
      for (const key of keys) {
        const ok = await s3.del(key);
        if (!ok) minioOk = false;
      }
      const labels = await s3.list(`labels/${c.desk_id}/${piece.id}/`);
      for (const key of labels) {
        const ok = await s3.del(key);
        if (!ok) minioOk = false;
      }
    }
    const entries = await q<{ kind: string; ref_id: string }>("SELECT kind, ref_id FROM search_sync WHERE desk_id=$1 AND (ref_id=$2 OR ref_id IN (SELECT id FROM pieces WHERE client_id=$2))", [c.desk_id, c.id]);
    const ids = entries.map((e) => `${c.desk_id}-${e.kind}-${e.ref_id}`);
    const meiliOk = ids.length ? await meili.delete(ids) : true;
    if (!minioOk || !meiliOk) continue;
    // Only after both providers confirm each deletion does the client read Erased.
    await q("DELETE FROM search_sync WHERE desk_id=$1 AND (ref_id=$2 OR ref_id IN (SELECT id FROM pieces WHERE client_id=$2))", [c.desk_id, c.id]);
    await q("DELETE FROM clients WHERE id=$1", [c.id]);
  }

  // Dossiers waiting on a provider retry.
  const waiting = await q<{ id: string; piece_id: string; desk_id: string }>("SELECT id, piece_id, desk_id FROM dossiers WHERE state='waiting'");
  for (const d of waiting) {
    await renderAndStore(d.desk_id, d.piece_id, d.id).catch(() => undefined);
  }
  const failed = await q<{ id: string; piece_id: string; desk_id: string }>("SELECT id, piece_id, desk_id FROM dossiers WHERE state='failed'");
  void failed;

  // Pending search entries retry while the engine is down.
  await flushPending().catch(() => undefined);
}

export function sweep(): void {
  const tick = () => {
    void sweepOnce().catch(() => undefined);
  };
  tick();
  const timer = setInterval(tick, 2000);
  timer.unref();
}

void sha256;
void localDate;
void localTimeHM;
void fmtDateEn;
