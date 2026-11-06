import type pg from 'pg';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { newId } from './http.js';
import { Position } from './domain.js';

let transporter: nodemailer.Transporter | null = null;
let mailUp = true;
let lastCheck = 0;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

export function mailStatus(): 'up' | 'down' { return mailUp ? 'up' : 'down'; }

export async function checkMail(): Promise<void> {
  if (Date.now() - lastCheck < 9000) return;
  lastCheck = Date.now();
  try {
    await getTransporter().verify();
    mailUp = true;
  } catch {
    mailUp = false;
  }
}

async function sendOne(to: string, subject: string, body: string): Promise<boolean> {
  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      replyTo: config.smtp.from,
      to,
      subject,
      text: body,
    });
    return true;
  } catch {
    mailUp = false;
    return false;
  }
}

export async function flushQueuedEmails(): Promise<void> {
  await checkMail();
  if (!mailUp) return;
  const { withClient } = await import('./db.js');
  await withClient(async (c) => {
    const r = await c.query(`SELECT * FROM queued_emails WHERE sent = false ORDER BY created_at ASC FOR UPDATE SKIP LOCKED`);
    for (const row of r.rows) {
      const ok = await sendOne(row.to_email, row.subject, row.body);
      if (!ok) return;
      await c.query(`UPDATE queued_emails SET sent = true, sent_at = now() WHERE id = $1`, [row.id]);
      if (row.kind === 'alert' || row.kind === 'escalation') {
        await c.query(
          `UPDATE alerts SET ${row.kind === 'alert' ? 'email' : 'escalation'} = 'Emailed' WHERE id = $1`,
          [row.ref_id]
        );
      }
    }
  });
}

