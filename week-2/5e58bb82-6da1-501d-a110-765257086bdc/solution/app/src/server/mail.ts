// Email: messages wait in the Postgres outbox, one per recipient, and are sent (and retried) by the worker.
import { config } from "./config.js";
import type { Db } from "./db.js";
import { rows, tx } from "./db.js";
import { fixed1 } from "./numbers.js";
import type { AlertView, OutboxRecord, UserRecord } from "./records.js";
import { sendMail } from "./smtp.js";
import { status } from "./status.js";

type MailKind = "alert" | "escalation" | "report" | "handover" | "flag" | "reply";

export async function queueMail(db: Db, kind: MailKind, refId: string, dedupe: string, to: Pick<UserRecord, "email" | "name">, subject: string, lines: string[]): Promise<void> {
  await db.query(
    `INSERT INTO outbox (dedupe, ref_kind, ref_id, recipient, recipient_name, subject, body, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe) DO NOTHING`,
    [dedupe, kind, refId, to.email, to.name, subject, lines.map((l) => `${l}\r\n`).join(""), new Date()]);
}

export async function staff(db: Db, withTechnicians: boolean): Promise<UserRecord[]> {
  return rows<UserRecord>(db, `SELECT * FROM users WHERE role = ANY($1) ORDER BY id`,
    [withTechnicians ? ["principal_surveyor", "launch_technician"] : ["principal_surveyor"]]);
}

const alertSubject = (a: AlertView, missionName: string) => `${a.heading} — ${missionName}`;

function alertBody(a: AlertView, missionName: string, escalation: boolean): string[] {
  const position = a.easting === null ? "unknown" : `E ${fixed1(a.easting)} m N ${fixed1(a.northing)} m`;
  return [
    escalation ? `Still active after ${config.escalationSeconds} seconds: ${a.heading}` : a.heading,
    `Vessel: ${a.vessel_name}`,
    `Mission: ${missionName}`,
    `Position: ${position}`,
    `Raised: ${a.raised_at.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    `Open the mission console: ${config.publicUrl}/missions/${a.mission_id}`,
  ];
}

/** Breach and link-lost alerts go to every principal surveyor; service-overdue also to launch technicians. */
export async function queueAlertMail(db: Db, a: AlertView, missionName: string): Promise<void> {
  for (const user of await staff(db, a.kind === "service_overdue")) {
    await queueMail(db, "alert", a.id, `alert:${a.id}:${user.id}`, user, alertSubject(a, missionName), alertBody(a, missionName, false));
  }
}

async function escalate(): Promise<void> {
  const due = new Date(Date.now() - config.escalationSeconds * 1000);
  await tx(async (db) => {
    const found = await rows<AlertView & { mission_name: string }>(db,
      `UPDATE alerts a SET escalation_state = 'Queued' FROM missions m, vessels v
       WHERE a.state = 'Active' AND a.escalation_state = 'None' AND a.raised_at <= $1 AND m.id = a.mission_id AND v.id = a.vessel_id
       RETURNING a.*, m.name AS mission_name, v.name AS vessel_name`, [due]);
    for (const a of found) {
      for (const user of await staff(db, true)) {
        await queueMail(db, "escalation", a.id, `escalation:${a.id}:${user.id}`, user,
          `Escalation: ${alertSubject(a, a.mission_name)}`, alertBody(a, a.mission_name, true));
      }
    }
  });
}

async function deliver(): Promise<void> {
  await tx(async (db) => {
    // A short settle delay keeps an alert's email state steady while staff react to it on the board.
    const pending = await rows<OutboxRecord>(db, "SELECT * FROM outbox WHERE sent_at IS NULL AND created_at <= $1 ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED",
      [new Date(Date.now() - 1500)]);
    const touched = new Set<string>();
    for (const m of pending) {
      try {
        await sendMail({ to: m.recipient, toName: m.recipient_name, subject: m.subject, body: m.body });
      } catch {
        status.mail = "down";
        break;
      }
      await db.query("UPDATE outbox SET sent_at = $2 WHERE id = $1", [m.id, new Date()]);
      if (m.ref_kind === "alert" || m.ref_kind === "escalation") touched.add(`${m.ref_kind}:${m.ref_id}`);
    }
    for (const key of touched) {
      const [kind, id] = key.split(":");
      const column = kind === "alert" ? "email_state" : "escalation_state";
      await db.query(
        `UPDATE alerts SET ${column} = 'Emailed' WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM outbox WHERE ref_kind = $2 AND ref_id = $1 AND sent_at IS NULL)`, [id, kind]);
    }
  });
}

/** Sends waiting mail every half second and queues escalations that have come due. */
export function startMailWorker(): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    escalate()
      .then(deliver)
      .catch((error) => console.error("mail worker:", error instanceof Error ? error.message : "failed"))
      .finally(() => {
        busy = false;
      });
  }, 500);
}