function fmtUTC(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function fmtPos(p: Position): string { return `E ${p.easting} N ${p.northing}`; }

async function queue(c: pg.PoolClient, kind: string, dedupeKey: string, to: string, subject: string, body: string, refId: string | null): Promise<void> {
  await c.query(
    `INSERT INTO queued_emails (id, kind, to_email, subject, body, dedupe_key, ref_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (dedupe_key, to_email) DO NOTHING`,
    [newId('em'), kind, to, subject, body, dedupeKey, refId]
  );
}

export const emailOutbox = {
  async queueAlert(c: pg.PoolClient, alertId: string, kind: string, vesselName: string, missionId: string, position: Position | null, at: Date): Promise<void> {
    const recipients = await c.query(
      kind === 'service_overdue'
        ? `SELECT email FROM users WHERE role IN ('principal_surveyor','launch_technician')`
        : `SELECT email FROM users WHERE role = 'principal_surveyor'`
    );
    const mission = await c.query(`SELECT name FROM missions WHERE id = $1`, [missionId]);
    const missionName = mission.rows[0]?.name ?? missionId;
    const subject = `${kind === 'geofence_breach' ? 'Geofence breach' : kind === 'link_lost' ? 'Link lost' : 'Service overdue'} — ${vesselName} — ${missionName}`;
    for (const r of recipients.rows) {
      const body =
        `${subject}\n\n` +
        `Vessel: ${vesselName}\nMission: ${missionName}\n` +
        (position ? `Position: ${fmtPos(position)} metres\n` : ``) +
        `Server time: ${at.toISOString().replace(/\.\d{3}Z$/, 'Z')}\n` +
        `Open the console: ${config.publicUrl}/missions/${missionId}\n`;
      await queue(c, 'alert', `alert:${alertId}`, r.email, subject, body, alertId);
    }
  },

  async queueEscalation(c: pg.PoolClient, alert: { id: string; kind: string; heading: string; vessel_name: string; mission_id: string; raised_at: Date }): Promise<void> {
    const recipients = await c.query(
      alert.kind === 'service_overdue'
        ? `SELECT email FROM users WHERE role IN ('principal_surveyor','launch_technician')`
        : `SELECT email FROM users WHERE role = 'principal_surveyor'`
    );
    const mission = await c.query(`SELECT name FROM missions WHERE id = $1`, [alert.mission_id]);
    const missionName = mission.rows[0]?.name ?? alert.mission_id;
    const original = `${alert.kind === 'geofence_breach' ? 'Geofence breach' : alert.kind === 'link_lost' ? 'Link lost' : 'Service overdue'} — ${alert.vessel_name} — ${missionName}`;
    const subject = `Escalation: ${original}`;
    for (const r of recipients.rows) {
      const body =
        `${subject}\n\n` +
        `Vessel: ${alert.vessel_name}\nMission: ${missionName}\n` +
        `Raised: ${new Date(alert.raised_at).toISOString().replace(/\.\d{3}Z$/, 'Z')}\n` +
        `Open the console: ${config.publicUrl}/missions/${alert.mission_id}\n`;
      await queue(c, 'escalation', `escalation:${alert.id}`, r.email, subject, body, alert.id);
    }
    await c.query(`UPDATE alerts SET escalation = 'Queued' WHERE id = $1`, [alert.id]);
  },

  async queueReportReady(c: pg.PoolClient, missionId: string, missionName: string, orgId: string,
    reportSha: string, coveragePct: number, openHolidays: number,
    agreement: { pct: number | null; compared: number },
    generatedAt: Date, generatedLocal: string): Promise<void> {
    const recipients = await c.query(
      `SELECT email FROM users WHERE role = 'client_reviewer' AND client_org_id = $1`, [orgId]);
    const utc = fmtUTC(generatedAt);
    const localMatch = generatedLocal.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})([+-]\d{2}:\d{2})$/);
    const localDate = localMatch ? `${localMatch[1]} ${localMatch[2]}` : generatedLocal.slice(0, 16).replace('T', ' ');
    const localOffset = localMatch ? localMatch[3] : '+00:00';
    const agreementLine = `Coverage ${coveragePct}% · Open holidays ${openHolidays} · ${agreement.compared === 0 ? 'Crossline agreement —' : `Crossline agreement ${agreement.pct}% of ${agreement.compared}`}`;
    for (const r of recipients.rows) {
      const body =
        `Coverage report ready for ${missionName}.\r\n` +
        `Completed ${localDate} (${localOffset})\r\n` +
        `Completed UTC ${utc}\r\n` +
        `Report SHA-256 ${reportSha}\r\n` +
        `${agreementLine}\r\n` +
        `Open the survey: ${config.publicUrl}/surveys/${missionId}\r\n`;
      await queue(c, 'report', `report:${missionId}`, r.email, `Coverage report ready — ${missionName}`, body, null);
    }
  },

  async queueHandover(c: pg.PoolClient, missionId: string, missionName: string, newOwnerEmail: string, newOwnerName: string, prevOwnerName: string, at: Date): Promise<void> {
    const subject = `${missionName} handed to you`;
    const body = `${prevOwnerName} handed ${missionName} to you at ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC.\n\n${config.publicUrl}/missions/${missionId}\n`;
    await queue(c, 'handover', `handover:${missionId}:${newOwnerName}:${at.getTime()}`, newOwnerEmail, subject, body, null);
  },

  async queueFlagEmail(c: pg.PoolClient, flagId: string, missionId: string, missionName: string,
    label: string, comment: string, clientName: string): Promise<void> {
    const recipients = await c.query(`SELECT email FROM users WHERE role = 'principal_surveyor'`);
    const subject = `${clientName} flagged ${label} on ${missionName}`;
    for (const r of recipients.rows) {
      const body = `${subject}\n\n${comment}\n\n${config.publicUrl}/flags\n`;
      await queue(c, 'flag', `flag:${flagId}:${r.email}`, r.email, subject, body, null);
    }
  },

  async queueFlagReply(c: pg.PoolClient, flagId: string, missionId: string, missionName: string,
    label: string, reply: string, reviewerEmail: string): Promise<void> {
    const subject = `Reply on ${label} for ${missionName}`;
    const body = `${subject}\n\n${reply}\n\n${config.publicUrl}/surveys/${missionId}\n`;
    await queue(c, 'flagreply', `flagreply:${flagId}:${reviewerEmail}`, reviewerEmail, subject, body, null);
  },
};

let flushing = false;
export function startMailTimers(): void {
  setInterval(async () => {
    if (flushing) return;
    flushing = true;
    try { await flushQueuedEmails(); } catch { /* retried next tick */ }
    flushing = false;
  }, 5000).unref();
}
